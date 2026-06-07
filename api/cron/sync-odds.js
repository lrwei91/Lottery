/**
 * 三大数据源统一 cron endpoint
 * 路由：
 *   POST /api/cron/sync-odds           # Vercel Cron 调用，拉所有源
 *   GET  /api/cron/sync-odds?source=…  # 手动触发单个
 *
 * 数据源：
 *   - polymarket（POLYMARKET_PUBLIC_ENABLED=true 时启用）
 *   - the-odds-api（ODDS_API_KEY 时启用）
 *   - football-data（FOOTBALL_DATA_API_KEY 时启用）
 *
 * 失败 fallback：
 *   - 任一源失败只 warn，不阻塞其他源
 *   - 没配置 env var 整源跳过
 *
 * 输出到 Vercel KV（@upstash/redis client）：
 *   odds:snapshot:polymarket    → 最新冠军市场
 *   odds:snapshot:the-odds-api  → 最新赔率
 *   odds:snapshot:football-data → 最新赛程+比分
 *   odds:snapshot:_meta         → 拉取时间 + 健康度
 */

import { Redis } from '@upstash/redis';

let _redis = null;
function getRedis() {
  if (_redis) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  _redis = new Redis({ url, token });
  return _redis;
}

const KV_KEYS = {
  polymarket: 'odds:snapshot:polymarket',
  'the-odds-api': 'odds:snapshot:the-odds-api',
  'football-data': 'odds:snapshot:football-data',
  meta: 'odds:snapshot:_meta'
};

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ============================================================
// Polymarket 公开模式（无需 API key）
// ============================================================
async function fetchPolymarket() {
  const enabled = process.env.POLYMARKET_PUBLIC_ENABLED === 'true';
  if (!enabled) return { skipped: true, reason: 'POLYMARKET_PUBLIC_ENABLED != true' };

  const tagId = process.env.POLYMARKET_TAG_ID || '102467'; // 2026 World Cup
  const limit = process.env.POLYMARKET_LIMIT || '100';
  const url = `https://gamma-api.polymarket.com/events?tag_id=${tagId}&active=true&closed=false&limit=${limit}`;

  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`Polymarket HTTP ${res.status}`);
  const events = await res.json();

  // 标准化输出：冠军市场（找 2026 World Cup Winner 之类的 event）
  // 注意：Polymarket Gamma API 的 outcomes / outcomePrices 是 JSON 编码的字符串
  const normalized = {
    fetchedAt: new Date().toISOString(),
    events: (events || []).map(ev => {
      const evOutcomes = [];
      (ev.markets || []).forEach(m => {
        const names = parseJsonArray(m.outcomes);
        const prices = parseJsonArray(m.outcomePrices);
        if (!names || !prices || names.length !== prices.length) return;
        names.forEach((name, i) => {
          const price = Number(prices[i] ?? 0);
          if (price > 0 && price < 1) {
            evOutcomes.push({
              name,
              price,
              decimalOdds: 1 / price
            });
          }
        });
      });
      return {
        id: ev.id,
        slug: ev.slug,
        title: ev.title,
        active: ev.active,
        closed: ev.closed,
        outcomes: evOutcomes
      };
    }),
    source: 'polymarket-gamma-api'
  };
  return normalized;
}

function parseJsonArray(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch (_) { return null; }
  }
  return null;
}

// ============================================================
// The Odds API
// ============================================================
async function fetchOddsAPI() {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) return { skipped: true, reason: 'ODDS_API_KEY not set' };

  const sport = process.env.ODDS_SPORT_KEY || 'soccer_fifa_world_cup';
  const regions = process.env.ODDS_REGIONS || 'us,uk,eu';
  const markets = process.env.ODDS_MARKETS || 'h2h,spreads,totals';
  const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${apiKey}&regions=${regions}&markets=${markets}&oddsFormat=decimal`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`The Odds API HTTP ${res.status}`);
  const events = await res.json();

  return {
    fetchedAt: new Date().toISOString(),
    events: events.map(ev => ({
      id: ev.id,
      sport: ev.sport_key,
      commence: ev.commence_time,
      home: ev.home_team,
      away: ev.away_team,
      bookmakers: (ev.bookmakers || []).map(bk => ({
        key: bk.key,
        title: bk.title,
        markets: (bk.markets || []).map(m => ({
          key: m.key,
          outcomes: (m.outcomes || []).map(o => ({
            name: o.name,
            decimalOdds: o.price,
            point: o.point
          }))
        }))
      }))
    })),
    source: 'the-odds-api-v4'
  };
}

// ============================================================
// football-data.org
// ============================================================
async function fetchFootballData() {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  if (!apiKey) return { skipped: true, reason: 'FOOTBALL_DATA_API_KEY not set' };

  // 国际足联世界杯的 competition id
  const competition = '2000'; // FIFA World Cup
  const dateFrom = process.env.FOOTBALL_DATA_DATE_FROM || '';
  const dateTo = process.env.FOOTBALL_DATA_DATE_TO || '';
  const params = new URLSearchParams();
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);

  const url = `https://api.football-data.org/v4/competitions/${competition}/matches?${params}`;
  const res = await fetch(url, { headers: { 'X-Auth-Token': apiKey } });
  if (!res.ok) throw new Error(`football-data.org HTTP ${res.status}`);
  const payload = await res.json();

  return {
    fetchedAt: new Date().toISOString(),
    competition: payload.competition,
    matches: (payload.matches || []).map(m => ({
      id: m.id,
      utcDate: m.utcDate,
      status: m.status,
      matchday: m.matchday,
      stage: m.stage,
      group: m.group,
      homeTeam: m.homeTeam?.name,
      awayTeam: m.awayTeam?.name,
      score: m.score ? {
        fullTime: { home: m.score.fullTime?.home, away: m.score.fullTime?.away },
        halfTime: { home: m.score.halfTime?.home, away: m.score.halfTime?.away }
      } : null,
      venue: m.venue,
      lastUpdated: m.lastUpdated
    })),
    source: 'football-data-org-v4'
  };
}

// ============================================================
// 主调度
// ============================================================
const SOURCES = {
  polymarket: fetchPolymarket,
  'the-odds-api': fetchOddsAPI,
  'football-data': fetchFootballData
};

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).json({ ok: true });
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sourceParam = req.query?.source;
  const targets = sourceParam
    ? { [sourceParam]: SOURCES[sourceParam] }
    : SOURCES;

  if (sourceParam && !SOURCES[sourceParam]) {
    return res.status(400).json({ error: `Unknown source: ${sourceParam}. Use one of: ${Object.keys(SOURCES).join(', ')}` });
  }

  const redis = getRedis();
  const results = {};
  const startedAt = new Date().toISOString();

  for (const [name, fetcher] of Object.entries(targets)) {
    if (!fetcher) continue;
    try {
      const data = await fetcher();
      results[name] = { ok: true, data };
      if (redis && data && !data.skipped) {
        await redis.set(KV_KEYS[name], data, { ex: 60 * 60 * 6 }); // 6h TTL
      }
    } catch (err) {
      console.error(`[sync-odds] ${name} failed:`, err);
      results[name] = { ok: false, error: err?.message || String(err) };
    }
  }

  const meta = {
    startedAt,
    finishedAt: new Date().toISOString(),
    kvEnabled: !!redis,
    results: Object.fromEntries(
      Object.entries(results).map(([k, v]) => [k, v.ok ? 'ok' : (v.error?.includes('not set') || v.error?.includes('!= true') ? 'skipped' : 'error')])
    )
  };
  if (redis) {
    try { await redis.set(KV_KEYS.meta, meta, { ex: 60 * 60 * 24 }); } catch (_) {}
  }

  return res.status(200).json({ meta, results });
}
