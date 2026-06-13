/**
 * World Cup 2026 赛程 + 比分同步
 * - 拉 FIFA v3 calendar API → 标准化 → 写 Redis matches:snapshot
 * - 前端 /api/matches 读这个 key 拿到最新比分 (已结束比赛 sourceStatus=10/11/12 + homeScore/awayScore)
 * - 失败 fallback: 不阻塞, 保留旧 snapshot
 *
 * 路由：
 *   POST /api/cron/sync-matches                   # Vercel Cron 调用, 6h 一次
 *   GET  /api/cron/sync-matches                    # 手动触发 (需 CRON_SECRET 鉴权)
 *
 * 鉴权：跟 sync-odds 一样 — Authorization: Bearer ${CRON_SECRET}
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

const KV_KEY = 'matches:snapshot';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const TEAM_NAME_ALIASES = {
  'Bosnia-Herzegovina': 'Bosnia and Herzegovina',
  'Cabo Verde': 'Cape Verde',
  'Congo DR': 'DR Congo',
  "Côte d'Ivoire": 'Ivory Coast',
  'Czechia': 'Czech Republic',
  'IR Iran': 'Iran',
  'Korea Republic': 'South Korea',
  'Türkiye': 'Turkey'
};

// FIFA v3 sourceStatus → 我们的 status 字符串
// 0=unknown, 1=scheduled, 2=scheduled, 3-9/15-17=live, 10-12=completed, 13=abandoned
const STATUS_MAP = {
  0: 'unknown',
  1: 'scheduled', 2: 'scheduled',
  3: 'live', 4: 'live', 5: 'live', 6: 'live', 7: 'live', 8: 'live', 9: 'live',
  10: 'completed', 11: 'completed', 12: 'completed',
  13: 'abandoned',
  15: 'live', 16: 'live', 17: 'live'
};

function pickLocalized(values) {
  if (!Array.isArray(values) || !values.length) return '';
  for (const item of values) {
    if ((item?.Locale || '').toLowerCase().startsWith('en')) return item?.Description || '';
  }
  return values[0]?.Description || '';
}

function normalizeTeam(team) {
  if (!team) return '';
  const raw = team.ShortClubName || pickLocalized(team.TeamName) || '';
  return TEAM_NAME_ALIASES[raw] || raw;
}

function normalizeStatus(sourceStatus) {
  const n = Number(sourceStatus);
  return STATUS_MAP[n] || 'unknown';
}

async function fetchFifaCalendar() {
  // FIFA v3 calendar matches
  // idCompetition=17 (FIFA World Cup) + idSeason=285023 (2026)
  const url = 'https://api.fifa.com/api/v3/calendar/matches?language=en&count=500&idCompetition=17&idSeason=285023';
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 20000);
  let res;
  try {
    res = await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(tid);
  }
  if (!res.ok) throw new Error(`FIFA API HTTP ${res.status}`);
  return res.json();
}

async function fetchHeadToHead(matchId) {
  if (!matchId) return null;
  const url = `https://api.fifa.com/api/v3/headtohead?matchId=${encodeURIComponent(matchId)}&language=en`;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(tid);
  }
}

function parseHeadToHead(raw) {
  // FIFA H2H response shape 不稳定, 容错处理
  if (!raw) return null;
  const matches = Array.isArray(raw.Matches) ? raw.Matches : Array.isArray(raw.matches) ? raw.matches : [];
  const teams = Array.isArray(raw.Teams) ? raw.Teams : Array.isArray(raw.teams) ? raw.teams : [];
  if (!matches.length) return null;
  let wHome = 0, draws = 0, wAway = 0, goalsHome = 0, goalsAway = 0;
  for (const m of matches) {
    const home = normalizeTeam(m.HomeTeam || m.homeTeam);
    const away = normalizeTeam(m.AwayTeam || m.awayTeam);
    const homeScore = Number(m.HomeTeamScore ?? m.homeTeamScore ?? m.homeScore ?? 0);
    const awayScore = Number(m.AwayTeamScore ?? m.awayTeamScore ?? m.awayScore ?? 0);
    if (homeScore > awayScore) wHome++;
    else if (homeScore < awayScore) wAway++;
    else draws++;
    goalsHome += homeScore;
    goalsAway += awayScore;
  }
  return {
    source: 'FIFA head-to-head statistics API',
    wHome, draws, wAway, total: matches.length,
    goalsHome, goalsAway,
    matches: matches.slice(0, 10).map(m => {
      const home = normalizeTeam(m.HomeTeam || m.homeTeam);
      const away = normalizeTeam(m.AwayTeam || m.awayTeam);
      return {
        date: (m.MatchDate || m.matchDate || m.Date || '').slice(0, 10),
        competition: m.CompetitionName || m.competitionName || '',
        stage: m.StageName || m.stageName || '',
        home,
        away,
        homeScore: Number(m.HomeTeamScore ?? m.homeTeamScore ?? m.homeScore ?? 0),
        awayScore: Number(m.AwayTeamScore ?? m.awayTeamScore ?? m.awayScore ?? 0)
      };
    })
  };
}

function normalizeMatch(raw) {
  const homeTeam = raw.HomeTeam || raw.homeTeam;
  const awayTeam = raw.AwayTeam || raw.awayTeam;
  const stage = raw.StageName || raw.stageName || '';
  const group = raw.GroupName || raw.groupName || (raw.Group && raw.Group.GroupName) || '';
  const homeScore = (raw.HomeTeamScore ?? raw.homeTeamScore);
  const awayScore = (raw.AwayTeamScore ?? raw.awayTeamScore);
  const sourceStatus = Number(raw.MatchStatus ?? raw.matchStatus ?? 0);
  return {
    id: String(raw.Id || raw.MatchId || raw.matchId || ''),
    matchNumber: raw.MatchNumber || raw.matchNumber || null,
    group,
    groupLetter: raw.GroupLetter || raw.groupLetter || (group.match(/Group\s+([A-Z])/i)?.[1] || ''),
    matchDay: raw.MatchDay || raw.matchDay || null,
    date: (raw.MatchDate || raw.matchDate || '').slice(0, 10),
    time: (raw.MatchTime || raw.matchTime || '').slice(0, 5),
    venue: raw.StadiumName || raw.stadiumName || '',
    city: raw.CityName || raw.cityName || '',
    home: normalizeTeam(homeTeam),
    away: normalizeTeam(awayTeam),
    homeScore: homeScore != null ? Number(homeScore) : null,
    awayScore: awayScore != null ? Number(awayScore) : null,
    status: normalizeStatus(sourceStatus),
    sourceStatus,
    stage,
    lastUpdated: raw.UpdatedDate || raw.updatedDate || null
  };
}

async function buildMatches() {
  const data = await fetchFifaCalendar();
  const results = Array.isArray(data?.Results) ? data.Results : Array.isArray(data?.results) ? data.results : [];
  const matches = results.map(normalizeMatch).filter(m => m.id);
  // 拉 H2H 只针对"已结束"比赛, limit 一下避免超额 (FIFA API 不一定稳定)
  const completed = matches.filter(m => m.status === 'completed');
  let h2hOk = 0, h2hFail = 0;
  for (const m of completed) {
    const h2h = await fetchHeadToHead(m.id);
    const parsed = parseHeadToHead(h2h);
    if (parsed) {
      m.headToHead = parsed;
      h2hOk++;
    } else {
      h2hFail++;
    }
  }
  return { matches, h2hOk, h2hFail };
}

function groupByGroupLetter(matches) {
  const groups = {};
  for (const m of matches) {
    const letter = m.groupLetter || '?';
    if (!groups[letter]) groups[letter] = { teams: [], matches: [] };
    groups[letter].matches.push(m);
  }
  // 收集 4 队名单
  for (const letter of Object.keys(groups)) {
    const teamSet = new Set();
    for (const m of groups[letter].matches) {
      if (m.home) teamSet.add(m.home);
      if (m.away) teamSet.add(m.away);
    }
    groups[letter].teams = Array.from(teamSet).sort();
    // 按时间排序
    groups[letter].matches.sort((a, b) => {
      const ta = (a.date + 'T' + (a.time || '00:00')).replace(' ', 'T');
      const tb = (b.date + 'T' + (b.time || '00:00')).replace(' ', 'T');
      return ta.localeCompare(tb);
    });
  }
  return groups;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).json({ ok: true });
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 鉴权 (跟 sync-odds 一致)
  const auth = req.headers?.authorization || '';
  const expected = process.env.CRON_SECRET;
  if (!expected) return res.status(503).json({ error: 'CRON_SECRET not configured' });
  if (auth !== `Bearer ${expected}`) return res.status(401).json({ error: 'Unauthorized' });

  const redis = getRedis();
  if (!redis) {
    return res.status(503).json({ error: 'Upstash Redis env not configured' });
  }

  const startedAt = new Date().toISOString();
  try {
    const { matches, h2hOk, h2hFail } = await buildMatches();
    const groups = groupByGroupLetter(matches);
    const payload = {
      metadata: {
        lastUpdated: new Date().toISOString(),
        generatedBy: 'api/cron/sync-matches.js',
        sourceName: 'FIFA public calendar API',
        sourceUrl: 'https://api.fifa.com/api/v3/calendar/matches?language=en&count=500&idCompetition=17&idSeason=285023',
        sourceDataDate: new Date().toISOString().slice(0, 10),
        teamCount: new Set(matches.flatMap(m => [m.home, m.away])).size,
        matchCount: matches.length,
        h2hAttached: h2hOk,
        h2hFailed: h2hFail,
        note: 'Synced every 6h via Vercel Cron. worldcup_matches.json is git-tracked fallback when Redis is empty.'
      },
      groups
    };
    await redis.set(KV_KEY, payload, { ex: 60 * 60 * 12 }); // 12h TTL (cron 6h, 留 2 倍 buffer)
    return res.status(200).json({
      ok: true,
      meta: {
        startedAt,
        finishedAt: new Date().toISOString(),
        matchCount: matches.length,
        h2hOk,
        h2hFail
      }
    });
  } catch (err) {
    console.error('[sync-matches] failed:', err);
    return res.status(500).json({
      ok: false,
      error: err?.message || String(err),
      startedAt,
      finishedAt: new Date().toISOString()
    });
  }
}
