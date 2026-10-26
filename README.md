# 体彩数据工作台 · 大乐透 / 排列三分析与预测

在一个页面里查看体彩超级大乐透与排列三的历史开奖、统计图表和策略选号结果，并在开奖后核对预测记录。前端使用原生 HTML、CSS 和 JavaScript，无需构建即可运行。

当前重点维护 **超级大乐透**。排列三保留现有功能、数据更新和自动化，暂不开展策略分析、调参或专项验证；默认检查覆盖大乐透和共享基础能力。

- [GitHub Pages 演示](https://lrwei91.github.io/Lottery/)：查看开奖、图表和本地预测记录。
- [Vercel 站点](https://ticai-taupe.vercel.app)：包含预测与复盘记录的云同步 API。

## 主要功能

1. **静态页面即可使用**：通过静态服务器访问 `index.html`，即可加载仓库中的开奖数据。云同步需要另外配置 API 和 Redis。
2. **历史开奖图表**：查看号码频率、遗漏、走势、奇偶比、大小比和和值分布。图表由 `js/charts.js` 使用 Canvas 绘制，支持高 DPI 屏幕和过渡动画。
3. **大乐透策略选号**：默认生成 5 注，按以下顺序使用不同策略：

   | 顺序 | 策略 | 内部 ID | 思路 |
   |------|------|----------|------|
   | 1 | 遗漏回补 | `gap` | 选处于极值遗漏区间的号码 |
   | 2 | 冷号优先 | `cold` | 选遗漏大、频次低的号码 |
   | 3 | 布林线策略 | `random` | 布林带约束 + 热号池 + 目标和值（仅前区） |
   | 4 | 均衡推荐 | `balanced` | 按比例混合冷号、温号、热号 |
   | 5 | 热号优先 | `hot` | 追踪近期高频号码 |

   排列三的 5 注顺序不同，为 `balanced / random / gap / hot / cold`（`buildStrategyOrder` 按彩种分支）。

   胆码分层 `danTuo` 可通过 `useDanLayer` 选项启用，默认不占这 5 注的名额。后区单独按 `random / balanced / random / balanced / random` 选号，5 注之间不会出现重复的整注或后区对子。

   生成时优先减少各注之间的号码重合，无法凑齐时再逐级放宽复用限制；前区仍按和值、奇偶、连号、AC 值等历史统计条件筛选。

4. **辅助信号与选号分层**：`js/predictor.js` 比较近 10 期与近 50 期的变化，标记新近热号，并根据号码在区间、尾数和 AC 值上的聚集情况调整权重。预测结果分为三档置信度，同时提供误杀预警、命中率回写校准，以及后区观察号码的降权处理。
5. **大乐透校准指标**：`js/dlt-conformal.js` 使用较早的数据训练，再用最近 20% 的留出数据校准，计算号码表现的不确定性、近期变化和稳定性。输出的 `qhat`、`conformalHalfWidth`、`recentDrift` 和 `stabilityScore` 通过 `computeMetaWeight` 参与选号权重计算。
6. **预测与复盘记录同步**：通过 Vercel Functions 将记录写入 Upstash Redis。网页与定时任务默认使用同一同步 ID，无需手动绑定；云端不可用时，仍可使用已保存在浏览器 `localStorage` 中的记录。
7. **开奖数据更新**：GitHub Actions 工作流支持手动或外部调度触发，优先调用第三方接口，失败后回退到体彩官方接口。

### 页面主要区块

- **查开奖**：最新开奖结果、下期开奖倒计时、近期记录、中奖规则与奖级说明。
- **看统计**：历史数据搜索、年份筛选与分页，以及频率、冷热号、遗漏、奇偶比、大小比、和值和走势图。
- **做复盘**：策略选号、预测记录、奖项核对与历史复盘。

---

## 技术与文件结构

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
│   ├── device-id.js              # 统一同步 ID 读取
│   └── device-panel.js           # 设备面板：统一 ID + 二维码 + 本机记录清理
├── data/
│   ├── lottery_data.json         # 大乐透历史开奖
│   └── pl3_data.json             # 排列三历史开奖
├── api/
│   ├── records.js                # 预测记录 GET/POST（按 deviceId）
│   ├── reviews.js                # 复盘结果 GET/POST
│   └── _lib/                     # redis / http / device-sync 共享实现
├── scripts/
│   ├── scraper.cjs / scraper_pl3.cjs / lottery_scraper_common.cjs   # 双源抓取
│   ├── cron_generate_daily_predictions.cjs  # 大乐透候选套生成 + 云端写入
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

也可以使用其他静态服务器访问 `index.html`。页面需要通过 HTTP 加载 JSON 数据，不建议直接双击 HTML 文件。

`npm run dev` 只提供静态文件，不包含云同步 API；本地访问 `/api/records`、`/api/reviews` 返回 404 时，不能据此判断生产 API 是否正常。

### 手动更新数据

```bash
npm run scrape                    # 默认只更新大乐透
DRY_RUN=1 npm run scrape           # 只验证抓取，不写数据文件
```

第三方主源需要 `JISU_API_KEY`（兼容 `JISU_APPKEY`）；未配置时脚本自动走体彩官方副源。

### 质量门禁

```bash
npm run check
```

检查包括 JS 语法、JSON 数据格式、API 与 Redis 封装、前端降级行为和已移除模块的残留引用。大乐透专项检查还覆盖 Conformal 校准覆盖率、5 注合法性、跨注分散，以及用于对照实验的结构观察模式。只改文档时，至少执行 `git diff --check`。

大乐透策略滚动回测（只读，不上传号码）：

```bash
node scripts/backtest-dlt-strategies.cjs --seeds 4 --out scratch/dlt-backtest.json
```

详见 [2026-10-18 策略审计与调整](docs/strategy-review-2026-10-18.md)。回测中的内部评分和短期差异不代表下一期中奖概率。

环境变量诊断：

```bash
npm run env:check          # 读取当前进程的环境变量，分级列出缺失项
npm run env:check:vercel   # 同时提示 Vercel Dashboard 中的配置位置
npm run env:check:strict   # 推荐项缺失时也判定失败
```

---

## 自动化数据更新

- **触发方式**：仓库中的工作流只配置了 `workflow_dispatch`，可在 GitHub Actions 中手动运行，也可由外部调度器调用。具体运行时间由外部调度配置决定。
- **更新流程**：优先使用 JisuAPI 抓取开奖，失败时切换到体彩官方接口。检查通过且数据发生变化后，只提交 `data/lottery_data.json` 和 `data/pl3_data.json`。
- **缓存处理**：前端加载数据时附加时间戳，并使用 `cache: 'no-cache'`，减少浏览器缓存造成的延迟。页面能否显示最新一期，仍取决于抓取和部署是否完成。

### 环境变量

| 变量 | 位置 | 用途 |
|------|------|------|
| `JISU_API_KEY` | GitHub Actions Secrets / 本地 env | 彩票抓取第三方主源 |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Vercel Storage → Marketplace → Upstash Redis | 跨端预测与复盘同步 |

`.env` 已加入 `.gitignore`。密钥应通过本地环境变量或平台配置提供，不要写入代码、文档或提交记录。

---

## 跨端预测同步

云同步把不同设备上的预测与复盘记录汇总到同一空间，方便开奖后核对。当前网页和定时任务使用统一同步 ID，设备面板中可以查看该 ID。

| 端 | 存储 |
|----|------|
| 本机 | `localStorage`（最近 20 条预测 + 策略缓存） |
| 云端 | Upstash Redis（`device:<deviceId>:*` 命名空间，Sorted Set 按时间裁剪） |

- 记录先保存在本地，再异步上传，不阻塞页面操作；启动时拉取云端记录并与本地合并。
- 复盘结果按 `recordId::strategy::issue` 去重，读取时兼容历史键格式。
- 同步失败时在控制台记录警告，本地记录仍可使用。GitHub Pages 演示站不调用云同步 API。
- 点击页面右上角的 **设备** 按钮，可以查看同步 ID 和二维码、复制 ID，或清理本机记录。
- 同步内容以预测与复盘记录为主，不要求账号或邮箱；策略统计与进化在本机运行。

| 方法 | 路径 | 用途 |
|------|------|------|
| `GET` | `/api/records?deviceId=xxx` | 拉取该设备的预测记录 |
| `POST` | `/api/records` `{ deviceId, record }` | 写入一条预测 |
| `GET` | `/api/reviews?deviceId=xxx` | 拉取该设备的复盘结果 |
| `POST` | `/api/reviews` `{ deviceId, review }` | 写入一条复盘 |

后端约束：`deviceId` 限 8–64 位字母数字与连字符，单设备最多保留 200 条预测记录，请求体上限 128 KB。

> Redis 配置优先读取 `UPSTASH_REDIS_REST_*`，同时兼容 `KV_REST_API_*` 旧变量名。修改 Vercel 环境变量后，需要重新部署才能生效，可使用 `vercel deploy --prod` 或在 Dashboard 中选择 Redeploy。

### 每日自动出注

`scripts/cron_generate_daily_predictions.cjs` 在 Node.js 的 `vm` 沙箱中加载浏览器端预测脚本，生成 5 套候选，每套 5 注，再按套内平均置信分选出推荐套。运行时会将全部 5 套写入 `/api/records`，并归档到 `scripts/logs/daily-predictions/`。

加上 `--dry-run` 后仍会生成候选、记录日志并写入本地归档，但不会上传云端。内部置信分用于比较候选，不代表实际中奖概率。

---

## 视觉与兼容约定

- 视觉基线：白纸、黑墨、荧光黄（唯一品牌强调色）+ 32px 网格。彩票球红蓝、成功/警告/错误继续作为业务语义色。
- 只提供浅色模式，根节点固定 `color-scheme: light`；无深色模式、无颜色偏好持久化、无模式选择器。
- 常态表面用实底 + 细边框，阴影仅用于可交互悬停、浮层与模态框；状态不只靠颜色表达。
- 动效仅用于首屏编排、面板一次性揭示与按压反馈；`prefers-reduced-motion: reduce` 下直接呈现最终状态。
- JS 失效时静态内容仍可读，加载反馈采用延迟出现的非阻塞指示层。
- 验收视口：320 / 390 / 768 / 1024 / 1440px，含键盘、触屏、200% 缩放与 JS 禁用场景；表格允许容器内横向滚动，页面本身不横向溢出。

详细依据见 [设计简报](docs/design-brief.md)。

---

## 免责声明

本项目用于研究体彩超级大乐透与排列三的历史公开数据。图表、选号结果和回测评分都来自历史数据计算，不能保证中奖，也不能据此推断下一期的中奖概率。请仅将结果用于数据研究与娱乐参考，理性购彩，量力而行。

## 许可协议

MIT，见 [LICENSE](LICENSE)。
