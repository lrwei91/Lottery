# AGENTS.md — ticai (体彩大乐透 / 排列三 / 2026 世界杯预测)

> 这是给所有 AI 代理（OpenCode / Codex / Cursor / Aider / Devin / Gemini CLI 等）看的项目规则。
> 任何 agent 在这个项目里动手前，**必须先读这个文件**，再读它 `@import` 的子文件。

## 项目速览

- **是什么**：纯前端单页应用，体彩超级大乐透 + 排列三历史开奖分析与 5 大策略预测；附带 2026 世界杯预测 Tab（Elo + The Odds API + Polymarket + LLM 四源融合）。
- **技术栈**：零前端框架，纯 HTML5 + CSS + 原生 JS。Canvas 自研图表引擎。Node.js scripts 跑爬虫，Python scripts 同步世界杯上游数据。
- **部署**：GitHub Pages（演示）+ Vercel（API/CRON 跑赔率抓取）。
- **存储**：Vercel Storage → Upstash Redis（REST），环境变量 `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`。
- **关键数据文件**（都在 `data/`，JSON）：
  - `lottery_data.json` / `pl3_data.json`：历史开奖
  - `worldcup_2026.json` / `worldcup_matches.json` / `worldcup_names.json`：世界杯上游预测 + 赛程
  - `wc_llm_predictions.json` / `wc_llm_outright.json`：LLM 单场 / 冠军预测（**git tracked**）
- **owner 规则（worldcup_matches.json）**：
  - canonical writer 只有 `scripts/sync_worldcup_matches.py`
  - 其他脚本如果发现比分滞后，可以**触发**这个脚本重生成后再 commit/push `data/worldcup_matches.json`
  - **不要**手改 `worldcup_matches.json` 再 `git add data/`，这会把同仓库其它数据改动一并打包，最容易在 `pull --rebase` 时撞冲突

## 已知规则（每次必读 / 必须遵守）

### 1. 隐私与凭据
- **绝不** 把 `.env` 里的内容贴到聊天、commit、issue、PR 描述里。`.env` 已在 `.gitignore` 里，但 agent 读文件时仍然要避免在输出里引用其内容。
- 如果需要某个 env 变量名（不是值），可以直接说（比如 `UPSTASH_REDIS_REST_URL` 是公开的变量名）。
- 涉及 API key / token / 私钥的代码改动，**只在 `.env` 里加变量**，不要硬编码到 JS 里。

### 2. Vercel + Upstash 习惯
- 不要再装或推荐 `@vercel/kv`（已 deprecated，2025 起官方迁到 Upstash）。代码用 `@upstash/redis`。
- 兼容写法：先读 `UPSTASH_REDIS_REST_*`，读不到再回退 `KV_REST_API_*`。
- Storage → Connect Database 改完 env **不会自动 re-deploy**，要么 `vercel deploy --prod`，要么在 Dashboard 点 Redeploy。
- 验证 env 是否生效的快速方法：curl 部署后的 `/api/xxx`，500 错误信息里如果还报 "Missing required environment variables" 就是没注入。

### 3. 项目结构约定
- 新增前端逻辑：放 `js/`，命名小写连字符（参考 `odds-utils.js` / `cloud-sync.js`）。
- 新增 API endpoint：放 `api/`（Vercel Functions 自动识别），文件名就是路径。
- 新增 Python 脚本：放 `scripts/`，同步类加前缀 `sync_`。
- 修改 `worldcup_matches.json` 相关逻辑时，优先改 `scripts/sync_worldcup_matches.py`，不要在多个脚本里复制一份“手改比分字段”的逻辑。
- 新增爬虫：放 `scripts/`，Node.js 走 `node scripts/xxx.js`，命名 `scraper_*.js`。
- 数据文件：JSON 放 `data/`，名字用蛇形。

### 4. LLM 预测脚本习惯
- 跑预测先看 `package.json` 的 `llm:predict*` 脚本。
- **默认先 dry run**：`DRY_RUN=1 node scripts/llm-predict.js <h2h|outright|all>`，确认输出合理再真跑。
- Provider 切换走环境变量 `LLM_PROVIDER`（`ollama` / `openai` / `xiaomi`），不要改代码。
- 预测结果**写回 `data/wc_llm_*.json`**（这两个是 git tracked 的，不要写到 `/tmp` 或其他位置）。

### 5. 赔率 / 数据源
- 4 个数据源：**Elo 模型上游**、**The Odds API**、**Polymarket**、**LLM**。
- 抓取脚本是 `api/cron/sync-odds.js`（Vercel Cron），别手动 `curl` 模拟。
- 改融合权重前先看 `js/odds-utils.js` 的 `devig` / `EV` / `Kelly` 工具函数，别自己重写。

### 6. 大乐透元层信号（v2026-06-22 增强）
- 9 个新增元层信号/能力集中在 `js/predictor.js`（IIFE 内）和 `js/dlt-conformal.js`：
  - 双窗口 trendScore（近 10 vs 近 50）+ emergingHot 标记（`computeScores.scoreZone`）
  - `computeTransitionSignal` — 区间聚集反向加权
  - `detectBias` — 区间/尾数/AC 聚集 + 反聚集权重
  - `computeOverKillWarn` + `calibrateOverKill` + `getOverKillRuntime` — 误杀预警 + 命中率回写
  - `selectWithDanLayer` — 胆码分层选号
  - `tagPredictionsWithConfidence` + `computeMinScoreForPrediction` — 5 注置信度 3 档分层
  - `BACK_SOFT_KILL_DEFAULT` — 后区观察层软排（默认开启）
- 列表 5 注策略顺序：第 1 注 = 胆码分层 (danTuo)，后 4 注 = balanced/random/gap/hot/cold 轮转（`buildStrategyOrder`）
- `generatePrediction` 新增 `backSoftKill` / `useDanLayer` 选项；返回里多 `meta` 字段（overKillHit / transitionSignalApplied / biasDetected / backSoftKill / useDanLayer）
- `generateMultiplePredictions` 输出里每注带 `confidence: 'high'|'balanced'|'aggressive'` + `minScore`
- 误杀预警阈值存在 `_overKillRuntime`，由 `app.js` 的 `backtestOverKillHitRate` 在每期复盘时回写校准
- `js/dlt-conformal.js` 是大乐透专属 Conformal Prediction：用 Wilson score 算 90% CI，暴露 `DltConformal.generateReport(data)`（仅展示性，目前未接入选号权重）

### 7. 测试
- 跑 `npm run dev`（`npx -y serve .`）起本地静态服务。
- API 本地测：`vercel dev`（Vercel CLI）。注意 Vercel dev 跟生产 env 注入逻辑一样，连了 Storage 才会有 Upstash 变量。
- 数据更新：`npm run scrape:all` 或 `npm run sync:worldcup:all`。

## @import 子规则文件

按需加载（不要无脑全读）：

- `agents/llm-predict.md` — LLM 预测脚本协议细节、Provider 切换、prompt 模板、输出 JSON 校验
- `agents/upstash.md` — Upstash Redis 客户端封装、env 变量兼容写法、跨端同步 API 拓扑
- `agents/worldcup-data.md` — 4 源融合权重、The Odds API / Polymarket 字段映射、改权重 checklist

## 变更日志

- 2026-06-27：大乐透代码审查修复 + DltConformal 接入选号权重。`js/predictor.js`：
  - **Bug 修复 1**：`generateMultiplePredictions` fallback 循环（兜底用）补 `seen` 去重，避免主循环 125 次没凑齐时产生重复注
  - **Bug 修复 2**：`_overKillRuntime` 校准结果持久化到 `ticai.overKillRuntime`（之前刷新页面归零）；新增 `loadOverKillRuntime()`，IIFE 启动时立即加载
  - **P1**：`DltConformal`（Wilson 90% CI）接入 `computeMetaWeight` —— 新增 `META_WEIGHT_CONFIG.conformalLowThreshold=0.05` / `conformalHighThreshold=0.15` / `conformalBoost=0.05` / `conformalPenalty=-0.05`；每个号码的 `conformalHalfWidth` 注入到 score，CI 半宽 < 0.05（稳定）升权 +0.05，> 0.15（不确定）降权 -0.05；`computeScores` 内加 `_conformalCache` 避免每次重算；只在 DLT 启用（PL3 无后区跳过）
  - **P3**：注释修正（`tagPredictionsWithConfidence` 注释"1/3 1/3 1/3"对 count=5 实际是 1/2/2；`selectByStrategy` balanced 分支硬编码 0.3/0.3/0.3 加注释说明是黄金比例抽样简化，与 `STRATEGY_WEIGHTS.balanced` 区分）。`js/app.js`：
  - **Bug 修复 3**：`backtestOverKillHitRate` 加 `recordId::baseIssue` 幂等键（写 `ticai.overKillBacktestedKeys`），防止同一 record 在多设备通过 cloud-sync 各自回测导致 `ticai.overKillStats` 双倍计数
- 2026-06-23：复盘驱动的策略优化（针对 95 条 review × 7 期开奖）。`js/predictor.js`：
  - `defaultFrontConstraints`：`sumMin: 63→60, sumMax: 107→110`（避免和值 65 的 26065 类被约束死），新增 `minTailPairs` 字段
  - `computeFrontConstraints`：动态算 `minTailPairs`（30% 分位，鼓励同尾）
  - `evaluateFrontCombination`：加 `minTailPairs` 检查
  - `hotColdAnalysis`：阈值 1.15/0.85 → **1.5/0.5**（让 hot/cold 策略选到真正差异化号码）
  - 新增 `computeRecentFrequency(data, dataEnd, opts)`：近 20 期前区 / 近 30 期后区的短期表现信号，0 出现/严重偏少 → 降权（消解 31/18/11 前区黑洞和 9/6 后区黑洞）
  - 新增 `RECENT_FREQ_CONFIG`：absentPenalty=0.5 / underHalf=0.7 / underThird=0.85 / overHotBoost=1.15
  - 新增 `getStyleBoost(strategy, s)`：hot 选热号 +50%，cold 选冷号 +50%，gap 选遗漏大号 +40%（让 5 策略风格差异化生效）
  - `computeMetaWeight`：纳入 `recentFreqWeight` 维度（仍加性 + clamp 到 [-0.40, +0.40]）
  - 复盘发现："冷号策略"实际 0 选冷号（hotCold 阈值太宽）、5 策略前区风格趋同（温 89-98%）、前区 31/18/11 黑洞、后区 9/6 黑洞、和值 65 被训练下限 68 卡死、95 注 0 注 ≥3 命中
- 2026-06-22：大乐透元层增强。在 `js/predictor.js` 内加 9 个元层能力（transitionSignal / biasDetector / overKillWarn + 回写 / 胆码分层 / 置信度分层 / 后区软排 / 双窗口 trend / emergingHot），新增 `js/dlt-conformal.js`（Wilson 90% CI 套件）。`js/app.js` 的 `renderPredictions` 加置信度标签 + 误杀预警球标 + 复盘回测，`savePredictionRecord` 持久化 overKillWarn + confidence + meta。`index.html` 加载顺序加 `dlt-conformal.js`。CSS 加 .pred-confidence / .ball-warn / .pred-overkill-banner / .history-overkill-review。
- 2026-06-08：初版。基础项目背景 + 6 条已知规则。补齐 `agents/` 下 3 个子规则文件（llm-predict / upstash / worldcup-data），移除测试钩子。
