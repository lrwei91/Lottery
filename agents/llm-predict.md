# agents/llm-predict.md — LLM 预测脚本详解

> 适用文件：`scripts/llm-predict.js`
> 主入口：`AGENTS.md` 规则 4（先 `DRY_RUN=1`、Provider 走环境变量、结果写 `data/wc_llm_*.json`）。
> 本文件补充：**协议细节、prompt 模板、输出 JSON 校验、常见坑**。

## 1. 三种 Provider 的协议差异

脚本里走的是**协议自动匹配**，不是"通用 OpenAI 客户端"。改代码前先看清。

| Provider | 协议 | Endpoint | 鉴权 | 默认模型 |
|---|---|---|---|---|
| `ollama` | Ollama `/api/chat` | `http://localhost:11434/api/chat` | 无 | `llama3.2` |
| `openai` | OpenAI `/v1/chat/completions` | `http://localhost:1234/v1/chat/completions` | `Authorization: Bearer <LLM_API_KEY>`（可选） | `gpt-4o-mini` |
| `xiaomi` | Anthropic `/v1/messages` | `https://token-plan-cn.xiaomimimo.com/anthropic` | `x-api-key: <LLM_API_KEY>` + `anthropic-version: 2023-06-01`（**必填**） | `mimo-v2.5-pro` |

**Provider 选择优先级**（`scripts/llm-predict.js:90`）：
1. 显式 `LLM_PROVIDER` 环境变量
2. 否则根据 `LLM_ENDPOINT` 自动检测（URL 里含 `xiaomimimo.com` 或 `/anthropic` → xiaomi；含 `localhost:11434` 或结尾 `/api/chat` → ollama；结尾 `/v1/chat/completions` → openai）
3. fallback → ollama

## 2. 关键环境变量

| 变量 | 必填 | 用途 |
|---|---|---|
| `LLM_PROVIDER` | 否 | 强制 provider（`ollama` / `openai` / `xiaomi`） |
| `LLM_API_KEY` | xiaomi **必填** | API key，xiaomi 走 `x-api-key` header；openai 走 `Authorization: Bearer` |
| `LLM_ENDPOINT` | 否 | 覆盖默认 endpoint（`ollama`/`openai` 适用） |
| `LLM_BASE_URL` | 否 | xiaomi 专用，覆盖默认 `https://token-plan-cn.xiaomimimo.com/anthropic` |
| `LLM_MODEL` | 否 | 覆盖默认 model |
| `LLM_TEMPERATURE` | 否 | 默认 `0.3` |
| `LLM_MAX_TOKENS` | 否 | 默认 `4000` |
| `DRY_RUN` | 否 | `1` = 只打印不写文件 |

**`.env` 自动加载**（无依赖，自己解析）：脚本会先读 `ROOT/.env` 再读 `scripts/.env`（仅在未通过环境设置时填入，绝不覆盖已有 env）。

## 3. 运行命令速查

```bash
# h2h 单场（默认）
node scripts/llm-predict.js h2h

# 冠军 outright
node scripts/llm-predict.js outright

# 两个都跑（串行）
node scripts/llm-predict.js all

# 干跑（不写文件，验证输出）
DRY_RUN=1 node scripts/llm-predict.js all

# 切 provider
LLM_PROVIDER=xiaomi node scripts/llm-predict.js all
LLM_PROVIDER=openai LLM_BASE_URL=https://api.openai.com LLM_MODEL=gpt-4o-mini \
  LLM_API_KEY=sk-xxxxx node scripts/llm-predict.js all
```

`package.json` 已经预置了 `llm:predict` / `llm:predict:dry` / `llm:predict:ollama` 等短名，**优先用 npm script**，避免漏写 `DRY_RUN`。

## 4. 模式（argv[2]）

```
h2h      # 默认。预测 24 场未来 7 天未开始的比赛 → data/wc_llm_predictions.json
outright # 48 队夺冠概率 → data/wc_llm_outright.json
all      # 上面两个串行
```

未知 mode 会直接 `process.exit(1)` 报错。

## 5. 输入数据

| 文件 | 用途 |
|---|---|
| `data/worldcup_2026.json` | 球队基础（`elo` / `mod_elo` / `final_prob`） |
| `data/worldcup_matches.json` | 赛程（`id` / `date` / `time` / `home` / `away` / `status` / `stage` / `group`） |
| `data/worldcup_names.json` | 中英文名映射（`countryNames[<en>] = <cn>`） |

输入文件缺失 → 直接退出。

## 6. 输出 JSON 结构

### `data/wc_llm_predictions.json`（h2h）

```json
{
  "generatedAt": "ISO-8601",
  "provider": "ollama | openai | xiaomi",
  "model": "llama3.2",
  "endpoint": "实际命中 URL",
  "predictions": [
    {
      "matchId": "<string>",
      "homeWinProb": 0.0-1.0,
      "drawProb": 0.0-1.0,
      "awayWinProb": 0.0-1.0,
      "predictedOutcome": "home | draw | away",
      "confidence": 0.3-0.9,
      "reasoning": "中文 30-80 字"
    }
  ]
}
```

### `data/wc_llm_outright.json`（冠军）

```json
{
  "generatedAt": "ISO-8601",
  "provider": "xiaomi",
  "model": "mimo-v2.5-pro",
  "endpoint": "https://token-plan-cn.xiaomimimo.com/anthropic/v1/messages",
  "llmProvided": 24,           // LLM 直接给的国家数（剩余按 Elo 衰减补齐到 48）
  "predictions": [
    {
      "country": "<完整匹配 teams 里的 key>",
      "winProb": 0.0-1.0,       // 归一化后总和=1
      "rank": 1,                 // 1 = 最看好
      "reasoning": "中文 20-50 字"
    }
  ]
}
```

## 7. Prompt 模板

### H2H system prompt 要点

- 让 LLM 输出**纯 JSON 数组**（`matches: [...]`），不要夹杂解释。
- 三项概率 `homeWinProb + drawProb + awayWinProb = 1.0`（容差 0.01）。
- `confidence` 限制 0.3-0.9（避免极端值，方便后续融合）。
- `reasoning` 中文 30-80 字。
- 球队信息：top 12 强队（按 `final_prob` 降序）→ `Elo / 修正 Elo / 模型概率`。
- 比赛信息：未来 7 天未开始的 24 场（按时间升序）。

### Outright system prompt 要点

- 48 队**全部**给 LLM（按 `mod_elo` 降序），不切片。
- `country` 必须是给定列表里的 key（**完整匹配**，区分大小写）。
- `winProb` 0-1 之间；脚本最后会归一化到总和=1。
- **prompt 里显式禁止参考市场赔率**——LLM 要独立基于 Elo + 阵容深度 + 教练 + 赛程判断。
- 至少给出 12 支强队完整预测；其他队可省略，脚本会按 Elo 衰减补齐。

## 8. 校验逻辑（必须读）

### H2H

- 三项概率之和容差 0.01。
- `predictedOutcome` 必须是 `home` / `draw` / `away` 之一。
- `confidence` 限制 0.3-0.9。
- `reasoning` 中文 30-80 字。

### Outright

- `country` 必须在 teams 列表里（用 `Set` 校验）。
- 有效预测 **< 6 国** → **整个 outright 失败**（建议补更多 top 强队完整预测）。
- 缺的国家按 Elo 衰减补齐，确保 48 队都有概率。
- 补齐时 `winProb` 归一化到总和=1。

## 9. 常见坑

- **xiaomi 响应无 text block**：`stop_reason=max_tokens` 时 `content` 全是 `thinking` block。调大 `LLM_MAX_TOKENS`（默认 4000 不一定够 thinking-heavy 模型）。
- **xiaomi 响应解析**：返回 `content` 是 `[{type:'text',text:'...'}, {type:'thinking',thinking:'...'}]` 数组，脚本**只取 type=='text' 的按顺序拼接**。失败时会把 thinking 暴露给 stdout 便于诊断。
- **OLLAMA host 没起**：`fetch` 抛 ECONNREFUSED 整个脚本挂掉。提前 `curl http://localhost:11434/api/tags` 确认服务在跑。
- **JSON 解析失败**：LLM 输出经常包 ```json 围栏或前后杂文，脚本会尝试用 `JSON.parse` 容忍一些边界；改 prompt 强调"**只输出 JSON**"可大幅降低失败率。
- **`.env` 不会覆盖 shell env**：脚本里的 `process.env[key] === undefined` 才填——所以 CI 里 export 优先。
- **DRY_RUN 输出格式**：干跑时仍调 LLM（花钱/花时间），但**不写 `data/wc_llm_*.json`**。跑前预估 token 量。
- **修改 LLM 协议**：所有 provider 走 `callLLM(prompt, cfg)` 调度，**新增 provider 在 `callLLM` 加分支**即可，不要去改每个调用点。

## 10. 在 `js/worldcup.js` 里的消费

前端读取：`state.llmPredictions` / `state.llmOutright`（`js/worldcup.js:23-24`）。
融合权重定义在 `js/worldcup.js:1478`：

```js
const ENSEMBLE_WEIGHTS = { h2h: 0.30, odds: 0.30, poly: 0.20, llm: 0.20 };
```

LLM 占 20%，Elo/The Odds API 各 30%，Polymarket 20%。**改权重**时同时改 `worldcup.js` 和这份权重表。
