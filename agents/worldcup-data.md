# agents/worldcup-data.md — 4 源融合权重、Polymarket / Odds API 字段映射

> 适用文件：`js/worldcup.js`（前端融合 & 渲染）、`api/cron/sync-odds.js`（Vercel Cron 抓取）、`api/odds/*`（读取层）、`data/wc_llm_*.json`（LLM 输出）。
> 主入口：`AGENTS.md` 规则 5（4 源 = Elo + The Odds API + Polymarket + LLM；改融合权重前先看 `js/odds-utils.js`）。

## 1. 4 个数据源

| Key | 来源 | 类型 | 更新机制 | 在前端 state 里的位置 |
|---|---|---|---|---|
| `h2h` | Elo 推演 | 内部计算 | 静态（依赖 `data/worldcup_2026.json`） | 不存 state，每次 `predictH2H(matchId)` 算 |
| `odds` | The Odds API | 外部 | Vercel Cron 抓 → Redis `odds:snapshot:the-odds-api` | `state.oddsSnapshots['the-odds-api']` |
| `poly` | Polymarket 单场 1X2 | 外部 | Vercel Cron 抓 → Redis `odds:snapshot:polymarket-h2h` | `state.oddsSnapshots['polymarket-h2h']` |
| `llm` | LLM 预测 | 静态 JSON | 手动跑 `node scripts/llm-predict.js` | `state.llmPredictions` / `state.llmOutright` |

## 2. 融合权重（核心）

定义在 `js/worldcup.js:1478`：

```js
const ENSEMBLE_WEIGHTS = { h2h: 0.30, odds: 0.30, poly: 0.20, llm: 0.20 };
```

合计 1.0。**改权重的副作用**：
- `ensemblePredict(h2hResult, oddsMarket, polymarketEvent, llmPred)` 会按新权重加权平均。
- 没有 `oddsMarket` / `polymarketEvent` / `llmPred` 时该项**不参与**（不补 0），剩余项按比例放大。
- 改完记得同步更新 `agents/llm-predict.md` 里的权重表（文档一致性）。

## 3. 抓取：`api/cron/sync-odds.js`

**唯一的抓取入口**（AGENTS.md 规则 5：别手动 `curl` 模拟）。`vercel.json` 里配 schedule 触发。

抓到的数据存到 Redis：
- `odds:snapshot:<source>` → 最新一份快照（Hash / String JSON）
- `odds:history:the-odds-api` → 最近 28 个时间点的历史（List），供前端"赔率趋势"小图用

历史只保留 28 个点 = **约 28 天的 daily 抓取**；超过的 `LTRIM` 截断。

## 4. The Odds API 字段映射

The Odds API 返回的 `events[]` 里关键字段：

```json
{
  "id": "abc123",
  "sport_key": "soccer_fifa_world_cup",
  "home_team": "France",
  "away_team": "Brazil",
  "commence_time": "2026-06-15T20:00:00Z",
  "bookmakers": [
    {
      "key": "bet365",
      "title": "Bet365",
      "markets": [
        {
          "key": "h2h",
          "outcomes": [
            { "name": "France", "price": 2.10 },
            { "name": "Draw",   "price": 3.40 },
            { "name": "Brazil", "price": 3.60 }
          ]
        }
      ]
    }
  ]
}
```

→ 落 Redis 后（`odds:snapshot:the-odds-api`）的 schema **保留原样**，前端 `extractH2HMarket(oddsEvent)` 在 `js/worldcup.js:532` 处理：
- 遍历 `bookmakers[].markets[].outcomes[]`
- 找 `markets[].key === 'h2h'` 的第一个 bookmaker
- 按 `name` 匹配 `oddsEvent.home_team` / `away_team` / `Draw` 抽 `price` 字段
- `price` 是**美式赔率/欧赔/小数赔率**取决于 API 配置；`OddsUtils.normalizeOutcomes` 会按 `decimalOdds` / `odds` / `price` 顺序识别

**坑**：如果 API 配置改了赔率制式（比如从 decimal 换 american），`price` 字段含义会变，`OddsUtils` 里的归一化会出 bug。改前**先确认 API 的 `oddsFormat` 参数**。

## 5. Polymarket 字段映射

### 5.1 单场 1X2 h2h（主源，前端 ensemble 用这个）

数据走 **Gamma API `series_id=11433`**（soccer-fifwc = "FIFA World Cup" series），里面是 72 场世界杯单场游戏的 **parent events**。每个 parent event slug 形式为：

```
fifwc-{home3}-{away3}-{YYYY-MM-DD}     # 例如 fifwc-mex-rsa-2026-06-11
```

`home3` / `away3` 是 FIFA 三字母国家代码（`mex` = Mexico, `rsa` = South Africa, `kor` = South Korea, `cvi` = Cape Verde, `ksa` = Saudi Arabia, `usa` = USA, `tur` = Turkey ...）。

每个 parent event 内部有 **3 个 market**（1X2），各自 Yes/No：

```json
{
  "id": "351715",
  "slug": "fifwc-mex-rsa-2026-06-11",
  "title": "Mexico vs. South Africa",
  "markets": [
    { "id": "1897034", "question": "Will Mexico win on 2026-06-11?",
      "groupItemTitle": "Mexico", "outcomes": "[\"Yes\",\"No\"]", "outcomePrices": "[\"0.685\",\"0.315\"]" },
    { "id": "1897035", "question": "Will Mexico vs. South Africa end in a draw?",
      "groupItemTitle": "Draw (Mexico vs. South Africa)", "outcomes": "[\"Yes\",\"No\"]", "outcomePrices": "[\"0.205\",\"0.795\"]" },
    { "id": "1897036", "question": "Will South Africa win on 2026-06-11?",
      "groupItemTitle": "South Africa", "outcomes": "[\"Yes\",\"No\"]", "outcomePrices": "[\"0.105\",\"0.895\"]" }
  ]
}
```

**1X2 隐含概率 = 各 market 的 Yes price**（Yes + No = 1.0，已经是 fair price，不需要 devig）。

#### 标准化后存到 Redis（`odds:snapshot:polymarket-h2h`）

`sync-odds.js` 的 `fetchPolymarketH2H()` 把 parent event 拍平：

```json
{
  "fetchedAt": "2026-06-11T18:43:00.000Z",
  "type": "h2h",
  "gameCount": 67,
  "games": [
    {
      "id": "351715",
      "slug": "fifwc-mex-rsa-2026-06-11",
      "home": "Mexico",
      "away": "South Africa",
      "date": "2026-06-11",
      "homeProb": 0.685,
      "drawProb": 0.205,
      "awayProb": 0.105
    }
  ],
  "source": "polymarket-gamma-api-series-11433"
}
```

- `home` / `away` 是 **ticai 国家名**（不是 FIFA 三字母代码），跟 `data/worldcup_2026.json` 的 `team.country` 一致
- FIFA 三字母代码 → ticai 名映射表在 `sync-odds.js` 的 `FIFA3_TO_TICAI` 顶部

#### 前端使用

`js/worldcup.js:570` 的 `findPolymarketByCountry(home, away)` 直接 `event.home === homeCountry && event.away === awayCountry` 查（用 ticai 名精确匹配，不再走中文/英文模糊匹配）。`buildPolymarketProbs` 直接读 `homeProb / drawProb / awayProb`。

### 5.2 衍生品（向后兼容，保留 `odds:snapshot:polymarket`）

tag_id=102350 拉的是 group winner / player props / outright 二元衍生品，前端目前不直接用，**保留仅用于健康度提示**。schema 不变（参见下方旧版本）。

### 5.3 冠军 outright（独立 key）

`odds:snapshot:polymarket-outright`（带 `-outright` 后缀），结构是 `{ country: yesPrice }` 映射，给"冠军" Tab 用：

```json
{
  "France": 0.082,
  "Brazil": 0.071,
  "Argentina": 0.065
}
```

## 6. Elo 推演

不存 state，每次 `predictH2H(matchId)`（`js/worldcup.js:1381+`）现场算：

```js
const eloA = teamA.mod_elo || teamA.elo || 1700;
const eloB = teamB.mod_elo || teamB.elo || 1700;
const diff = eloA - eloB;
const eloWinA = 1 / (1 + Math.pow(10, -diff / 400));   // 标准 Elo 胜率
const rawA = eloWinA * winTotal + 0.03;                // winTotal ≈ 0.94（去掉平局期望）
const rawB = (1 - eloWinA) * winTotal + 0.03;
const drawProb = 1 - rawA - rawB;
```

`mod_elo` 是**修正 Elo**（考虑阵容 / 教练 / 赛程），上游在 `data/worldcup_2026.json` 里。fallback 到 `elo`，再 fallback 到 1700（FIFA 平均）。

**Poisson 进球模型**（`js/worldcup.js:1415+`）：用 Elo 差算每队期望进球数（`lambdaA` / `lambdaB`），跑 Poisson 分布得到精确的 `0-0` / `1-0` / ... / `5-5` 比分概率，再聚合成 `home / draw / away`。

## 7. LLM 融合

LLM 在 `ensemblePredict` 里**直接当一个独立源**用（`js/worldcup.js:1541`）：

```js
{
  key: 'llm', name: 'LLM 预测', icon: '🤖', weight: 0.20,
  probs: { home: llmPred.homeWinProb, draw: llmPred.drawProb, away: llmPred.awayWinProb },
  detail: `置信度 ${pct(llmPred.confidence)}`
}
```

LLM 缺场（`llmPred` null）→ 该项不参与融合；前端会显示"🤖 LLM 预测 缺失"。

**冠军 outright 单独融合**（不在 `ensemblePredict` 里）：见 `js/worldcup.js:1226+`，把 LLM 给的 `winProb` 跟上游 `final_prob` + Polymarket outright 价格做"三源独立判断"对比表，前端渲染时只展示，**不做加权平均**（因为口径不同，硬加权没意义）。

## 8. 字段对照表（速查）

| 概念 | The Odds API | Polymarket | Elo / LLM |
|---|---|---|---|
| 主队胜 | `outcomes[name==home].price` | `outcomes[0] + outcomePrices[0]` | `homeWinProb` |
| 平局 | `outcomes[name==Draw].price` | （通常无） | `drawProb` |
| 客队胜 | `outcomes[name==away].price` | `outcomes[1] + outcomePrices[1]` | `awayWinProb` |
| 比赛标识 | `id` | `slug` 或 `id` | `worldcup_matches.json` 的 `id` |
| 开赛时间 | `commence_time` (ISO) | （无） | `worldcup_matches.json` 的 `date + time` |
| 队伍名 | `home_team` / `away_team` | `outcomes[]` 数组 | `worldcup_matches.json` 的 `home` / `away` |

**队伍名匹配是个雷区**：The Odds API / Polymarket / 数据文件用的英文国家名可能拼写不一（`USA` vs `United States` / `Korea Republic` vs `South Korea`）。前端匹配时**大小写不敏感 + 模糊匹配**，改匹配逻辑前先在控制台打日志看实际字符串。

## 9. 改融合权重的 checklist

1. 改 `js/worldcup.js:1478` 的 `ENSEMBLE_WEIGHTS`，**总和必须 = 1.0**。
2. 同步更新 `agents/llm-predict.md` 第 10 节里的权重表。
3. 如果新增第 5 个数据源：在 `state` 加一个字段 → `api/cron/sync-odds.js` 加抓取 → `ensemblePredict` 加分支 + 权重 → Redis 加 key → 前端 state 加载逻辑更新。
4. 不要触碰 `js/odds-utils.js` 的 `devig` / `EV` / `Kelly`（AGENTS.md 规则 5）——那是**算**价值/EV 的工具，不是融合用的。

## 10. 变更日志

- **2026-06-12**：接入 Polymarket 单场 1X2 h2h 源。Polymarket 把每场 WC 比赛做成 `fifwc-{home}-{away}-{date}` parent event（series 11433），里面 3 个 1X2 market（home/draw/away Yes/No）。`sync-odds.js` 加 `fetchPolymarketH2H()` 拉 + 标准化成 `{home, away, homeProb, drawProb, awayProb}`（ticai 国家名，不是 FIFA 三字母代码）→ Redis `odds:snapshot:polymarket-h2h`。前端 `findPolymarketByCountry` 改用 ticai 名精确匹配；`buildPolymarketProbs` 跳过 devig 直接用 Yes price。
  - 修复前：poly 源永远 `null`，4 源融合缺 1 源（只用 Elo + The Odds API + LLM）
  - 修复后：poly 源拉满 67 场，4 源齐
  - 旧 `odds:snapshot:polymarket`（tag 102350 衍生品）保留，向后兼容
- 2026-06-08：初版。基础项目背景 + 4 源 = Elo + The Odds API + Polymarket (衍生品) + LLM。
