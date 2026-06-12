# agents/worldcup-data.md — 4 源融合权重、Polymarket / Odds API 字段映射

> 适用文件：`js/worldcup.js`（前端融合 & 渲染）、`api/cron/sync-odds.js`（Vercel Cron 抓取）、`api/odds/*`（读取层）、`data/wc_llm_*.json`（LLM 输出）。
> 主入口：`AGENTS.md` 规则 5（4 源 = Elo + The Odds API + Polymarket + LLM；改融合权重前先看 `js/odds-utils.js`）。

## 1. 4 个数据源

| Key | 来源 | 类型 | 更新机制 | 在前端 state 里的位置 |
|---|---|---|---|---|
| `h2h` | Elo 推演 | 内部计算 | 静态（依赖 `data/worldcup_2026.json`） | 不存 state，每次 `predictH2H(matchId)` 算 |
| `odds` | The Odds API | 外部 | Vercel Cron 抓 → Redis `odds:snapshot:the-odds-api` | `state.oddsSnapshots['the-odds-api']` |
| `poly` | Polymarket | 外部 | Vercel Cron 抓 → Redis `odds:snapshot:polymarket` | `state.oddsSnapshots.polymarket` |
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

Polymarket 走 Gamma API，**单场 h2h**（不是 outright）的事件结构：

```json
{
  "id": "poly-event-123",
  "slug": "fra-vs-bra-2026-06-15",
  "title": "France vs Brazil",
  "outcomes": "[\"France\", \"Brazil\"]",  // 字符串化的 JSON 数组
  "outcomePrices": "[\"0.55\", \"0.45\"]" // 字符串化的 JSON 数组
}
```

`outcomes` 和 `outcomePrices` 都是**字符串**的 JSON 数组，前端消费时 `JSON.parse` 一下：

```js
// js/worldcup.js
const outcomes = JSON.parse(polymarketEvent.outcomes);     // ["France", "Brazil"]
const prices   = JSON.parse(polymarketEvent.outcomePrices); // ["0.55", "0.45"]
```

**Polymarket h2h 通常只有主/客，没有平局**——`ensemblePredict` 里 `draw` 概率就 0 或来自其他源。

**Outright 单独 key**：`odds:snapshot:polymarket-outright`（注意带 `-outright` 后缀），结构是 `{ country: yesPrice }` 映射，给"冠军" Tab 用：

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
