# 体彩数据工作台 · 大乐透 / 排列三分析与预测

纯前端单页应用：体彩超级大乐透 + 排列三历史开奖统计、多策略预测与复盘。零框架、零构建步骤。

- 线上演示（GitHub Pages）：https://lrwei91.github.io/Lottery/
- 线上部署（Vercel，含 API）：https://ticai-taupe.vercel.app

## 项目特色

1. **零框架实现**：HTML5 + 原生 CSS + 原生 JavaScript，无构建步骤。`index.html` 直接打开即可运行。
2. **自研 Canvas 图表引擎**：`js/charts.js` 实现频率、遗漏、走势、奇偶比、大小比、和值分布等图表，原生适配高 DPI（Retina），带过渡动画。
3. **大乐透多策略预测**（默认 5 注，按历史复盘校准的固定顺序）：

   | 顺序 | 策略 | 内部 ID | 思路 |
   |------|------|----------|------|
   | 1 | 遗漏回补 | `gap` | 选处于极值遗漏区间的号码 |
   | 2 | 冷号优先 | `cold` | 选遗漏大、频次低的号码 |
   | 3 | 布林线策略 | `random` | 布林带约束 + 热号池 + 目标和值（仅前区） |
   | 4 | 均衡推荐 | `balanced` | 按比例混合冷号、温号、热号 |
   | 5 | 热号优先 | `hot` | 追踪近期高频号码 |

   排列三的 5 注顺序不同，为 `balanced / random / gap / hot / cold`（`buildStrategyOrder` 按彩种分支）。

   另有可选的 `danTuo` 胆码分层（`useDanLayer`），默认不占 5 注名额。大乐透后区独立按 `random / balanced / random / balanced / random` 映射，整注与后区对子均去重。

4. **元层信号调权**（`js/predictor.js`）：双窗口 trendScore（近 10 期 vs 近 50 期）、emergingHot 标记、区间聚集反向加权、区间/尾数/AC 聚集与反聚集权重、误杀预警 + 命中率回写校准、5 注置信度三档分层、后区观察层软排。
5. **大乐透专属 Conformal Prediction**（`js/dlt-conformal.js`）：旧数据训练 + 最近 20% holdout 校准，输出 `qhat` / `conformalHalfWidth` / `recentDrift` / `stabilityScore`，通过 `computeMetaWeight` 接入选号权重。
6. **跨端预测同步**：预测记录与复盘结果经 Vercel Functions 写入 Upstash Redis，同一设备 ID 的多端数据自动聚合，本地 `localStorage` 始终可离线使用。
7. **全自动数据更新**：GitHub Actions 定时抓取最新开奖，优先第三方接口、失败自动回退体彩官方接口。

### 页面主要区块

最新开奖结果 · 下期开奖倒计时 · 近期开奖记录 · 中奖规则与奖级说明 · 历史开奖数据（搜索 / 年份筛选 / 分页）· 前后区频率 · 冷热号分布 · 遗漏值 · 奇偶比 · 大小比 · 和值分布 · 号码走势图 · 智能号码预测 · 预测记录与复盘 · 奖项智能核对 · 历史复盘记录

---

## 技术栈与文件结构

```text
Lottery/
├── index.html                    # 单页入口：静态结构 + 脚本加载顺序
├── package.json                  # npm 脚本入口
├── vercel.json                   # Functions 配置
├── LICENSE                       # MIT
├── .gitignore                    # 含 .env
├── .github/workflows/
│   ├── check.yml                 # PR / push 只读质量门禁（npm run check）
│   └── update_data.yml           # 彩票数据更新（workflow_dispatch）
├── css/
│   ├── style.css                 # 基础与历史样式
│   └── workbench.css             # 工作台视觉覆盖层（当前视觉基线，token 在此定义）
├── js/
│   ├── app.js                    # 主应用交互与状态机
│   ├── app-config.js             # 彩种静态配置、状态工厂
│   ├── runtime.js                # Pages / Vercel 运行时判断与网络超时
│   ├── charts.js                 # 原生 Canvas 图表引擎
│   ├── predictor-config.js       # 大乐透 / 排列三不可变参数 + 策略中文名（Object.freeze）
│   ├── predictor.js              # 多策略选号、回测、元层信号
│   ├── dlt-conformal.js          # 大乐透 Conformal Prediction
│   ├── cloud-sync.js             # 跨端记录同步
│   ├── device-id.js              # 设备 ID 生成与读取
│   └── device-panel.js           # 设备面板：ID + 二维码 + 手动绑定
├── data/
│   ├── lottery_data.json         # 大乐透历史开奖（约 2930 期）
│   └── pl3_data.json             # 排列三历史开奖（约 7738 期）
├── api/
│   ├── records.js                # 预测记录 GET/POST（按 deviceId）
│   ├── reviews.js                # 复盘结果 GET/POST
│   └── _lib/                     # redis / http / device-sync 共享实现
├── scripts/
│   ├── scraper.cjs / scraper_pl3.cjs / lottery_scraper_common.cjs   # 双源抓取
│   ├── cron_generate_daily_predictions.cjs  # 每日 5 注自动生成 + 云端写入
│   └── check-*.cjs               # check 门禁与环境诊断实现
├── docs/design-brief.md          # 视觉设计依据
├── AGENTS.md / CONTEXT.md        # 项目协作规则与上下文
└── agents/upstash.md             # Upstash / 跨端同步子规则
```

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
```

第三方主源需要 `JISU_API_KEY`（兼容 `JISU_APPKEY`）；未配置时脚本自动走体彩官方副源。

### 质量门禁

```bash
npm run check
```

覆盖 JS 语法、JSON 数据契约、API 与 Redis 封装、前端运行时降级与已删除模块的残留检查、大乐透 Conformal 覆盖率与 5 注合法性、排列三固定 seed 与跨彩种状态隔离。只改文档时至少执行 `git diff --check`。

环境变量诊断：

```bash
npm run env:check            # 只读本地 process.env，分级列出缺失项
npm run env:check:vercel     # 附带 Vercel Dashboard 配置位置提示
npm run env:check:strict     # 推荐项缺失也判失败
```

---

## 自动化数据更新

- **触发方式**：外部调度器每天北京时间 **21:36** 通过 `workflow_dispatch` 推送（大乐透在周一、三、六 21:25 开奖，排列三每天 21:25 开奖，21:36 即可获取完整官方开奖数据）。
- **运行机制**：工作流优先使用 `JisuAPI` 拉取最新开奖，失败时切换体彩官方接口；检查通过后**只提交** `lottery_data.json` 和 `pl3_data.json`。
- **防缓存机制**：前端请求自动附加时间戳参数，确保每次加载都能获取最新开奖数据，避免浏览器缓存导致的数据延迟。

### 需要的密钥

| 变量 | 位置 | 用途 |
|------|------|------|
| `JISU_API_KEY` | GitHub Actions Secrets / 本地 env | 彩票抓取第三方主源 |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Vercel Storage → Marketplace → Upstash Redis | 跨端预测与复盘同步 |

`.env` 已在 `.gitignore`，任何密钥都不入库。

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

后端约束：`deviceId` 限 8–64 位字母数字与连字符，单设备最多保留 200 条预测记录，请求体上限 128KB。

> Vercel KV 已 deprecated，新项目走 Marketplace 的 Upstash Redis integration，代码同时兼容 `KV_REST_API_*` 旧变量名。改完 env 不会自动重新部署，需要 `vercel deploy --prod` 或在 Dashboard 点 Redeploy。

### 每日自动出注

`scripts/cron_generate_daily_predictions.cjs` 用 vm 沙箱加载浏览器端 predictor 脚本，生成当日 5 注并 POST 到 `/api/records`，同时归档到 `scripts/logs/daily-predictions/`。`--dry-run` 只生成不写入云端。

---

## 视觉与兼容约定

- 视觉基线：白纸、黑墨、荧光黄（唯一品牌强调色）+ 32px 网格。彩票球红蓝、成功/警告/错误继续作为业务语义色。
- 只提供浅色模式，根节点固定 `color-scheme: light`；无深色模式、无颜色偏好持久化、无模式选择器。
- 常态表面用实底 + 细边框，阴影仅用于可交互悬停、浮层与模态框；状态不只靠颜色表达。
- 动效仅用于首屏编排、面板一次性揭示与按压反馈；`prefers-reduced-motion: reduce` 下直接呈现最终状态。
- JS 失效时静态内容仍可读，加载反馈采用延迟出现的非阻塞指示层。
- 验收视口：320 / 390 / 768 / 1024 / 1440px，含键盘、触屏、200% 缩放与 JS 禁用场景；表格允许容器内横向滚动，页面本身不横向溢出。

详细依据见 `docs/design-brief.md`。

---

## 免责声明

本项目为体彩超级大乐透与排列三数据分析与概率研究工具，图表展示及预测结果均基于历史公开数据计算。彩票开奖号码纯属随机，任何预测策略都不能保证中奖。请理性购彩，量力而行，仅作数据研究与娱乐参考之用。

## 许可协议

MIT，见 [LICENSE](LICENSE)。
