---
name: ticai
description: 用于维护 ticai 的体彩数据、预测器、世界杯四源融合、LLM 预测、Upstash 同步或 Vercel API 时
version: 1.0.0
author: lrwei91
license: MIT
metadata:
  hermes:
    tags: [ticai, lottery, prediction, vercel, upstash]
---

# ticai

体彩大乐透、排列三和世界杯预测的原生前端数据工作台。

## 边界

- 保持纯 HTML/CSS/原生 JavaScript、Canvas 图表和现有脚本加载顺序。
- `data/` 是可发布数据；数据生成、同步和预测脚本必须先走 dry-run 或项目检查。
- `worldcup_matches.json` 的 canonical writer 只有 `scripts/sync_worldcup_matches.py`，不得手改后用 `git add data/` 打包。
- 统一使用 `@upstash/redis` 和现有 API 封装，不重新引入已弃用的 `@vercel/kv`。
- 彩票预测只作历史数据研究和娱乐参考，不把概率输出包装成保证中奖或投资结论。

## 核心结构

| 区域 | 真正入口 | 约束 |
|---|---|---|
| 页面 | `index.html`、`js/app.js`、`js/charts.js`、`js/worldcup.js` | 保留 `#dlt`、`#pl3`、`#worldcup` Hash 路由和既有 DOM/API 契约 |
| 预测 | `js/predictor-config.js`、`js/predictor.js`、`js/dlt-conformal.js` | 彩种参数集中管理；大乐透与排列三状态隔离 |
| 数据 | `data/` | JSON 为项目数据源；世界杯赛程由单一同步脚本生成 |
| API | `api/`、`api/_lib/`、`api/cron/sync-odds.js` | 私有接口校验 Supabase/Upstash 配置，不绕过现有封装 |
| 脚本 | `scripts/` | 抓取、同步、环境和检查脚本；LLM 结果写回 git tracked JSON |

## 使用

```bash
# 开始前保护已有改动
git status --short --branch

# 统一质量门禁
npm run check

# 抓取先只验证，不写入正式数据
DRY_RUN=1 npm run scrape:all

# 世界杯同步：确认范围后再执行
npm run sync:worldcup:all

# LLM 预测先 dry-run；Provider 通过环境变量切换
npm run llm:predict:all:dry

# 纯前端开发；需要 API 联调时改用 vercel dev
npm run dev
vercel dev
```

LLM/API 密钥只从环境变量或受控凭据注入，文档和日志只出现变量名，不出现真值。

## 当前 5 大坑

### 1. 手改 `worldcup_matches.json`

**触发**：发现比分或赛程滞后直接改 JSON。**表现**：canonical writer 与结果分叉，后续同步覆盖手工修复。**修法**：运行 `scripts/sync_worldcup_matches.py`，只检查并提交它负责的 owner 文件。

### 2. 把静态开发服务器当成 API 环境

**触发**：用 `npm run dev` 验证 `/api/records`、`/api/reviews`。**表现**：本地 404，被误判为生产接口坏了。**修法**：静态页面用 `npm run dev`；API/Storage 用 `vercel dev` 或预览环境单独验证。

### 3. 预测未 dry-run 就写 tracked JSON

**触发**：直接运行 LLM 或同步脚本。**表现**：凭据、异常输出或大批量数据进入工作区。**修法**：先用项目提供的 dry-run 和检查命令，再核对 diff 和 owner 文件。

### 4. 复制一份新的主题或脚本加载逻辑

**触发**：新页面功能直接内联颜色、脚本或状态。**表现**：Canvas、设备面板和深浅色状态互相漂移。**修法**：复用 `TicaiColorMode`、现有 CSS token、`api/_lib/` 和同步加载顺序。

### 5. 把历史样本当确定性结论

**触发**：根据回测或融合概率宣称下一期必然结果。**表现**：研究工具越过产品免责声明。**修法**：保留数据来源、样本范围和不确定性说明，预测只作为参考。

## 验证清单

- [ ] `.env`、API key、Token 和私钥没有进入输出、diff 或提交。
- [ ] 文档/小改动至少通过 `git diff --check`；代码或数据改动运行 `npm run check`。
- [ ] 预测器改动额外运行 `npm run check:dlt-predictor` 或 `npm run check:pl3-predictor`。
- [ ] API 改动区分静态服务器、`vercel dev` 和真实预览环境的证据。
- [ ] 未使用 `git add data/`、`git add .` 或未经授权的部署/推送。

## references/

本 skill 无 `references/` 目录；详细边界以仓库根项目规则、`agents/` 子规则和 `README.md` 为准。
