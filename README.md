# 🎱 超级大乐透 & 排列三 · 数据分析与智能预测

一个支持体彩超级大乐透和排列三的可视化分析与多策略号码推荐系统。

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
5. **⚽ 2026 世界杯一级 Tab**：迁入 `mikobinbin/2026-world-cup-predictor` 的静态预测结果，与超级大乐透、排列三同级，提供冠军概率、因子拆解、玄学分析、H2H 对战、阵容和市场对比视图。

---

## 📂 文件结构

```text
Lottery/
├── index.html                    # 仪表盘主页面
├── package.json                  # 项目配置文件
├── .gitignore                    # Git 忽略配置
├── .github/
│   └── workflows/
│       └── update_data.yml       # GitHub Actions 每日自动更新脚本
├── css/
│   └── style.css                 # 现代深色系毛玻璃设计系统
├── js/
│   ├── app.js                    # 主应用交互与状态机管理
│   ├── charts.js                 # 原生 Canvas 图表绘制引擎
│   ├── predictor.js              # 多策略号码预测与回测计算核心
│   └── worldcup.js               # 2026 世界杯预测 Tab 交互
├── data/
│   └── lottery_data.json         # 2875+ 期历史大乐透开奖全量数据
│   └── pl3_data.json             # 排列三历史开奖数据
│   └── worldcup_2026.json        # 世界杯预测静态导出数据
└── scripts/
    ├── lottery_scraper_common.js # 双源抓取公共逻辑
    ├── scraper.js                # 大乐透双源抓取脚本 (Jisu 主 / 官方副)
    └── scraper_pl3.js            # 排列三双源抓取脚本 (Jisu 主 / 官方副)
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

## 🤖 本地 LLM 预测（离线 AI + GitOps）

无需 API key、无需联网，**在自己机器上跑 LLM 预测** → 输出到 `data/wc_llm_predictions.json` → git commit + push → Vercel 部署时自动包含 → 前端 `data/wc_llm_predictions.json` 加载后在每场对战卡片显示 `🤖 [胜平负] [概率]` badge，鼠标悬停看推理说明。

### 前置条件

任意一个本地 LLM 服务：
- [Ollama](https://ollama.com) — 推荐，零配置 (`ollama serve`)
- [LM Studio](https://lmstudio.ai) — 图形化，本地 OpenAI 兼容 endpoint
- [vLLM](https://docs.vllm.ai) — 性能最强
- 其他 `http://localhost:PORT/v1/chat/completions` 兼容服务

### 跑预测

```bash
# 装好 Ollama + pull 一个模型
ollama pull qwen2.5            # 或 llama3.2 / mistral / 任意
ollama serve                   # 默认监听 :11434

# 跑预测（默认走 Ollama）
npm run llm:predict

# 干跑（不写文件，看输出）
npm run llm:predict:dry

# 自定义模型 / endpoint
LLM_MODEL=qwen2.5 LLM_ENDPOINT=http://localhost:11434/api/chat npm run llm:predict
```

### 推到云端

```bash
git add data/wc_llm_predictions.json
git commit -m "chore: refresh LLM predictions ($(date +%Y-%m-%d))"
git push origin main
```

Vercel 会自动部署，浏览器刷新就能看到每场对战卡片右上角多出 `🤖 [预测结果] [概率]` 徽章。

### 输出格式

`data/wc_llm_predictions.json` 结构：

```json
{
  "generatedAt": "2026-06-07T...",
  "model": "qwen2.5",
  "endpoint": "http://localhost:11434/api/chat",
  "temperature": 0.3,
  "matchCount": 24,
  "predictions": [
    {
      "matchId": "...",
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

### 实时数据接入（Polymarket / The Odds API / football-data.org）

云端模式用 Vercel Cron 每 6 小时拉一次真实数据，写 Vercel KV，前端 `/api/odds/snapshots` 拉取。

配置环境变量（Vercel Dashboard → Storage → Marketplace → Upstash Redis 装好后）：
- `ODDS_API_KEY` — The Odds API（可选）
- `FOOTBALL_DATA_API_KEY` — football-data.org（可选）
- `POLYMARKET_PUBLIC_ENABLED=true` + 可选 `POLYMARKET_TAG_ID`（公开无 key 模式）

未配置时对应源 `skipped`，前端 fallback 到静态 `POLY_WINNER`。

Cron 配置在 `vercel.json`：`{ "schedule": "0 */6 * * *", "path": "/api/cron/sync-odds" }`。

### 赔率计算工具

`js/odds-utils.js`（`window.OddsUtils`）提供：
- `devig.proportionalDevig(outcomes)` — 按比例去水
- `devig.fairProbsFromPrices(prices)` — 32 国冠军市场一键去水
- `ev.expectedValue(odds, prob)` — 期望值
- `ev.edge(model, market)` — 模型 vs 净市场偏离
- `kelly.fractionalKelly(odds, prob, 0.25)` — 1/4 Kelly 仓位

世界 tab 的"市场博弈"已用上，模型 vs 净市场 + EV + Kelly¼ 仓位全展示。
