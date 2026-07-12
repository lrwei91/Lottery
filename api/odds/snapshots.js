/**
 * 从 Vercel KV 读取 odds snapshot（前端使用）
 *
 * GET /api/odds/snapshots
 *   → {
 *       meta: { startedAt, finishedAt, kvEnabled, results },
 *       'polymarket-h2h':     {...} | null,   // 72 场 1X2 单场（series 11433）
 *       polymarket:           {...} | null,   // tag 102350 衍生品（向后兼容）
 *       'polymarket-outright':{...} | null,   // 冠军 outright 二元市场
 *       'the-odds-api':       {...} | null,
 *       'football-data':      {...} | null,
 *     }
 *
 * 如果某个 key 不存在（cron 还没跑过 / 未配 env），对应字段是 null。
 */

import { getRedis } from '../_lib/redis.js';
import { internalError, setCors } from '../_lib/http.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).json({ ok: true });
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const redis = getRedis({ required: false });
  if (!redis) {
    return res.status(503).json({
      error: 'Upstash Redis env not configured',
      hint: 'Vercel Dashboard → Storage → Marketplace → Upstash Redis'
    });
  }

  // ?probe=the-odds-api: 现场打一次, 立刻返最近 HTTP 状态 + body, 排查 401/422/429
  // 不消耗 Upstash 配额, 不影响 KV
  const probe = (req.query?.probe || '').toLowerCase();
  if (probe === 'the-odds-api') {
    const apiKey = process.env.ODDS_API_KEY;
    if (!apiKey) {
      return res.status(200).json({ ok: false, error: 'ODDS_API_KEY not set in Vercel env' });
    }
    const sport = process.env.ODDS_SPORT_KEY || 'soccer_fifa_world_cup';
    const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${apiKey}&regions=us&markets=h2h&oddsFormat=decimal`;
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 8000);
    let resp, body = null;
    try {
      resp = await fetch(url, { signal: ctrl.signal });
      try { body = await resp.json(); } catch (_) {}
    } catch (e) {
      clearTimeout(tid);
      return res.status(200).json({ ok: false, error: `fetch failed: ${e?.message || e}`, sport });
    }
    clearTimeout(tid);
    return res.status(200).json({
      ok: resp.ok,
      status: resp.status,
      sport,
      eventCount: Array.isArray(body) ? body.length : 0,
      sample: Array.isArray(body) ? body.slice(0, 2) : body,
      remainingQuota: resp.headers.get('x-requests-remaining'),
      usedQuota: resp.headers.get('x-requests-used')
    });
  }

  try {
    const [meta, polymarketH2H, polymarket, polymarketOutright, theOddsApi, footballData] = await Promise.all([
      redis.get('odds:snapshot:_meta'),
      redis.get('odds:snapshot:polymarket-h2h'),
      redis.get('odds:snapshot:polymarket'),
      redis.get('odds:snapshot:polymarket-outright'),
      redis.get('odds:snapshot:the-odds-api'),
      redis.get('odds:snapshot:football-data')
    ]);

    return res.status(200).json({
      meta,
      'polymarket-h2h': polymarketH2H,
      polymarket,
      'polymarket-outright': polymarketOutright,
      'the-odds-api': theOddsApi,
      'football-data': footballData
    });
  } catch (error) {
    return internalError(res, 'api/odds/snapshots error:', error);
  }
}
