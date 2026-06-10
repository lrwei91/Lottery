# agents/upstash.md — Upstash Redis 客户端封装 & 跨端同步 API

> 适用文件：`js/cloud-sync.js`（前端调用层）、`api/records.js` / `api/reviews.js` / `api/odds/*` / `api/cron/sync-odds.js`（Vercel Functions）。
> 主入口：`AGENTS.md` 规则 1（凭据不入聊天 / commit）+ 规则 2（用 `@upstash/redis`，兼容两种 env 变量名）。

## 1. 关键事实

- **Vercel KV 已 deprecated**（2025 起），新装要走 Vercel Marketplace → Upstash Redis integration。
- 代码用 `@upstash/redis`（`package.json` 依赖 `^1.34.0`），**不要**再装 `@vercel/kv`。
- 装好 integration 后注入的 env 变量名：
  - `UPSTASH_REDIS_REST_URL`
  - `UPSTASH_REDIS_REST_TOKEN`
- 老 KV 数据库（Upstash 提供的 KV 类型）通过 Storage → Connect Database 注入的变量名：
  - `KV_REST_API_URL`
  - `KV_REST_API_TOKEN`
- 两种底层指向同一 Upstash 实例，**客户端代码不用区分**。

## 2. 兼容写法模板

读 env 时**先 Upstash 再 KV**（实际写法视调用位置而定，下例是 Vercel Function 通用模板）：

```js
import { Redis } from '@upstash/redis';

const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

if (!url || !token) {
  throw new Error('Missing required environment variables: UPSTASH_REDIS_REST_URL / _TOKEN (or KV_REST_API_*)');
}

const redis = new Redis({ url, token });
```

**校验**：env 缺失时**直接抛**（不静默走 fallback），让 Vercel 函数返回 500 暴露在日志里。
AGENTS.md 规则 2 给的快速判断方法："curl 部署后的 `/api/xxx`，500 错误信息里如果还报 'Missing required environment variables' 就是没注入"。

## 3. 部署 / 注入流程（坑）

Vercel Storage → Connect Database 改完 env **不会自动 re-deploy**，需要：

- CLI：`vercel deploy --prod`（强制部署，build 后 env 才生效）
- 或 Dashboard：项目 → Deployments → 最新一条 → Redeploy

不 re-deploy 的话，函数代码里 `process.env` 拿到的还是**旧值**（可能是 undefined），会 500。

## 4. 跨端同步 API 拓扑

设备维度的"预测记录 + 复盘结果"在多端共享，**key 设计**：

| Key 模式 | 内容 | 写入端 | 读取端 |
|---|---|---|---|
| `device:<deviceId>:records` | 该设备的历史预测记录（List / Hash） | `POST /api/records` | `GET /api/records?deviceId=...` |
| `device:<deviceId>:reviews` | 该设备的复盘结果 | `POST /api/reviews` | `GET /api/reviews?deviceId=...` |
| `odds:snapshot:<source>` | 最新一份 `polymarket` / `the-odds-api` / `football-data` 快照 | Vercel Cron | `GET /api/odds/snapshots` |
| `odds:history:the-odds-api` | 最近 28 个时间点的赔率历史（List） | Vercel Cron | `GET /api/odds/history?source=the-odds-api` |

> **约定**：key 前缀分桶（`device:` / `odds:`），便于后续 `SCAN` 或 `KEYS device:*` 切库/清理。

## 5. 前端封装：`js/cloud-sync.js`

四组函数，**全部 try-catch，失败时降级到本地**（KV 不可用不影响功能）：

| 函数 | 行为 |
|---|---|
| `pullRecords()` | `GET /api/records?deviceId=<id>`，返回 `Array<record>`；不可用时 `[]` |
| `pullReviews()` | `GET /api/reviews?deviceId=<id>`，返回 `Array<review>`；不可用时 `[]` |
| `syncRecord(record)` | `POST /api/records`，**fire-and-forget**，不阻塞 UI |
| `syncReview(review)` | `POST /api/reviews`，**带去重**（`recordId::strategy::issue` 三元组作 key，Set 上限 2000） |

**DeviceId 必填**：所有调用都先 `getDeviceId()`（封装在 `js/device-id.js` 里），没 id 直接 return 不发请求。

**设计原则**：
- **拉取失败 ≠ 报错**：try-catch 后 warn 一下就降级 `[]`，**不弹 toast**，避免用户误以为系统挂了。
- **写入是 fire-and-forget**：UI 不等响应，失败也只 warn。
- **去重在客户端**：`syncedReviewKeys: Set<string>`，超过 2000 直接清空（防膨胀；实际场景远到不了）。

## 6. 后端 API

`api/` 目录是 Vercel Functions，**文件名即路径**（AGENTS.md 规则 3）。

```
api/
  records.js           # GET / POST  /api/records
  reviews.js           # GET / POST  /api/reviews
  odds/
    snapshots.js       # GET  /api/odds/snapshots
    history.js         # GET  /api/odds/history?source=...
  cron/
    sync-odds.js       # Vercel Cron 定时跑，刷新 odds:* keys
```

**所有 endpoint 必备的 env 校验**：开头就 `if (!url || !token) return res.status(500).json({ error: 'Missing required environment variables' })`，让问题**立刻暴露在响应里**，不要在 Redis 客户端里静默挂掉。

## 7. 常见坑

- **CORS**：`api/` 下的 Vercel Functions 默认同源 OK；前端在 GitHub Pages 上跑会跨域。检查每个 endpoint 的 `Access-Control-Allow-*` header 配置。
- **CORS preflight (OPTIONS)**：POST 带 `content-type: application/json` 浏览器会先发 OPTIONS 探活。Function 里要么**显式处理** OPTIONS 返回 204，要么**走 Vercel 的 `vercel.json` headers 配置**。
- **deviceId 未传**：`/api/records?deviceId=` 空字符串会让 Redis 写 `device::records`，污染数据。后端要 `if (!deviceId) return res.status(400).json({ error: 'deviceId required' })`。
- **写入频率**：前端 fire-and-forget 没事，但批量同步（比如首次 onboarding 把本地一堆记录全 push 上去）要**加个 throttle**，避免触发 Upstash 限流。
- **CRON 时区**：Vercel Cron 用 UTC。`vercel.json` 里配 `crons: [{ schedule: '0 * * * *' }]` 是 UTC，**不是**北京时间。
- **删除设备数据**：先 `KEYS device:<id>:*` 找到 key，再 DEL。**不要**写 SCAN 模糊匹配全库删（生产里这俩 prefix 之外可能还有别的 key）。

## 8. 本地调试

```bash
# 起前端静态服务
npm run dev    # npx -y serve .

# 起 Vercel Functions（带 env 注入）
vercel dev
```

`vercel dev` 跟生产 env 注入逻辑一样——**连了 Storage 才有 Upstash 变量**。本地没接 Storage 就跑 `vercel env pull .env.local` 把 env 拉到本地也行。
