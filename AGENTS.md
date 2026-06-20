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

### 6. 测试
- 跑 `npm run dev`（`npx -y serve .`）起本地静态服务。
- API 本地测：`vercel dev`（Vercel CLI）。注意 Vercel dev 跟生产 env 注入逻辑一样，连了 Storage 才会有 Upstash 变量。
- 数据更新：`npm run scrape:all` 或 `npm run sync:worldcup:all`。

## @import 子规则文件

按需加载（不要无脑全读）：

- `agents/llm-predict.md` — LLM 预测脚本协议细节、Provider 切换、prompt 模板、输出 JSON 校验
- `agents/upstash.md` — Upstash Redis 客户端封装、env 变量兼容写法、跨端同步 API 拓扑
- `agents/worldcup-data.md` — 4 源融合权重、The Odds API / Polymarket 字段映射、改权重 checklist

## 变更日志

- 2026-06-08：初版。基础项目背景 + 6 条已知规则。补齐 `agents/` 下 3 个子规则文件（llm-predict / upstash / worldcup-data），移除测试钩子。
