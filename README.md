# 体彩数据工作台 · 大乐透 / 排列三分析与预测

纯前端单页应用：体彩超级大乐透 + 排列三历史开奖统计、多策略预测与复盘，并保留一套 2026 世界杯四源融合预测实现。

- 线上演示（GitHub Pages）：https://lrwei91.github.io/Lottery/
- 线上部署（Vercel，含 API / Cron）：https://ticai-taupe.vercel.app

---

## 项目特色

1. **零框架实现**：HTML5 + 原生 CSS + 原生 JavaScript，无构建步骤、无前端框架。`index.html` 直接打开即可运行。
2. **自研 Canvas 图表引擎**：`js/charts.js` 实现频率、遗漏、走势、奇偶比、大小比、和值分布等图表，原生适配高 DPI（Retina），带过渡动画。
3. **大乐透多策略预测**（默认 5 注，按历史复盘校准的固定顺序）：

   | 顺序 | 策略 | 内部 ID | 思路 |
   |------|------|----------|------|
   | 1 | 遗漏回补 | `gap` | 选处于极值遗漏区间的号码 |
   | 2 | 冷号优先 | `cold` | 选遗漏大、频次低的号码 |
   | 3 | 布林线策略 | `random` | 布林带约束 + 热号池 + 目标和值 |
   | 4 | 均衡推荐 | `balanced` | 按比例混合冷号、温号、热号 |
   | 5 | 热号优先 | `hot` | 追踪近期高频号码 |

   另有可选的 `danTuo` 胆码分层（`useDanLayer`），默认不占 5 注名额。大乐透后区独立按 `random / balanced / random / balanced / random` 映射，整注与后区对子均去重。

4. **元层信号调权**（`js/predictor.js`）：双窗口 trendScore（近 10 期 vs 近 50 期）、emergingHot 标记、区间聚集反向加权、区间/尾数/AC 聚集与反聚集权重、误杀预警 + 命中率回写校准、5 注置信度三档分层、后区观察层软排。
5. **大乐透专属 Conformal Prediction**（`js/dlt-conformal.js`）：旧数据训练 + 最近 20% holdout 校准，输出 `qhat` / `conformalHalfWidth` / `recentDrift` / `stabilityScore`，通过 `computeMetaWeight` 接入选号权重。
6. **跨端预测同步**：预测记录与复盘结果经 Vercel Functions 写入 Upstash Redis，同一设备 ID 的多端数据自动聚合，本地 `localStorage` 始终可离线使用。
7. **全自动数据更新**：GitHub Actions 定时抓取最新开奖，优先第三方接口、失败自动回退体彩官方接口。
8. **2026 世界杯实现（当前入口隐藏）**：Elo 上游模型 + The Odds API + Polymarket + LLM 四源融合，含因子拆解、Conformal 预测区间、赔率 24h 趋势。HTML / JS / 数据与 API 均完整保留，导航入口在 `css/workbench.css` 中统一 `display: none`，访问 `#worldcup` 回退到大乐透。

### 页面主要区块

最新开奖结果 · 下期开奖倒计时 · 近期开奖记录 · 中奖规则与奖级说明 · 历史开奖数据（搜索 / 年份筛选 / 分页）· 前后区频率 · 冷热号分布 · 遗漏值 · 奇偶比 · 大小比 · 和值分布 · 号码走势图 · 智能号码预测 · 预测记录与复盘 · 奖项智能核对 · 历史复盘记录

---

## 技术栈与文件结构

```text
Lottery/
├── index.html                    # 单页入口：静态结构 + 脚本加载顺序
├── package.json                  # npm 脚本入口
├── vercel.json                   # Functions 配置 + Cron（每天 UTC 00:00 刷新赔率）
├── .gitignore                    # 含 .env
├── .github/workflows/
│   ├── check.yml                 # PR / push 只读质量门禁（npm run check）
│   ├── update_data.yml           # 彩票数据更新（workflow_dispatch）
│   └── update_worldcup_matches.yml # 世界杯赛程快照每日刷新
├── css/
│   ├── style.css                 # 基础与历史样式
│   └── workbench.css             # 工作台视觉覆盖层（当前视觉基线，token 在此定义）
├── js/
│   ├── app.js                    # 主应用交互与状态机
│   ├── app-config.js             # 彩种静态配置、策略与置信度标签、状态工厂
│   ├── runtime.js                # Pages / Vercel 运行时判断与网络超时
│   ├── charts.js                 # 原生 Canvas 图表引擎
│   ├── predictor-config.js       # 大乐透 / 排列三不可变参数（Object.freeze）
│   ├── predictor.js              # 多策略选号、回测、元层信号
│   ├── dlt-conformal.js          # 大乐透专属 Conformal Prediction
│   ├── conformal.js              # 世界杯 Split Conformal（冠军区间 / H2H 预测集）
│   ├── factor_attribution.js     # 世界杯因子反事实归因
│   ├── kimi-benchmarks.js        # Kimi 2026 基准数据（20 模型集成 / MC 参数 / 校准矩阵）
│   ├── odds-utils.js             # devig / EV / Kelly 工具集
│   ├── cloud-sync.js             # 跨端记录同步 + 赔率/赛事拉取
│   ├── device-id.js              # 设备 ID 生成与读取
│   ├── device-panel.js           # 设备面板：ID + 二维码 + 手动绑定
│   ├── worldcup-data.js          # 世界杯数据访问层
│   └── worldcup.js               # 世界杯界面交互
├── data/
│   ├── lottery_data.json         # 大乐透历史开奖（约 2930 期）
│   ├── pl3_data.json             # 排列三历史开奖（约 7738 期）
│   ├── worldcup_2026.json        # 世界杯上游预测静态导出
│   ├── worldcup_matches.json     # 赛程 + 已结束比分（canonical，见下）
│   ├── worldcup_names.json       # 中英文名映射
│   ├── wc_llm_predictions.json   # LLM 单场预测
│   ├── wc_llm_outright.json      # LLM 冠军预测
│   ├── wc2026_squads_wikipedia.json / wc2026_players_processed.json
│   ├── venue_coords.json         # 场馆经纬度（天气查询用）
│   ├── kimi_2026_benchmarks.json / elo_cache_2026.json / match_cache.json
├── api/
│   ├── records.js                # 预测记录 GET/POST（按 deviceId）
│   ├── reviews.js                # 复盘结果 GET/POST
│   ├── matches.js                # 世界杯赛程快照读取（Redis）
│   ├── weather.js                # 场馆天气（Open-Meteo + Upstash 6h 缓存）
│   ├── odds/snapshots.js         # 当前赔率快照
│   ├── odds/history.js           # 赔率历史（24h 趋势）
│   ├── cron/sync-odds.js         # 每天拉取赔率 / 市场价格 / FIFA 赛程
│   ├── cron/sync-matches.js      # 赛程同步兼容入口
│   └── _lib/                     # http / redis / device-sync / worldcup-matches 共享实现
├── scripts/
│   ├── scraper.cjs / scraper_pl3.cjs / lottery_scraper_common.cjs   # 双源抓取
│   ├── sync_worldcup_upstream.py / sync_worldcup_matches.py       # 世界杯数据同步
│   ├── llm-predict.js            # LLM 世界杯预测（h2h / outright）
│   ├── cron_generate_daily_predictions.cjs  # 每日 5 注自动生成 + 云端写入
│   └── check-*.cjs               # check 门禁与环境诊断实现
├── docs/design-brief.md          # 视觉设计依据
├── AGENTS.md / CONTEXT.md        # 项目协作规则与上下文
└── agents/                       # LLM 预测 / Upstash / 世界杯数据子规则
```

> `data/worldcup_matches.json` 的 canonical writer 只有 `scripts/sync_worldcup_matches.py`。其他脚本发现比分滞后时应触发该脚本重生成后再提交，不要手改该文件。

---

## 本地运行

```bash
git clone https://github.com/lrwei91/Lottery.git
cd Lottery

npm run dev            # npx -y serve . ，默认 http://localhost:3000
```

也可以用任意静态服务器打开 `index.html`。

### 手动更新数据

```bash
npm run scrape:all                 # 大乐透 + 排列三
DRY_RUN=1 npm run scrape:all       # 只验证抓取，不写数据文件
npm run sync:worldcup:all          # 世界杯上游数据 + 赛程比分
```

第三方主源需要 `JISU_API_KEY`（兼容 `JISU_APPKEY`）；未配置时脚本自动走体彩官方副源。

### 质量门禁

```bash
npm run check
```

覆盖 JS / Python 语法、JSON 数据契约、API 与 Redis 封装、前端运行时降级、大乐透 Conformal 覆盖率与 5 注合法性、排列三固定 seed 与跨彩种状态隔离。只改文档时至少执行 `git diff --check`。

环境变量诊断：

```bash
npm run env:check            # 只读本地 process.env，分级列出缺失项
npm run env:check:vercel     # 附带 Vercel Dashboard 配置位置提示
npm run env:check:strict     # 推荐项缺失也判失败
```

---

## 自动化数据更新

- **彩票数据**：`update_data.yml` 通过 `workflow_dispatch` 触发（外部调度器每天北京时间 21:36 推送；大乐透周一、三、六 21:25 开奖，排列三每天 21:25 开奖，21:36 可拿到完整官方数据）。工作流优先用 `JisuAPI`，失败切官方接口，校验通过后**只提交** `lottery_data.json` 和 `pl3_data.json`。
- **世界杯赛程**：`update_worldcup_matches.yml` 每天 UTC 19:12 跑 `sync_worldcup_matches.py`，有变化才提交 `worldcup_matches.json`。
- **赔率与市场价格**：`vercel.json` 的 Cron 每天 UTC 00:00 触发 `/api/cron/sync-odds`（Hobby 计划每天仅允许 1 个 cron，升级 Pro 后可加密频率）。
- **防缓存**：前端请求附带时间戳参数，避免浏览器缓存导致数据延迟。

### 需要的密钥

| 变量 | 位置 | 用途 |
|------|------|------|
| `JISU_API_KEY` | GitHub Actions Secrets / 本地 env | 彩票抓取第三方主源 |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Vercel Storage → Marketplace → Upstash Redis | 跨端同步、赔率快照、天气缓存 |
| `ODDS_API_KEY` | Vercel env | The Odds API 赔率 |
| `FOOTBALL_DATA_API_KEY` | Vercel env | FIFA 赛程与比分 |
| `XIAOMI_API_KEY` | 本地 env / Bitwarden | LLM 预测（xiaomi provider） |
| `LLM_PROVIDER` | 本地 env | `ollama` / `openai` / `xiaomi` |

`POLYMARKET_PUBLIC_ENABLED=true` 可开启公开的 Polymarket 源（无需 key）。未配置的数据源在同步时记为 `skipped`，前端走静态数据兜底。`.env` 已在 `.gitignore`，任何密钥都不入库。

---

## 跨端预测同步

用于让「每周比对预测 vs 实际开奖」有完整样本。任意浏览器、任意设备，只要设备 ID 相同，数据自动聚合。

| 端 | 存储 |
|----|------|
| 本机 | `localStorage`（最近 20 条预测 + 策略缓存） |
| 云端 | Upstash Redis（`device:<deviceId>:*` 命名空间，Sorted Set 按时间裁剪） |

- 本地写入后异步推云端（fire-and-forget，不阻塞 UI），启动时从云端拉取增量并 merge
- 复盘结果以 `recordId::strategy::issue` 为 key 天然去重；读取时兼容合并旧版 key
- 云端失败只 `console.warn`，本地功能照常运行
- 面板入口：header 右上角 **设备** 按钮，显示当前 ID、二维码、复制与手动绑定
- **不存**账号、邮箱或任何身份信息；策略统计与进化仍在本机跑

| 方法 | 路径 | 用途 |
|------|------|------|
| `GET` | `/api/records?deviceId=xxx` | 拉取该设备的预测记录 |
| `POST` | `/api/records` `{ deviceId, record }` | 写入一条预测 |
| `GET` | `/api/reviews?deviceId=xxx` | 拉取该设备的复盘结果 |
| `POST` | `/api/reviews` `{ deviceId, review }` | 写入一条复盘 |

> Vercel KV 已 deprecated，新项目走 Marketplace 的 Upstash Redis integration，代码同时兼容 `KV_REST_API_*` 旧变量名。改完 env 不会自动重新部署，需要 `vercel deploy --prod` 或在 Dashboard 点 Redeploy。

### 每日自动出注

`scripts/cron_generate_daily_predictions.cjs` 用 vm 沙箱加载浏览器端 predictor 脚本，生成当日 5 注并 POST 到 `/api/records`，同时归档到 `scripts/logs/daily-predictions/`。`--dry-run` 只生成不写入云端。

---

## LLM 预测（GitOps）

跑预测 → 写 `data/wc_llm_*.json` → commit / push → Vercel 自动部署 → 前端对战卡片显示 `🤖 [胜平负] [概率]`。

```bash
npm run llm:predict:xiaomi:dry   # 先干跑，确认输出合理
npm run llm:predict:xiaomi       # h2h + outright
npm run llm:predict              # 只跑 h2h
npm run llm:predict:outright     # 只跑冠军预测
npm run llm:predict:all          # 两者串行
```

Provider 通过 `LLM_PROVIDER` 切换（`ollama` / `openai` / `xiaomi`），不设时按 endpoint 自动识别。API key 只从环境变量或 `.env` 读取，不硬编码。详细协议见 `agents/llm-predict.md`。

---

## 赔率计算工具

`js/odds-utils.js`（`window.OddsUtils`）提供：

- `devig.proportionalDevig(outcomes)` — 按比例去水
- `devig.fairProbsFromPrices(prices)` — 冠军市场一键去水
- `ev.expectedValue(odds, prob)` / `ev.edge(model, market)` — 期望值与净市场偏离
- `kelly.fractionalKelly(odds, prob, 0.25)` — 1/4 Kelly 仓位

`sync-odds.js` 每次拉取 The Odds API 后向 Redis list 追加一个时间点（保留最近 28 个点，TTL 35 天），前端据此展示赔率 24h 变化。数据不足时显示「数据累积中」。

---

## 视觉与兼容约定

- 视觉基线：白纸、黑墨、荧光黄（唯一品牌强调色）+ 32px 网格。彩票球红蓝、成功/警告/错误继续作为业务语义色。
- 只提供浅色模式，根节点固定 `color-scheme: light`；无深色模式、无颜色偏好持久化、无模式选择器。
- 常态表面用实底 + 细边框，阴影仅用于可交互悬停、浮层与模态框；状态不只靠颜色表达。
- 动效仅用于首屏编排、面板一次性揭示与按压反馈；`prefers-reduced-motion: reduce` 下直接呈现最终状态。
- JS 失效时静态内容仍可读，加载反馈采用延迟出现的非阻塞状态条。
- 验收视口：320 / 390 / 768 / 1024 / 1440px，含键盘、触屏、200% 缩放与 JS 禁用场景；表格允许容器内横向滚动，页面本身不横向溢出。

详细依据见 `docs/design-brief.md`。

---

## 免责声明

本项目为体彩超级大乐透与排列三数据分析与概率研究工具，图表展示及预测结果均基于历史公开数据计算。彩票开奖号码纯属随机，任何预测策略都不能保证中奖。请理性购彩，量力而行，仅作数据研究与娱乐参考之用。
