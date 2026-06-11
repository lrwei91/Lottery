# 🎱 超级大乐透 & 排列三 · 数据分析与智能预测

体彩可视化分析 + 2026 世界杯预测（冠军概率 / 对战预测 / 4 源融合 / LLM 视角）。

**🚀 演示地址**：[https://lrwei91.github.io/Lottery/](https://lrwei91.github.io/Lottery/) *(开通 GitHub Pages 后可用)*

---

## 🌟 项目特色

1. **🚀 纯原生高性能实现**：零框架依赖，仅使用 HTML5、纯 CSS 设计系统与原生 JavaScript 构建，极致流畅。
2. **📈 自研 Canvas 图表引擎**：开发了 6 个不同维度的图表组件（出现频率、号码遗漏、号码走势、奇偶大小比率、和值分布及正态拟合），原生适配高 DPI (Retina) 屏幕，支持流畅过渡与页面切换。
3. **🔮 5大智能预测策略**：
   - ❄️ **冷号优先**：推荐遗漏大、频次低的号码，降低撞号概率，提升潜在独享奖金概率。
   - 🔥 **热号优先**：追踪近期高频号码走势。
   - ⚖️ **均衡推荐**：完美按比例混合冷号、温号与热号。
   - 📊 **遗漏回补**：侧重推荐处于极值遗漏区间、回补概率高的号码。
   - 📉 **布林线策略**：参考布林线策略，按近 50 期前/后区和值趋势、热号池与目标和值约束生成推荐。
4. **📅 全自动数据流更新**：配置了 GitHub Actions 自动化工作流，优先使用第三方实时接口，失败时自动切换体彩官方接口，尽量更快地同步最新开奖数据。
5. **⚽ 2026 世界杯一级 Tab**：迁入 `mikobinbin/2026-world-cup-predictor` 的静态预测结果，与超级大乐透、排列三同级。提供：
   - **冠军概率** tab：上游 Elo 模型 + Polymarket 冠军 outright 4 源融合、价值 picks、AI 视角（LLM top 8 对比）
   - **对战表** tab：每场未来比赛右上角显示 4 源融合胜率（紫蓝渐变 🏆）+ The Odds API 赔率（暖色 💰）
   - **因子拆解** / **玄学分析** / **球队阵容**：静态展示各队模型输入
   - **4 源融合**（每场 modal）：Elo + The Odds API + Polymarket + LLM 按权重融合

---

## 📂 文件结构

```text
Lottery/
├── index.html                    # 仪表盘主页面
├── package.json                  # 项目配置文件
├── .gitignore                    # Git 忽略配置（含 .env）
├── .github/
│   └── workflows/
│       └── update_data.yml       # GitHub Actions 每日自动更新脚本
├── css/
│   └── style.css                 # 现代深色系毛玻璃设计系统
├── js/
│   ├── app.js                    # 主应用交互与状态机管理
│   ├── charts.js                 # 原生 Canvas 图表绘制引擎
│   ├── predictor.js              # 多策略号码预测与回测计算核心
│   ├── odds-utils.js             # devig / EV / Kelly 工具集
│   ├── cloud-sync.js             # 跨端预测同步 + 赔率/赛事拉取
│   └── worldcup.js               # 2026 世界杯预测 Tab 交互
├── data/
│   ├── lottery_data.json         # 2875+ 期历史大乐透开奖全量数据
│   ├── pl3_data.json             # 排列三历史开奖数据
│   ├── worldcup_2026.json        # 世界杯预测静态导出数据
│   ├── worldcup_matches.json     # 世界杯赛程 + 已结束比分
│   ├── worldcup_names.json       # 中英文名映射
│   ├── wc_llm_predictions.json  # LLM h2h 单场预测（git tracked）
│   └── wc_llm_outright.json      # LLM 冠军 outright 预测（git tracked）
├── api/
│   ├── records.js                # 跨端预测记录 同步/拉取
│   ├── reviews.js                # 跨端复盘结果 同步/拉取
│   ├── cron/sync-odds.js         # Vercel Cron：3 数据源统一抓取 + 累积历史
│   ├── odds/snapshots.js         # 前端拉取当前赔率快照
│   └── odds/history.js           # 前端拉取赔率历史（24h 趋势用）
├── scripts/
│   ├── lottery_scraper_common.js # 双源抓取公共逻辑
│   ├── scraper.js                # 大乐透双源抓取脚本 (Jisu 主 / 官方副)
│   ├── scraper_pl3.js            # 排列三双源抓取脚本 (Jisu 主 / 官方副)
│   └── llm-predict.js            # 本地/云端 LLM 跑世界杯预测（h2h + outright）
└── vercel.json                   # Vercel 部署 + Cron 配置
```

---

## 🛠️ 本地运行

1. 克隆本项目到本地：
   ```bash
   git clone https://github.com/lrwei91/Lottery.git
   cd Lottery
   ```
2. 启动本地开发服务器：
   ```bash
   # 使用 package.json 脚本（一键启动并自动处理端口）
   npm run dev
   ```
   或者直接用任意静态服务工具打开 `index.html`。
3. 访问本地服务：`http://localhost:3000` (或控制台输出的对应端口)。
4. 手动更新数据：
   ```bash
   npm run scrape:all
   ```
   如需优先走第三方主源，请先配置 `JISU_API_KEY`。
   验证抓取但不写入数据文件时，可使用 `DRY_RUN=1 npm run scrape:all`。

---

## 🤖 自动化数据更新

项目通过 **Hermes Bot** 外部调度 + GitHub Actions 实现自动化数据更新：
- **触发方式**：Hermes Bot 每天北京时间 **21:36** 定时推送（大乐透在周一、三、六晚上 21:25 开奖，排列三每天 21:25 开奖，21:36 即可获取完整官方开奖数据），通过 `workflow_dispatch` 触发 GitHub Actions 工作流。
- **运行机制**：工作流启动 Node.js 环境，优先使用 `JisuAPI` 拉取最新开奖；若未配置 `JISU_API_KEY` 或主源失败，则自动切换到体彩官方接口，随后合并进本地 `data/*.json` 并自动提交。
- **防缓存机制**：前端请求自动附加时间戳参数，确保每次加载都能获取最新开奖数据，避免浏览器缓存导致的数据延迟。
- **免维护**：无需本地部署和手动抓取，数据始终保持最新。

### 第三方主源配置

- **GitHub Actions / Hermes**：在仓库 Secrets 中配置 `JISU_API_KEY` 即可启用第三方实时接口主源。
- **本地运行**：可设置环境变量 `JISU_API_KEY`（或兼容变量名 `JISU_APPKEY`）。
- 若未配置该密钥，脚本会直接跳过第三方主源，改走体彩官方副源。

---

## ⚠️ 免责声明

*本项目为体彩超级大乐透数据分析与概率研究工具，图表展示及预测结果均基于历史公开数据计算。彩票开奖号码纯属随机，任何预测策略都不能保证 100% 中奖。请理性购彩，量力而行，仅作数据研究与娱乐参考之用。*

---

## ☁️ 跨端预测同步（Upstash Redis via Vercel Marketplace）

为了让"每周比对预测 vs 实际开奖"有完整样本，预测记录和复盘结果可以同步到云端。
任意浏览器、任意设备，只要使用同一个 **设备 ID**，数据就会自动聚合。

### 为什么是 Upstash Redis

Vercel KV 已被官方 deprecated（[迁移公告](https://vercel.com/changelog/vercel-kv-is-being-deprecated-in-favor-of-upstash-redis)），新项目必须通过 **Vercel Marketplace** 装 **Upstash Redis** integration，接口和 KV 几乎一致。

### 工作原理

| 端 | 存储 |
|----|------|
| 本机 | `localStorage`（最近 20 条预测 + 策略缓存，永远是真相的子集） |
| 云端 | Upstash Redis（每个 deviceId 下最近 200 条预测 + 1000 条复盘） |

- 本地写入后**异步**推到云端（fire-and-forget，不阻塞 UI）
- 启动时从云端**拉取并 merge** 增量到本地
- 复盘结果用 `recordId::strategy::issue` 当 key 天然去重
- 云端调用失败只 `console.warn`，本地逻辑照常运行

### 一键配置（Vercel Dashboard）

1. 进入 Vercel 项目 → **Storage** → **Marketplace** → 搜索 **Upstash Redis** → **Add Integration**
2. 选本项目并授权，Vercel 会自动注入两个环境变量：
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
3. 重新部署（push 一次代码 / 触发 deploy hook 即可）

### 跨端绑定

- 首次访问任意一台设备，会自动生成 UUID 存 `localStorage`（key: `ticai_device_id`）
- 点击 header 右上角 **设备** 按钮，看到当前 ID + 二维码
- 另一台设备点击同一按钮，**手动绑定** → 粘贴对方的 ID → 刷新
- 两端数据自动合并

### API 端点

| 方法 | 路径 | 用途 |
|------|------|------|
| `GET`  | `/api/records?deviceId=xxx`  | 拉取该设备的预测记录 |
| `POST` | `/api/records`  `{ deviceId, record }` | 写入一条预测 |
| `GET`  | `/api/reviews?deviceId=xxx`  | 拉取该设备的复盘结果 |
| `POST` | `/api/reviews`  `{ deviceId, review }` | 写入一条复盘 |

### 离线/未接 Upstash 时的行为

- 按钮仍可点，所有本地功能（生成预测、回测、复盘、策略进化）正常
- 控制台会看到 `[cloud] 拉取预测记录异常（Upstash 未接或网络问题，本地数据不受影响）` 提示
- 一旦 Upstash 接好，下一次刷新自动生效

### 不做什么

- ❌ 不存账号 / 邮箱 / 任何身份信息
- ❌ 不会主动跟其他用户的 ID 混在一起
- ❌ 策略统计/进化仍在本机跑（云端只存语料，后续可以迁移）


---

## 🤖 LLM 预测（GitOps：本地 LLM → JSON → Vercel 自动部署）

LLM 跑预测 → 写 `data/wc_llm_predictions.json` → git push → Vercel 部署自动包含 → 前端加载后在每场对战卡片显示 `🤖 [胜平负] [概率]` badge。

### Provider 三选一

脚本通过 `LLM_PROVIDER` 切换：

| Provider    | 协议                | 默认 endpoint                          | 默认 model       | API key  |
|-------------|--------------------|----------------------------------------|------------------|----------|
| `ollama`    | Ollama chat        | `http://localhost:11434/api/chat`      | `llama3.2`       | 不需要   |
| `openai`    | OpenAI 兼容        | `http://localhost:1234/v1/chat/completions` | `gpt-4o-mini` | `XIAOMI_API_KEY`（Bearer） |
| `xiaomi`    | **Anthropic 协议** | `https://token-plan-cn.xiaomimimo.com/anthropic` | `mimo-v2.5-pro` | `XIAOMI_API_KEY`（`x-api-key` header） |

不设 `LLM_PROVIDER` 时，脚本会按 endpoint URL 自动检测（`xiaomimimo.com` / `/anthropic` → xiaomi；`:11434` / `/api/chat` → ollama；`/v1/chat/completions` → openai）。

### 配置 API key（不入 git）

**三种方式（任选一）：**

1. **环境变量**（最简单，BWS 统一读）：
   ```bash
   # 一次性注入到当前 shell（推荐）
   # 注: 真值只通过 BitwardenSecrets().get() 返回,CLI 输出会脱敏
   export XIAOMI_API_KEY=$(python3 -c "import sys; sys.path.insert(0, '$HOME/.hermes/scripts'); from bw_secrets import BitwardenSecrets; print(BitwardenSecrets().get('XIAOMI_API_KEY') or '')")
   npm run llm:predict:xiaomi
   ```

2. **`.env` 文件**（项目根或 `scripts/` 目录均可，`.env` 已在 `.gitignore`）：
   ```bash
   # /ticai/.env
   LLM_PROVIDER=xiaomi
   XIAOMI_API_KEY=***
   LLM_MAX_TOKENS=***
   ```

3. **临时 inline**：
   ```bash
   LLM_PROVIDER=xiaomi XIAOMI_API_KEY=*** npm run llm:predict:xiaomi
   ```

> **2026-06-12 更新**：环境变量名从 `LLM_API_KEY` 改名为 `XIAOMI_API_KEY`（更明确当前唯一 provider）。
> 推荐从 BWS 统一读，避免 .env 真 key 误入 git。

### 跑预测

脚本支持两种 mode（用 `npm run` 第二个参数或 `node` 直接传）：

| Mode           | 输出文件                          | 说明                              |
|----------------|----------------------------------|----------------------------------|
| `h2h`（默认）  | `data/wc_llm_predictions.json`   | 24 场未来比赛的胜平负概率           |
| `outright`     | `data/wc_llm_outright.json`      | 48 队冠军概率（含 4 源融合对比用）   |
| `all`          | 两个都跑（h2h + outright 串行）  | 一键跑全                          |

```bash
# 路径 A：本地 Ollama（零成本、零联网）
ollama pull qwen2.5            # 或 llama3.2 / mistral
ollama serve
npm run llm:predict            # 只跑 h2h
npm run llm:predict:all        # 跑 h2h + outright

# 路径 B：任意 OpenAI 兼容 endpoint
LLM_PROVIDER=openai \
  LLM_BASE_URL=https://api.openai.com \
  LLM_MODEL=gpt-4o-mini \
  XIAOMI_API_KEY=sk-xxxxx \
  npm run llm:predict:all

# 路径 C：小米 MiMo（Anthropic 协议，走 token-plan）
npm run llm:predict:xiaomi        # = llm:predict:all + provider=xiaomi
npm run llm:predict:outright      # 只跑冠军预测
npm run llm:predict:xiaomi:dry    # 干跑（不写文件，先看输出）
```

### 推到云端

```bash
# 跑了哪个 mode 就 add 哪个文件
git add data/wc_llm_predictions.json data/wc_llm_outright.json
git commit -m "chore: refresh LLM predictions ($(date +%Y-%m-%d))"
git push origin main
```

Vercel 会自动部署，浏览器刷新就能看到：
- 对战卡片右上角多出 `🏆 国名 X%` 紫蓝渐变徽章（4 源融合胜率）
- 冠军 tab → 冠军概率 → 滚到底有 "🤖 AI 视角（LLM top 8 vs 上游 + 市场）" 面板

### 输出格式

`data/wc_llm_predictions.json`（h2h）：

```json
{
  "generatedAt": "2026-06-07T...",
  "provider": "xiaomi",
  "model": "mimo-v2.5-pro",
  "endpoint": "https://token-plan-cn.xiaomimimo.com/anthropic/v1/messages",
  "temperature": 0.3,
  "mode": "h2h",
  "matchCount": 24,
  "predictions": [
    {
      "matchId": "400021443",
      "homeWinProb": 0.45,
      "drawProb": 0.25,
      "awayWinProb": 0.30,
      "predictedOutcome": "home",
      "confidence": 0.55,
      "reasoning": "法国主场 + Elo 高 50 分"
    }
  ]
}
```

`data/wc_llm_outright.json`（outright 冠军）：

```json
{
  "generatedAt": "2026-06-07T...",
  "provider": "xiaomi",
  "model": "mimo-v2.5-pro",
  "mode": "outright",
  "countryCount": 48,
  "llmProvided": 48,
  "fallbackFilled": 0,
  "predictions": [
    { "country": "France", "winProb": 0.1442, "rank": 1, "reasoning": "修正 Elo 最高..." },
    { "country": "Brazil", "winProb": 0.1346, "rank": 2, "reasoning": "传统足球王国..." }
  ]
}
```

> 如果 LLM 输出少于 48 队，脚本会按 Elo 衰减补齐（`fallbackFilled > 0` 时可见），归一化到总和=1。

### 实时数据接入（Polymarket / The Odds API / football-data.org）

云端模式用 Vercel Cron **每天 UTC 0:00** 拉一次真实数据，写 Upstash Redis，前端 `/api/odds/snapshots` 拉取。

> **Vercel Hobby 计划限制**：每天最多 1 个 cron 触发，所以 cron 表达式锁死为 `0 0 * * *`。如果你升级到 Pro，可改成 `0 */6 * * *`（每 6 小时一次），所有源会自动累积更高频历史。

#### 数据源

| Source              | Tag / 字段                                | 是否需要 API key | 用途                                 |
|---------------------|-------------------------------------------|------------------|--------------------------------------|
| `polymarket`        | `tag_id=102467`（体育赛事 h2h 单场）      | ❌（公开）       | 单场胜平负市场                        |
| `polymarket-outright` | `tag_id=100350`（World Cup Winner 独立二元） | ❌（公开）     | 48 国冠军 outright 隐含概率         |
| `the-odds-api`      | `soccer_fifa_world_cup` markets h2h+spreads+totals | ✅ `ODDS_API_KEY` | 44 家博彩公司赔率 + 累积历史       |
| `football-data`     | `competitions/2000` (FIFA World Cup)      | ✅ `FOOTBALL_DATA_API_KEY` | 赛程 + 比分（**无赔率**）       |

#### Vercel 环境变量

```bash
# 必需
UPSTASH_REDIS_REST_URL       # Vercel Marketplace → Upstash Redis 自动注入
UPSTASH_REDIS_REST_TOKEN     # 同上

# 任一数据源（未配 = skipped）
ODDS_API_KEY=04cbda6a8f9303af709cdf4730d096bc
FOOTBALL_DATA_API_KEY=614ebfc84a9b4020873ffab39d6849f6
POLYMARKET_PUBLIC_ENABLED=true
# POLYMARKET_TAG_ID=102467               # 默认值，单场 h2h
# POLYMARKET_OUTRIGHT_TAG_ID=100350      # 默认值，冠军 outright
# POLYMARKET_OUTRIGHT_LIMIT=100          # 默认值

# football-data 时间窗口（默认覆盖整届世界杯正赛 6/1~7/31）
# FOOTBALL_DATA_DATE_FROM=2026-06-01
# FOOTBALL_DATA_DATE_TO=2026-07-31
```

未配置某源时对应源 `skipped`，前端冠军 tab 走静态 `POLY_WINNER` 兜底。

#### API 端点

| 方法 | 路径                                | 用途                                  |
|------|-------------------------------------|---------------------------------------|
| `POST` | `/api/cron/sync-odds`             | Vercel Cron 调用，拉所有源 + 累积历史 |
| `GET`  | `/api/cron/sync-odds?source=xxx`  | 手动触发单个源（`polymarket`/`polymarket-outright`/`the-odds-api`/`football-data`） |
| `GET`  | `/api/odds/snapshots`             | 前端拉取当前 4 源最新快照             |
| `GET`  | `/api/odds/history?source=the-odds-api` | 拉取最近 28 个时间点（24h 趋势用） |

#### 赔率历史与 24h 趋势

`sync-odds.js` 在每次拉取 `the-odds-api` 后**追加**一个时间点到 `odds:history:the-odds-api`（Redis list），LTRIM 保留最近 28 个点，TTL 7 天。

前端在每场未来比赛 modal 顶部下方显示"📈 赔率 24h 变化"段：

```
📈 赔率 24h 变化 | 主胜 1.50 → 1.43 | 平 4.20 → 4.33 | 客胜 7.50 → 7.75 | 主 -0.07
```

数据不足时（首次部署后 < 24h）显示"数据累积中（当前 N / 至少 2 个时间点）"。

### 赔率计算工具

`js/odds-utils.js`（`window.OddsUtils`）提供：
- `devig.proportionalDevig(outcomes)` — 按比例去水
- `devig.fairProbsFromPrices(prices)` — 32 国冠军市场一键去水
- `ev.expectedValue(odds, prob)` — 期望值
- `ev.edge(model, market)` — 模型 vs 净市场偏离
- `kelly.fractionalKelly(odds, prob, 0.25)` — 1/4 Kelly 仓位

世界杯「冠军概率」tab 已用上：上游模型（60%）+ Polymarket outright（40%）双源融合 → 价值 picks（model vs market edge × Kelly¼ 仓位）+ 48 队排行榜 + AI 视角（LLM top 8 对比）。
