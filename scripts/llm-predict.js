#!/usr/bin/env node
/**
 * 本地 / 云端 LLM 跑 2026 世界杯预测
 *
 * 静态数据源（已 git tracked 的 JSON）：
 *   - data/worldcup_2026.json      球队基础数据（Elo / final_prob / factor scores / players）
 *   - data/worldcup_matches.json   赛程（含已结束比分 + venue 字符串）
 *   - data/worldcup_names.json     中英文名映射
 *
 * 实时数据源（每次跑现拉，token 节省优先）：
 *   - The Odds API h2h           ← Vercel KV snapshot (odds:snapshot:the-odds-api)
 *   - Polymarket h2h             ← Vercel KV snapshot (odds:snapshot:polymarket)
 *   - Open-Meteo 天气            ← 按场馆 lat/lon 实时查 (无 key, 免费)
 *   - 球员名单（已有 worldcup_2026.json 里） + 海拔/场地（解析 venue）
 *   - 伤病                       ⚠️ 当前无稳定源, 标注 "未拉取" + 提示 LLM 避免瞎猜
 *
 * 输出：
 *   - data/wc_llm_predictions.json   h2h 单场胜平负（24 场）
 *   - data/wc_llm_outright.json      冠军 outright（48 队）
 *
 * Mode（argv[2]）：
 *   node scripts/llm-predict.js h2h        # 只跑 h2h（默认）
 *   node scripts/llm-predict.js outright   # 只跑冠军
 *   node scripts/llm-predict.js all        # 跑两个（串行）
 *
 * 用法：
 *   # 默认：调 Ollama 本地服务 (http://localhost:11434)
 *   node scripts/llm-predict.js
 *
 *   # 一键跑 h2h + 冠军（最常用）
 *   npm run llm:predict:all
 *
 *   # 小米 MiMo（Anthropic 协议，需要 API key）
 *   LLM_PROVIDER=xiaomi \
 *     XIAOMI_API_KEY=tp-xxxxx \
 *     npm run llm:predict:all
 *   # 或在 .env 里写 LLM_PROVIDER=xiaomi / XIAOMI_API_KEY=tp-xxxxx，直接 npm run llm:predict:all
 *
 *   # 任意 OpenAI 兼容 endpoint
 *   LLM_PROVIDER=openai LLM_BASE_URL=https://api.openai.com LLM_MODEL=gpt-4o-mini \
 *     XIAOMI_API_KEY=sk-xxxxx npm run llm:predict:all
 *
 *   # 干跑（不写文件）
 *   npm run llm:predict:all:dry
 *
 * Provider 选择优先级：LLM_PROVIDER 环境变量 > ENDPOINT 自动检测 > 默认 ollama
 *
 * 安全：API key 一律从 XIAOMI_API_KEY 环境变量 / .env / BWS 读，绝不入 git。
 *      （2026-06-12 从 LLM_API_KEY 改名为 XIAOMI_API_KEY,本项目当前唯一 LLM provider）
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

// ============ .env 简易 loader（无依赖） ============
// 解析 `KEY=value` 行，跳过注释和空行；不覆盖已存在的 env
function loadDotenv(envPath) {
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf-8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const m = trimmed.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i);
    if (!m) continue;
    const [, key, rawVal] = m;
    const val = rawVal.replace(/^['"]|['"]$/g, ''); // 去掉两端引号
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadDotenv(path.join(ROOT, '.env'));
loadDotenv(path.join(__dirname, '.env'));

// ============ 配置 ============
const TEMPERATURE = Number(process.env.LLM_TEMPERATURE || '0.3');
const DRY_RUN = process.env.DRY_RUN === '1';
const MAX_TOKENS = Number(process.env.LLM_MAX_TOKENS || '4000');

// Provider 选择：显式 > 自动检测
function autoDetectProvider(endpoint) {
  if (endpoint.includes('xiaomimimo.com') || /\/anthropic(\/|$)/.test(endpoint)) return 'xiaomi';
  if (endpoint.includes('localhost:11434') || endpoint.endsWith('/api/chat')) return 'ollama';
  if (endpoint.endsWith('/v1/chat/completions')) return 'openai';
  return 'ollama'; // fallback
}

// Provider 默认值
const PROVIDER_DEFAULTS = {
  ollama: { endpoint: 'http://localhost:11434/api/chat', model: 'llama3.2' },
  openai: { endpoint: 'http://localhost:1234/v1/chat/completions', model: 'gpt-4o-mini' },
  xiaomi: { baseUrl: 'https://token-plan-cn.xiaomimimo.com/anthropic', model: 'mimo-v2.5-pro' }
};
const _initialEndpoint = process.env.LLM_ENDPOINT || PROVIDER_DEFAULTS.ollama.endpoint;
const PROVIDER = process.env.LLM_PROVIDER || autoDetectProvider(_initialEndpoint);

// 根据 provider 解析最终 endpoint / model / baseUrl
function resolveConfig() {
  if (PROVIDER === 'xiaomi') {
    return {
      endpoint: null, // xiaomi 用 baseUrl + /v1/messages
      baseUrl: process.env.LLM_BASE_URL || PROVIDER_DEFAULTS.xiaomi.baseUrl,
      model: process.env.LLM_MODEL || PROVIDER_DEFAULTS.xiaomi.model
    };
  }
  if (PROVIDER === 'openai') {
    return {
      endpoint: process.env.LLM_ENDPOINT || PROVIDER_DEFAULTS.openai.endpoint,
      model: process.env.LLM_MODEL || PROVIDER_DEFAULTS.openai.model
    };
  }
  // ollama
  return {
    endpoint: process.env.LLM_ENDPOINT || PROVIDER_DEFAULTS.ollama.endpoint,
    model: process.env.LLM_MODEL || PROVIDER_DEFAULTS.ollama.model
  };
}

const TEAMS_PATH = path.join(ROOT, 'data', 'worldcup_2026.json');
const MATCHES_PATH = path.join(ROOT, 'data', 'worldcup_matches.json');
const NAMES_PATH = path.join(ROOT, 'data', 'worldcup_names.json');
const H2H_OUT_PATH = path.join(ROOT, 'data', 'wc_llm_predictions.json');
const OUTRIGHT_OUT_PATH = path.join(ROOT, 'data', 'wc_llm_outright.json');

const MODE = (process.argv[2] || 'h2h').toLowerCase(); // h2h | outright | all
const VALID_MODES = new Set(['h2h', 'outright', 'all']);
if (!VALID_MODES.has(MODE)) {
  console.error(`✗ 未知 mode: ${MODE}。可选: h2h | outright | all`);
  process.exit(1);
}

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function ensureInputs() {
  for (const p of [TEAMS_PATH, MATCHES_PATH, NAMES_PATH]) {
    if (!fs.existsSync(p)) {
      console.error(`✗ 缺少数据文件: ${p}`);
      process.exit(1);
    }
  }
}

// ============================================================
// Venue 元数据 (2026 世界杯 16 个场馆)
// lat/lon 用于 Open-Meteo 实时天气查询
// altitude_m 用于海平面以上高度 (墨西哥城 2240m 对球员体能影响显著)
// ============================================================
const VENUE_META = {
  'Atlanta Stadium, Atlanta':                  { city: 'Atlanta',              lat: 33.7490, lon: -84.3880, altitude_m: 320, country: 'US' },
  'BC Place Vancouver, Vancouver':             { city: 'Vancouver',            lat: 49.2827, lon: -123.1207, altitude_m: 70, country: 'CA' },
  'Boston Stadium, Boston':                    { city: 'Boston',               lat: 42.3601, lon: -71.0589, altitude_m: 43, country: 'US' },
  'Dallas Stadium, Dallas':                    { city: 'Dallas',               lat: 32.7767, lon: -96.7970, altitude_m: 131, country: 'US' },
  'Guadalajara Stadium, Guadalajara':          { city: 'Guadalajara',          lat: 20.6875, lon: -103.3475, altitude_m: 1566, country: 'MX' },
  'Houston Stadium, Houston':                  { city: 'Houston',              lat: 29.7604, lon: -95.3698, altitude_m: 13, country: 'US' },
  'Kansas City Stadium, Kansas City':          { city: 'Kansas City',          lat: 39.0997, lon: -94.5786, altitude_m: 265, country: 'US' },
  'Los Angeles Stadium, Los Angeles':          { city: 'Los Angeles',          lat: 34.0522, lon: -118.2437, altitude_m: 71, country: 'US' },
  'Mexico City Stadium, Mexico City':          { city: 'Mexico City',          lat: 19.4326, lon: -99.1332, altitude_m: 2240, country: 'MX' },
  'Miami Stadium, Miami':                      { city: 'Miami',                lat: 25.7617, lon: -80.1918, altitude_m: 2, country: 'US' },
  'Monterrey Stadium, Monterrey':              { city: 'Monterrey',            lat: 25.6515, lon: -100.2882, altitude_m: 540, country: 'MX' },
  'New York/New Jersey Stadium, New Jersey':   { city: 'East Rutherford',      lat: 40.8136, lon: -74.0746, altitude_m: 8, country: 'US' },
  'Philadelphia Stadium, Philadelphia':        { city: 'Philadelphia',         lat: 39.9526, lon: -75.1652, altitude_m: 12, country: 'US' },
  'San Francisco Bay Area Stadium, San Francisco Bay Area': { city: 'Santa Clara', lat: 37.3541, lon: -121.9552, altitude_m: 21, country: 'US' },
  'Seattle Stadium, Seattle':                  { city: 'Seattle',              lat: 47.6062, lon: -122.3321, altitude_m: 56, country: 'US' },
  'Toronto Stadium, Toronto':                  { city: 'Toronto',              lat: 43.6532, lon: -79.3832, altitude_m: 76, country: 'CA' }
};

function resolveVenue(venueStr) {
  return VENUE_META[venueStr] || null;
}

// 2026 已知 6 个高海拔场馆 (>1000m, 影响球员体能, LLM 需关注)
//   Mexico City (2240m), Guadalajara (1566m), Monterrey (540m - 中等),
//   Denver 不在 2026 名单, 但海拔影响程度仍按 >1000m 标记
const HIGH_ALTITUDE_VENUES = new Set([
  'Mexico City Stadium, Mexico City',
  'Guadalajara Stadium, Guadalajara'
]);

// ============================================================
// 实时数据 Fetchers
// 注: 全部带 graceful fallback, 单源失败不阻塞其他源
// ============================================================

// 1) The Odds API h2h — 走 Vercel KV snapshot
//    Upstash Redis REST API: GET https://{url}/get/{key}
async function fetchOddsApiH2H() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    return { skipped: true, reason: 'UPSTASH/KV env not set' };
  }
  try {
    const res = await fetch(`${url.replace(/\/+$/, '')}/get/odds:snapshot:the-odds-api`, {
      headers: { authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      return { skipped: true, reason: `Upstash HTTP ${res.status}` };
    }
    const data = await res.json();
    if (!data || !data.result) return { skipped: true, reason: 'KV empty' };
    const payload = JSON.parse(data.result);
    const events = Array.isArray(payload.events) ? payload.events : [];
    return { events, fetchedAt: payload.fetchedAt || null };
  } catch (e) {
    return { skipped: true, reason: `Upstash error: ${e.message}` };
  }
}

// 2) Polymarket h2h — 同样走 KV
async function fetchPolymarketH2H() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    return { skipped: true, reason: 'UPSTASH/KV env not set' };
  }
  try {
    const res = await fetch(`${url.replace(/\/+$/, '')}/get/odds:snapshot:polymarket`, {
      headers: { authorization: `Bearer ${token}` }
    });
    if (!res.ok) return { skipped: true, reason: `Upstash HTTP ${res.status}` };
    const data = await res.json();
    if (!data || !data.result) return { skipped: true, reason: 'KV empty' };
    const payload = JSON.parse(data.result);
    const events = Array.isArray(payload.events) ? payload.events : [];
    return { events, fetchedAt: payload.fetchedAt || null };
  } catch (e) {
    return { skipped: true, reason: `Upstash error: ${e.message}` };
  }
}

// 3) Open-Meteo 天气 — 按 venue lat/lon 实时查
//    公共 endpoint, 无 key, 无频率限制 (RPS 友好, 但加 timeout)
//    文档: https://open-meteo.com/en/docs
//    返回比赛日 local 14:00 / 20:00 (比赛常见时段) 的温度/湿度/风速
async function fetchWeather(venueMeta, dateStr, timeStr) {
  if (!venueMeta) return null;
  // dateStr: YYYY-MM-DD, timeStr: HH:MM (UTC)
  // Open-Meteo 接受 ISO 8601 datetime
  const isoDate = dateStr + 'T' + timeStr;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${venueMeta.lat}&longitude=${venueMeta.lon}&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,precipitation_probability&timezone=UTC&start_date=${dateStr}&end_date=${dateStr}`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.hourly || !data.hourly.time) return null;
    // 找最接近比赛时间的那一小时
    const target = new Date(isoDate + ':00Z').getTime();
    let bestIdx = 0;
    let bestDelta = Infinity;
    data.hourly.time.forEach((t, i) => {
      const dt = Math.abs(new Date(t + 'Z').getTime() - target);
      if (dt < bestDelta) { bestDelta = dt; bestIdx = i; }
    });
    const temp = data.hourly.temperature_2m?.[bestIdx];
    const humidity = data.hourly.relative_humidity_2m?.[bestIdx];
    const wind = data.hourly.wind_speed_10m?.[bestIdx];
    const precip = data.hourly.precipitation_probability?.[bestIdx];
    if (temp == null) return null;
    // WBGT 简化估算: WBGT ≈ 0.567*T + 0.393*e + 3.94 (Rothfusz 简化)
    //   e = (RH/100) * 6.105 * exp(17.27*T/(237.7+T))  (水汽压 hPa)
    // 这里只给 LLM T/RH/Wind 原始值, WBGT 留给 LLM 自行判断
    return {
      temp_c: Math.round(temp * 10) / 10,
      humidity_pct: humidity,
      wind_kmh: wind,
      precip_prob_pct: precip,
      altitude_m: venueMeta.altitude_m,
      city: venueMeta.city
    };
  } catch (e) {
    return null;
  }
}

// 4) 球员名单 (静态数据, 已在 worldcup_2026.json 里)
function fetchPlayersForTeam(teams, country) {
  const t = teams.find(x => x.country === country);
  if (!t || !Array.isArray(t.players)) return [];
  return t.players.map(p => ({
    name: p.name,
    position: p.position,
    age: p.age,
    club: p.club,
    market_value_m: p.market_value,
    caps: p.national_caps,
    goals: p.national_goals
  }));
}

// ============================================================
// 工具: 给定 matchId 找 The Odds API event
// ============================================================
function findOddsApiForMatch(events, match) {
  if (!Array.isArray(events) || !match) return null;
  return events.find(ev =>
    ev && ev.home === match.home && ev.away === match.away
  ) || null;
}

// 工具: 给定 matchId 找 Polymarket event (title 含双方国家名)
function findPolymarketForMatch(events, match, names) {
  if (!Array.isArray(events) || !match || !names) return null;
  const nameA = (names.countryNames?.[match.home] || match.home).toLowerCase();
  const nameB = (names.countryNames?.[match.away] || match.away).toLowerCase();
  return events.find(ev => {
    const t = (ev.title || '').toLowerCase();
    return t.includes(nameA) && t.includes(nameB);
  }) || null;
}

// 工具: 从 The Odds API event 提取 h2h 主流盘 (取第一个 bookmaker 的 h2h market)
function extractOddsApiH2H(event) {
  if (!event || !Array.isArray(event.bookmakers)) return null;
  for (const bk of event.bookmakers) {
    const h2h = (bk.markets || []).find(m => m.key === 'h2h');
    if (!h2h) continue;
    const home = h2h.outcomes.find(o => o.name === event.home);
    const away = h2h.outcomes.find(o => o.name === event.away);
    const draw = h2h.outcomes.find(o => o.name === 'Draw');
    if (home && away) {
      return {
        bookmaker: bk.title || bk.key,
        home_odds: home.decimalOdds,
        draw_odds: draw?.decimalOdds ?? null,
        away_odds: away.decimalOdds
      };
    }
  }
  return null;
}

// 工具: 从 Polymarket event 提取价格
function extractPolymarketPrices(event) {
  if (!event || !Array.isArray(event.outcomes)) return null;
  const os = event.outcomes;
  // Polymarket 是二元 (Yes/No), 通常 outcomes[0] = home win
  return {
    home_yes: os[0]?.decimalOdds != null ? (1 / os[0].decimalOdds) : null,
    away_no: os[1]?.decimalOdds != null ? (1 / os[1].decimalOdds) : null,
    raw_outcomes: os.map(o => ({ name: o.name, price: o.decimalOdds ? 1 / o.decimalOdds : null }))
  };
}

// ============ Provider 实现 ============

// Ollama /api/chat（默认）
async function callOllama(prompt, cfg) {
  const res = await fetch(cfg.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: cfg.model,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      options: { temperature: TEMPERATURE }
    })
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.message?.content || data.choices?.[0]?.message?.content || data.response || '';
}

// OpenAI 兼容 /v1/chat/completions
// 注:本项目当前只用 xiaomi provider (mimo-v2.5-pro),统一读 XIAOMI_API_KEY。
//    若未来需要切换 openai provider,应引入 LLM_API_KEY_<PROVIDER> 分键。
async function callOpenAI(prompt, cfg) {
  const headers = { 'content-type': 'application/json' };
  if (process.env.XIAOMI_API_KEY) headers['authorization'] = `Bearer ${process.env.XIAOMI_API_KEY}`;
  const res = await fetch(cfg.endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: cfg.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: TEMPERATURE,
      max_tokens: MAX_TOKENS
    })
  });
  if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

// 小米 MiMo：Anthropic 协议 /v1/messages
// 响应 content 是数组：[{type:'text',text:'...'}, {type:'thinking',thinking:'...'}]
// 按顺序提取所有 text block，thinking 不计入最终输出
// Key 来源:XIAOMI_API_KEY (Bitwarden / .env)
async function callXiaomi(prompt, cfg) {
  const key = process.env.XIAOMI_API_KEY;
  if (!key) {
    throw new Error('xiaomi provider 需要 XIAOMI_API_KEY 环境变量（或 .env / BWS 里写 XIAOMI_API_KEY=tp-xxxxx）');
  }
  const baseUrl = (cfg.baseUrl || PROVIDER_DEFAULTS.xiaomi.baseUrl).replace(/\/+$/, '');
  const url = `${baseUrl}/v1/messages`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Xiaomi HTTP ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = await res.json();
  const blocks = Array.isArray(data.content) ? data.content : [];
  const text = blocks
    .filter(b => b && b.type === 'text' && typeof b.text === 'string')
    .map(b => b.text)
    .join('\n')
    .trim();
  if (!text) {
    // 失败时把 thinking 暴露给用户便于诊断
    const thinking = blocks
      .filter(b => b && b.type === 'thinking')
      .map(b => b.thinking || '')
      .join('\n');
    throw new Error(`Xiaomi 响应无 text block（可能 max_tokens 太小被 thinking 耗尽）。stop_reason=${data.stop_reason}，thinking 预览: ${thinking.slice(0, 200)}`);
  }
  return text;
}

async function callLLM(prompt, cfg) {
  if (PROVIDER === 'xiaomi') return callXiaomi(prompt, cfg);
  if (PROVIDER === 'openai') return callOpenAI(prompt, cfg);
  if (PROVIDER === 'ollama') return callOllama(prompt, cfg);
  throw new Error(`Unknown provider: ${PROVIDER}`);
}

function buildH2HPrompt(matches, teams, names, realtimeCtx) {
  // 给 LLM 简洁的球队信息（top 12 强队）
  const topTeams = [...teams]
    .sort((a, b) => (b.final_prob || 0) - (a.final_prob || 0))
    .slice(0, 12)
    .map(t => ({
      country: t.country,
      cn: names.countryNames?.[t.country] || t.country,
      elo: Math.round(t.elo || 0),
      modElo: Math.round(t.mod_elo || t.elo || 0),
      prob: ((t.final_prob || 0) * 100).toFixed(2)
    }));

  // 选未来 7 天未开始的 24 场
  const now = Date.now();
  const upcoming = matches
    .filter(m => m.status === 'scheduled' && new Date(m.date + 'T' + m.time + ':00Z').getTime() > now)
    .sort((a, b) => new Date(a.date + 'T' + a.time + ':00Z') - new Date(b.date + 'T' + b.time + ':00Z'))
    .slice(0, 24);

  // 给每场比赛拼上下文 (球员 + 场地 + 天气 + 赔率)
  const oddsApiEvents = realtimeCtx.oddsApi?.events || [];
  const polyEvents = realtimeCtx.polymarket?.events || [];

  const matchContexts = upcoming.map(m => {
    const venue = resolveVenue(m.venue);
    const weather = venue ? realtimeCtx.weatherCache?.[m.id] : null;
    const oddsEv = findOddsApiForMatch(oddsApiEvents, m);
    const polyEv = findPolymarketForMatch(polyEvents, m, names);
    const oddsH2H = extractOddsApiH2H(oddsEv);
    const polyPrices = extractPolymarketPrices(polyEv);
    // top 3 球员 (按 market_value 降序)
    const playersHome = fetchPlayersForTeam(teams, m.home)
      .sort((a, b) => (b.market_value_m || 0) - (a.market_value_m || 0))
      .slice(0, 3);
    const playersAway = fetchPlayersForTeam(teams, m.away)
      .sort((a, b) => (b.market_value_m || 0) - (a.market_value_m || 0))
      .slice(0, 3);
    return { match: m, venue, weather, oddsH2H, polyPrices, playersHome, playersAway };
  });

  const sysPrompt = `你是一个 2026 FIFA 男足世界杯预测专家。你的预测必须**只基于下方提供的真实数据**，
不得引入未列出的球员姓名、伤停传闻或场外信息。如果某项数据标注"未拉取"或缺失，
请按该项"未知"处理，避免凭印象编造。

**每场比赛提供的数据**：
- 球队 Elo 评分 + 模型预测概率
- 比赛日期 / 时间 / 场馆 / 海拔 / 实时天气 (温度/湿度/风速/降水概率)
- The Odds API 主流盘 h2h 赔率 (去水后隐含概率) — 反映机构盘口共识
- Polymarket 二元市场 (Yes 价格) — 反映散户真钱投票
- 双方 top 3 球员 (按市场估值, 含位置/年龄/俱乐部) — 反映阵容深度

⚠️ **未提供的数据**（你不能假设）：
- 球员伤停状态 — **数据源未拉取, 请勿编造具体伤员**
- 教练战术细节
- 心理 / 玄学因素

**判断原则**：
1. 优先相信市场共识 (机构 + 散户赔率)
2. Elo + 球员阵容 + 场地条件作微调 (尤其高海拔 >1500m 场馆)
3. 数据冲突时, 在 confidence 里体现不确定性

为每场比赛输出 JSON，**严格遵循**以下结构（只输出 JSON 数组，不要其他文字）：

\`\`\`json
{
  "matches": [
    {
      "matchId": "<string>",
      "homeWinProb": <0-1 浮点>,
      "drawProb": <0-1 浮点>,
      "awayWinProb": <0-1 浮点>,
      "predictedOutcome": "<home|draw|away>",
      "confidence": <0-1 浮点>,
      "reasoning": "<中文 30-80 字>"
    }
  ]
}
\`\`\`

约束：
- 三项概率之和 = 1.0（容差 0.01）
- confidence 在 0.3-0.9 之间（避免极端值; 缺数据时取下限）
- reasoning 用中文, 简明扼要, 必须引用至少 1 个具体数据点 (赔率/Elo/球员名/场地)`;

  // 把每场比赛压成紧凑 1 行, 控制 token (~250 字符 / 场)
  const compactMatch = (ctx) => {
    const m = ctx.match;
    const homeCn = names.countryNames?.[m.home] || m.home;
    const awayCn = names.countryNames?.[m.away] || m.away;
    const venueName = ctx.venue?.city || m.venue;
    const alt = ctx.venue?.altitude_m;
    const altNote = alt && alt > 1000 ? ` [高海拔 ${alt}m]` : (alt != null ? ` [海拔 ${alt}m]` : '');
    // 天气
    let wStr = '天气未拉取';
    if (ctx.weather) {
      wStr = `天气 ${ctx.weather.temp_c}°C / 湿度 ${ctx.weather.humidity_pct}% / 风 ${ctx.weather.wind_kmh}km/h`;
    }
    // 赔率
    let oddsStr = '无赔率';
    if (ctx.oddsH2H) {
      const imp = (o) => o ? Math.round((1 / o) * 1000) / 10 : null;
      oddsStr = `机构盘 主 ${imp(ctx.oddsH2H.home_odds)}% / 平 ${imp(ctx.oddsH2H.draw_odds)}% / 客 ${imp(ctx.oddsH2H.away_odds)}%`;
    } else if (ctx.polyPrices?.home_yes != null) {
      oddsStr = `Polymarket 主 ${(ctx.polyPrices.home_yes * 100).toFixed(1)}%`;
    }
    // 球员 (仅列姓名+位置, 节省 token)
    const playerHStr = ctx.playersHome.length
      ? ctx.playersHome.map(p => `${p.name.split(' ').pop()}(${p.position})`).join(',')
      : '名单缺失';
    const playerAStr = ctx.playersAway.length
      ? ctx.playersAway.map(p => `${p.name.split(' ').pop()}(${p.position})`).join(',')
      : '名单缺失';
    return `matchId=${m.id} | ${m.date} ${m.time}Z | ${homeCn} vs ${awayCn} | 场地 ${venueName}${altNote} | ${wStr} | ${oddsStr} | 主: ${playerHStr} | 客: ${playerAStr}`;
  };

  // 数据源健康度提示 (告诉 LLM 缺什么)
  const sourceNotes = [];
  sourceNotes.push(realtimeCtx.oddsApi?.skipped
    ? `⚠️ The Odds API 未拉取 (${realtimeCtx.oddsApi.reason})`
    : `✓ The Odds API (${oddsApiEvents.length} 场赔率)`);
  sourceNotes.push(realtimeCtx.polymarket?.skipped
    ? `⚠️ Polymarket 未拉取 (${realtimeCtx.polymarket.reason})`
    : `✓ Polymarket (${polyEvents.length} 场)`);
  sourceNotes.push(realtimeCtx.weatherFetched > 0
    ? `✓ 天气 (${realtimeCtx.weatherFetched}/${upcoming.length} 场)`
    : `⚠️ 天气 0/${upcoming.length} 场 (Open-Meteo 全失败)`);
  sourceNotes.push('⚠️ 伤停数据未拉取 (无稳定源)');

  const userPrompt = `## 球队 Elo 概览（top 12）

${topTeams.map(t => `- ${t.cn} (${t.country}): Elo ${t.elo} / 修正 ${t.modElo} / 模型概率 ${t.prob}%`).join('\n')}

## 数据源状态

${sourceNotes.join('\n')}

## 待预测比赛（${upcoming.length} 场，每行 1 场）

${matchContexts.map(compactMatch).join('\n')}

请为每场比赛输出 JSON（仅输出 JSON 数组，每场一个对象, matchId 必须严格匹配）。`;

  return sysPrompt + '\n\n' + userPrompt;
}

// ============ 冠军 outright prompt + 校验 ============
// 默认每批 12 队 (mimo-v2.5-pro thinking-heavy, 48 队一锅端会炸 max_tokens)
// 跑 4 批后合并归一化, 不影响最终输出 schema
const OUTRIGHT_BATCH_SIZE = Number(process.env.OUTRIGHT_BATCH_SIZE || 12);

function buildOutrightPrompt(teams, names, batchTeams) {
  // batchTeams 不传 = 全部 (旧行为); 传了就只问这一批
  const subset = batchTeams || teams;
  // 48 队按修正 Elo 降序全部给 LLM
  const sorted = [...subset]
    .map(t => ({
      country: t.country,
      cn: names.countryNames?.[t.country] || t.country,
      elo: Math.round(t.elo || 0),
      modElo: Math.round(t.mod_elo || t.elo || 0),
      prob: ((t.final_prob || 0) * 100).toFixed(2)
    }))
    .sort((a, b) => b.modElo - a.modElo);

  const sysPrompt = `你是一个 2026 FIFA 男足世界杯冠军预测专家。
基于以下 Elo 评分、修正 Elo 和模型概率，输出全部 ${sorted.length} 队的夺冠概率。

输出严格 JSON（**只输出 JSON**，不要其他文字）：

\`\`\`json
{
  "predictions": [
    {
      "country": "<string>",
      "winProb": <0-1 浮点>,
      "rank": <1-N 整数>,
      "reasoning": "<中文 20-50 字>"
    }
  ]
}
\`\`\`

约束：
- country 必须是给定 ${sorted.length} 队列表中的 key（**完整匹配**，区分大小写）
- winProb 在 0-1 之间；最终脚本会归一化到总和=1
- rank 整数，1 表示最看好
- reasoning 中文 20-50 字
- 至少给出 12 支强队的完整预测（country/winProb/rank/reasoning），其他队可省略
- **不要参考任何市场赔率**，独立基于 Elo + 阵容深度 + 教练 + 赛程综合判断`;

  const userPrompt = `## ${sorted.length} 队 Elo 概览（按修正 Elo 降序）

${sorted.map((t, i) => `${i+1}. ${t.country} (${t.cn}): Elo ${t.elo} / 修正 ${t.modElo} / 模型概率 ${t.prob}%`).join('\n')}

请为所有 ${sorted.length} 队输出冠军概率（JSON）。`;

  return sysPrompt + '\n\n' + userPrompt;
}

function validateOutrightPredictions(parsed, teams) {
  if (!parsed || !Array.isArray(parsed.predictions)) {
    throw new Error('LLM 输出不包含 predictions 数组');
  }
  const validCountries = new Set(teams.map(t => t.country));

  // 收集 LLM 给的预测
  const llmMap = {};
  parsed.predictions.forEach(p => {
    if (typeof p.country !== 'string' || !validCountries.has(p.country)) return;
    const wp = Number(p.winProb);
    if (!Number.isFinite(wp) || wp < 0) return;
    llmMap[p.country] = {
      rawProb: wp,
      rank: Number.isFinite(Number(p.rank)) ? Number(p.rank) : 999,
      reasoning: String(p.reasoning || '').slice(0, 200)
    };
  });

  const providedCount = Object.keys(llmMap).length;
  if (providedCount < 6) {
    throw new Error(`LLM 输出的有效 country 太少 (${providedCount})，放弃。建议给更多 top 强队完整预测。`);
  }

  // 缺的队伍按 Elo 衰减补齐（确保 48 队都有概率）
  const missing = teams
    .filter(t => !llmMap[t.country])
    .sort((a, b) => (b.mod_elo || b.elo || 0) - (a.mod_elo || a.elo || 0));
  // 给缺失的队伍一个很小但非零的种子值，按 Elo 排名顺序指数衰减
  for (let i = 0; i < missing.length; i++) {
    const t = missing[i];
    // 第 i 缺失位的衰减系数（0.85 起步，每隔一档 ×0.85）
    const decay = Math.pow(0.85, Math.floor(i / 2));
    llmMap[t.country] = {
      rawProb: 0.0005 * decay,
      rank: 999,
      reasoning: ''
    };
  }

  // 归一化到总和=1
  const total = Object.values(llmMap).reduce((s, v) => s + v.rawProb, 0);
  if (total <= 0) throw new Error('归一化失败：rawProb 总和为 0');
  const predictions = Object.entries(llmMap)
    .map(([country, info]) => ({
      country,
      winProb: Number((info.rawProb / total).toFixed(4)),
      rank: info.rank,
      reasoning: info.reasoning
    }))
    .sort((a, b) => b.winProb - a.winProb);

  // 按 winProb 重新写 rank（1-N），让前端展示一致
  predictions.forEach((p, i) => { p.rank = i + 1; });

  return { predictions, providedCount, filledCount: missing.length };
}

// 从 LLM 响应里抠 JSON
function extractJSON(text) {
  // 尝试直接 parse
  try { return JSON.parse(text); } catch (_) {}
  // 尝试 ```json ... ```
  const fence = text.match(/```(?:json)?\s*([\s\S]+?)```/);
  if (fence) {
    try { return JSON.parse(fence[1]); } catch (_) {}
  }
  // 尝试找 { ... }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch (_) {}
  }
  return null;
}

function validateH2HPredictions(parsed) {
  if (!parsed || !Array.isArray(parsed.matches)) {
    throw new Error('LLM 输出不包含 matches 数组');
  }
  return parsed.matches.map(m => {
    const sum = (m.homeWinProb || 0) + (m.drawProb || 0) + (m.awayWinProb || 0);
    const normalized = sum > 0 ? 1 / sum : 1;
    return {
      matchId: String(m.matchId || ''),
      homeWinProb: Number(((m.homeWinProb || 0) * normalized).toFixed(4)),
      drawProb: Number(((m.drawProb || 0) * normalized).toFixed(4)),
      awayWinProb: Number(((m.awayWinProb || 0) * normalized).toFixed(4)),
      predictedOutcome: ['home', 'draw', 'away'].includes(m.predictedOutcome) ? m.predictedOutcome : 'home',
      confidence: Math.max(0.3, Math.min(0.9, Number(m.confidence) || 0.5)),
      reasoning: String(m.reasoning || '').slice(0, 200)
    };
  });
}

async function runH2H(teams, names, matches, cfg, endpointDesc, realtimeCtx) {
  console.log(`\n━━━━ h2h 单场预测 ━━━━`);
  const prompt = buildH2HPrompt(matches, teams, names, realtimeCtx);
  console.log(`📝 prompt 长度: ${prompt.length} 字符 (~${Math.round(prompt.length / 1.5)} tokens 中文字)`);
  // DRY_RUN_PROMPT=1 只打 prompt 不调 LLM (用于 prompt 调优 / token 估算)
  if (process.env.DRY_RUN_PROMPT === '1') {
    console.log('\n--- PROMPT START ---');
    console.log(prompt);
    console.log('--- PROMPT END ---\n');
    return true;
  }
  const text = await callLLM(prompt, cfg);
  console.log(`📥 解析 LLM 输出（${text.length} 字符）...`);
  const parsed = extractJSON(text);
  if (!parsed) {
    console.error('✗ 无法解析 LLM 输出为 JSON:');
    console.error(text.slice(0, 500));
    return false;
  }
  const predictions = validateH2HPredictions(parsed);
  if (predictions.length === 0) {
    console.error('✗ h2h 校验后无有效预测');
    return false;
  }
  const output = {
    generatedAt: new Date().toISOString(),
    provider: PROVIDER,
    model: cfg.model,
    endpoint: endpointDesc,
    temperature: TEMPERATURE,
    mode: 'h2h',
    matchCount: predictions.length,
    // 标记本次预测用到的实时数据源 (前端可显示 "本次含 N 源实时数据")
    realtimeSources: {
      oddsApi: realtimeCtx.oddsApi.skipped ? null : realtimeCtx.oddsApi.events.length,
      polymarket: realtimeCtx.polymarket.skipped ? null : realtimeCtx.polymarket.events.length,
      weather: realtimeCtx.weatherFetched,
      players: matches.length  // 球员名单总是有 (静态)
    },
    predictions
  };
  if (DRY_RUN) {
    console.log('🔍 DRY_RUN=1，不写文件。h2h 输出预览:');
    console.log(JSON.stringify(output, null, 2).slice(0, 1500));
  } else {
    fs.writeFileSync(H2H_OUT_PATH, JSON.stringify(output, null, 2));
    console.log(`✅ 写入 ${H2H_OUT_PATH} (${predictions.length} 场预测)`);
  }
  return true;
}

async function runOutright(teams, names, cfg, endpointDesc) {
  console.log(`\n━━━━ outright 冠军预测（batch 模式 ${OUTRIGHT_BATCH_SIZE} 队/批）━━━━`);

  // 全部 48 队按 mod_elo 降序切批
  const sortedAll = [...teams].sort((a, b) => (b.mod_elo || b.elo || 0) - (a.mod_elo || a.elo || 0));
  const batches = [];
  for (let i = 0; i < sortedAll.length; i += OUTRIGHT_BATCH_SIZE) {
    batches.push(sortedAll.slice(i, i + OUTRIGHT_BATCH_SIZE));
  }
  console.log(`📦 共 ${batches.length} 批, 合计 ${sortedAll.length} 国`);

  // 收集 LLM 直接给的预测 (key: country, value: {rawProb, rank, reasoning})
  const llmMap = {};
  for (let bi = 0; bi < batches.length; bi++) {
    const batch = batches[bi];
    const batchCountries = batch.map(t => t.country).join(', ');
    console.log(`\n  ┄┄ 批 ${bi + 1}/${batches.length} (${batch.length} 国: ${batchCountries.slice(0, 60)}${batchCountries.length > 60 ? '...' : ''}) ┄┄`);
    const prompt = buildOutrightPrompt(teams, names, batch);
    console.log(`  📝 prompt 长度: ${prompt.length} 字符`);
    if (process.env.DRY_RUN_PROMPT === '1') {
      console.log(prompt);
      continue;
    }
    let text;
    try {
      text = await callLLM(prompt, cfg);
    } catch (err) {
      console.error(`  ✗ 批 ${bi + 1} LLM 调用失败: ${err.message}`);
      console.error(`  → 跳过该批, 缺的国走 Elo 衰减补齐`);
      continue;
    }
    console.log(`  📥 响应 ${text.length} 字符, 解析中...`);
    const parsed = extractJSON(text);
    if (!parsed || !Array.isArray(parsed.predictions)) {
      console.error(`  ✗ 批 ${bi + 1} 无法解析 JSON`);
      console.error(text.slice(0, 200));
      continue;
    }
    const validCountries = new Set(batch.map(t => t.country));
    let added = 0;
    for (const p of parsed.predictions) {
      if (typeof p.country !== 'string' || !validCountries.has(p.country)) continue;
      const wp = Number(p.winProb);
      if (!Number.isFinite(wp) || wp < 0) continue;
      llmMap[p.country] = {
        rawProb: wp,
        rank: Number.isFinite(Number(p.rank)) ? Number(p.rank) : 999,
        reasoning: String(p.reasoning || '').slice(0, 200)
      };
      added++;
    }
    console.log(`  ✓ 批 ${bi + 1} 解析成功, 新增 ${added} 国`);
  }

  if (process.env.DRY_RUN_PROMPT === '1') {
    console.log('\n🔍 DRY_RUN_PROMPT=1，仅打 prompt 不调 LLM。');
    return true;
  }

  const providedCount = Object.keys(llmMap).length;
  if (providedCount < 6) {
    console.error(`\n✗ outright 失败: LLM 有效预测仅 ${providedCount} 国 (需要 ≥6)`);
    return false;
  }

  // 缺的队伍按 Elo 衰减补齐（确保 48 队都有概率）
  const missing = teams
    .filter(t => !llmMap[t.country])
    .sort((a, b) => (b.mod_elo || b.elo || 0) - (a.mod_elo || a.elo || 0));
  for (let i = 0; i < missing.length; i++) {
    const t = missing[i];
    const decay = Math.pow(0.85, Math.floor(i / 2));
    llmMap[t.country] = { rawProb: 0.0005 * decay, rank: 999, reasoning: '' };
  }

  // 归一化到总和=1
  const total = Object.values(llmMap).reduce((s, v) => s + v.rawProb, 0);
  if (total <= 0) {
    console.error('✗ outright 归一化失败: rawProb 总和为 0');
    return false;
  }
  const predictions = Object.entries(llmMap)
    .map(([country, info]) => ({
      country,
      winProb: Number((info.rawProb / total).toFixed(4)),
      rank: info.rank,
      reasoning: info.reasoning
    }))
    .sort((a, b) => b.winProb - a.winProb);
  predictions.forEach((p, i) => { p.rank = i + 1; });

  const filledCount = missing.length;
  const output = {
    generatedAt: new Date().toISOString(),
    provider: PROVIDER,
    model: cfg.model,
    endpoint: endpointDesc,
    temperature: TEMPERATURE,
    mode: 'outright',
    countryCount: predictions.length,
    llmProvided: providedCount,
    fallbackFilled: filledCount,
    batchSize: OUTRIGHT_BATCH_SIZE,
    batchCount: batches.length,
    predictions
  };
  if (DRY_RUN) {
    console.log('🔍 DRY_RUN=1，不写文件。outright 输出预览:');
    console.log(JSON.stringify(output, null, 2).slice(0, 2500));
  } else {
    fs.writeFileSync(OUTRIGHT_OUT_PATH, JSON.stringify(output, null, 2));
    console.log(`\n✅ 写入 ${OUTRIGHT_OUT_PATH} (${predictions.length} 国 · LLM 直接给 ${providedCount} · Elo 衰减补 ${filledCount} · ${batches.length} 批)`);
  }
  return true;
}

async function main() {
  ensureInputs();
  const cfg = resolveConfig();
  console.log(`📂 读取数据 (mode=${MODE})...`);
  const teamsPayload = readJSON(TEAMS_PATH);
  const matchesPayload = readJSON(MATCHES_PATH);
  const names = readJSON(NAMES_PATH);
  const matches = Object.values(matchesPayload.groups || {}).flatMap(g => g.matches || []);
  const teams = teamsPayload.teams || [];

  const endpointDesc = cfg.baseUrl
    ? `${cfg.baseUrl}/v1/messages`
    : cfg.endpoint;
  console.log(`🤖 LLM: provider=${PROVIDER}, model=${cfg.model}, endpoint=${endpointDesc}`);

  // ============ 实时数据并行拉取 (Promise.all, 失败互不影响) ============
  console.log('🌐 拉取实时数据 (The Odds API / Polymarket / Open-Meteo)...');
  const t0 = Date.now();
  const [oddsApi, polymarket] = await Promise.all([
    fetchOddsApiH2H(),
    fetchPolymarketH2H()
  ]);
  console.log(`  The Odds API: ${oddsApi.skipped ? '⚠️ ' + oddsApi.reason : `✓ ${oddsApi.events.length} 场 (${(Date.now()-t0)}ms)`}`);
  console.log(`  Polymarket: ${polymarket.skipped ? '⚠️ ' + polymarket.reason : `✓ ${polymarket.events.length} 场`}`);

  // 天气按场次串行 (避免 Open-Meteo 限流, 24 场 < 30s)
  const weatherCache = {};
  let weatherFetched = 0;
  if (MODE === 'h2h' || MODE === 'all') {
    const now = Date.now();
    const upcoming = matches
      .filter(m => m.status === 'scheduled' && new Date(m.date + 'T' + m.time + ':00Z').getTime() > now)
      .sort((a, b) => new Date(a.date + 'T' + a.time + ':00Z') - new Date(b.date + 'T' + b.time + ':00Z'))
      .slice(0, 24);
    for (const m of upcoming) {
      const venue = resolveVenue(m.venue);
      if (!venue) continue;
      const w = await fetchWeather(venue, m.date, m.time);
      if (w) {
        weatherCache[m.id] = w;
        weatherFetched++;
      }
    }
    console.log(`  Open-Meteo: ${weatherFetched}/${upcoming.length} 场 (${Date.now()-t0}ms total)`);
  }

  const realtimeCtx = { oddsApi, polymarket, weatherCache, weatherFetched };

  const wantH2h = MODE === 'h2h' || MODE === 'all';
  const wantOutright = MODE === 'outright' || MODE === 'all';

  let ok = true;
  if (wantH2h) ok = (await runH2H(teams, names, matches, cfg, endpointDesc, realtimeCtx)) && ok;
  if (wantOutright) ok = (await runOutright(teams, names, cfg, endpointDesc)) && ok;

  if (!ok) {
    console.error('\n✗ 有 task 失败');
    process.exit(2);
  }
  console.log(`\n🎉 mode=${MODE} 全部完成 (总耗时 ${Date.now()-t0}ms)`);
}

main().catch(err => {
  console.error('✗', err);
  process.exit(1);
});
