/**
 * 场馆天气查询（Open-Meteo 免费 API + Upstash 6h 缓存）
 *
 * GET /api/weather?venue=<venueName>&date=<YYYY-MM-DD>&time=<HH:MM>&tz=UTC
 *   → {
 *       venue, date, hourLocal,
 *       tempC, humidity, weatherCode, label, icon,
 *       source: 'cache' | 'live',
 *       cachedAt, expiresAt
 *     }
 *
 * - 场馆名 → data/venue_coords.json 查经纬度
 * - Open-Meteo 拉当地小时数据（开赛前 2h 的整点取样）
 * - Upstash KV 缓存 key: weather:{venue}:{date}:{hourLocal}，TTL 6h
 * - 场馆未匹配 / KV 未配置 / 上游失败：返回 200 + { ok:false, reason }, 让前端走降级
 */

import fs from 'node:fs';
import path from 'node:path';
import { getRedis } from './_lib/redis.js';
import { setCors } from './_lib/http.js';

let _coordsCache = null;
function loadCoords() {
  if (_coordsCache) return _coordsCache;
  try {
    // Vercel cwd = repo root, 路径直接 data/venue_coords.json
    const p = path.join(process.cwd(), 'data', 'venue_coords.json');
    const raw = fs.readFileSync(p, 'utf-8');
    _coordsCache = JSON.parse(raw);
  } catch (e) {
    console.error('venue_coords.json load failed:', e);
    _coordsCache = {};
  }
  return _coordsCache;
}

// Open-Meteo WMO weather code → 中文 + emoji
const WMO_MAP = {
  0:  { label: '晴',        icon: '☀️' },
  1:  { label: '晴间多云',  icon: '🌤️' },
  2:  { label: '多云',      icon: '⛅' },
  3:  { label: '阴',        icon: '☁️' },
  45: { label: '雾',        icon: '🌫️' },
  48: { label: '雾凇',      icon: '🌫️' },
  51: { label: '小毛毛雨',  icon: '🌦️' },
  53: { label: '毛毛雨',    icon: '🌦️' },
  55: { label: '强毛毛雨',  icon: '🌧️' },
  61: { label: '小雨',      icon: '🌧️' },
  63: { label: '中雨',      icon: '🌧️' },
  65: { label: '大雨',      icon: '🌧️' },
  71: { label: '小雪',      icon: '🌨️' },
  73: { label: '中雪',      icon: '🌨️' },
  75: { label: '大雪',      icon: '❄️' },
  77: { label: '雪粒',      icon: '🌨️' },
  80: { label: '阵雨',      icon: '🌦️' },
  81: { label: '强阵雨',    icon: '🌧️' },
  82: { label: '暴雨',      icon: '⛈️' },
  85: { label: '阵雪',      icon: '🌨️' },
  86: { label: '强阵雪',    icon: '❄️' },
  95: { label: '雷暴',      icon: '⛈️' },
  96: { label: '雷暴+冰雹', icon: '⛈️' },
  99: { label: '强雷暴+冰雹', icon: '⛈️' }
};

// 找距离开赛时间最近的小时（开赛前 2h 的整点）
function pickHour(iso) {
  // iso like 2026-06-12T18:00  (local time, no zone)
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 13); // YYYY-MM-DDTHH
  } catch { return null; }
}

export default async function handler(req, res) {
  setCors(res);
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=600');
  if (req.method === 'OPTIONS') return res.status(200).json({ ok: true });
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const venue = (req.query?.venue || '').trim();
  const date = (req.query?.date || '').trim();       // YYYY-MM-DD (local venue date)
  const time = (req.query?.time || '20:00').trim();  // HH:MM
  if (!venue || !date) {
    return res.status(400).json({ ok: false, reason: 'missing venue or date' });
  }

  const coords = loadCoords();
  let vc = coords[venue];
  let matchedVenue = venue;
  // 兼容: worldcup_matches.json 里的 venue 字段是 "Stadium, City" 形式
  // (e.g. "Mexico City Stadium, Mexico City"), 但 venue_coords.json 用 short form 作 key
  // → 取逗号前一段再查一次
  if (!vc && venue.includes(',')) {
    const short = venue.split(',')[0].trim();
    vc = coords[short];
    if (vc) matchedVenue = short;
  }
  if (!vc) {
    return res.status(200).json({ ok: false, reason: `venue not found: ${venue}` });
  }

  // 取开赛前 2h 整点的小时天气
  const localISO = `${date}T${time}`;
  const hourISO = pickHour(localISO);
  if (!hourISO) {
    return res.status(200).json({ ok: false, reason: 'invalid date/time' });
  }
  const cacheKey = `weather:${matchedVenue}:${hourISO}`;

  // 1) 查缓存
  const redis = getRedis({ required: false });
  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached && typeof cached === 'object') {
        return res.status(200).json({ ...cached, source: 'cache' });
      }
    } catch (e) {
      console.warn('weather redis get failed:', e?.message);
    }
  }

  // 2) 调 Open-Meteo
  // hourly 字段只查日期范围 (±1 天) + 当地时区
  // Open-Meteo 接受 ISO 8601 date 或 YYYY-MM-DD；timezone=auto 拿当地时区的小时序列
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(vc.lat));
  url.searchParams.set('longitude', String(vc.lon));
  url.searchParams.set('hourly', 'temperature_2m,relative_humidity_2m,weather_code');
  url.searchParams.set('start_date', date);
  url.searchParams.set('end_date', date);
  url.searchParams.set('timezone', 'auto');

  let omResp;
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 8000);
    omResp = await fetch(url.toString(), { signal: ctrl.signal });
    clearTimeout(tid);
  } catch (e) {
    return res.status(200).json({ ok: false, reason: `open-meteo fetch failed: ${e?.message || e}` });
  }
  if (!omResp.ok) {
    return res.status(200).json({ ok: false, reason: `open-meteo HTTP ${omResp.status}` });
  }

  let omData;
  try {
    omData = await omResp.json();
  } catch (e) {
    return res.status(200).json({ ok: false, reason: 'open-meteo parse failed' });
  }

  const hourly = omData?.hourly;
  if (!hourly || !Array.isArray(hourly.time) || !Array.isArray(hourly.temperature_2m)) {
    return res.status(200).json({ ok: false, reason: 'open-meteo missing hourly data' });
  }

  // 找最接近目标小时的索引
  const targetHour = hourISO.slice(11, 13); // HH
  let bestIdx = -1;
  let bestDelta = Infinity;
  for (let i = 0; i < hourly.time.length; i++) {
    const t = hourly.time[i]; // YYYY-MM-DDTHH:MM
    if (!t || !t.startsWith(date)) continue;
    const h = t.slice(11, 13);
    const delta = Math.abs(parseInt(h, 10) - parseInt(targetHour, 10));
    if (delta < bestDelta) { bestDelta = delta; bestIdx = i; }
  }
  if (bestIdx < 0) {
    return res.status(200).json({ ok: false, reason: 'no hourly match' });
  }

  const tempC = Math.round(hourly.temperature_2m[bestIdx] * 10) / 10;
  const humidity = hourly.relative_humidity_2m?.[bestIdx] ?? null;
  const code = hourly.weather_code?.[bestIdx] ?? 0;
  const wmo = WMO_MAP[code] || { label: '未知', icon: '🌡️' };

  const payload = {
    ok: true,
    venue: matchedVenue,
    city: vc.label_zh || vc.city,
    country: vc.country,
    date,
    hourLocal: parseInt(targetHour, 10),
    tempC,
    humidity,
    weatherCode: code,
    label: wmo.label,
    icon: wmo.icon,
    altitude_m: vc.altitude_m,
    source: 'live',
    cachedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 6 * 3600 * 1000).toISOString()
  };

  // 3) 写缓存（KV 未配 / 写失败都不影响返回）
  if (redis) {
    try {
      await redis.set(cacheKey, payload, { ex: 6 * 3600 });
    } catch (e) {
      console.warn('weather redis set failed:', e?.message);
    }
  }

  return res.status(200).json(payload);
}
