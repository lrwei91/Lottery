#!/usr/bin/env node
/**
 * 本地 / 云端 LLM 跑 2026 世界杯预测
 *
 * 数据源（已 git tracked 的静态 JSON）：
 *   - data/worldcup_2026.json      球队基础数据（Elo / final_prob / factor scores）
 *   - data/worldcup_matches.json   赛程（含已结束比分）
 *   - data/worldcup_names.json     中英文名映射
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
 *     LLM_API_KEY=tp-xxxxx \
 *     npm run llm:predict:all
 *   # 或在 .env 里写 LLM_PROVIDER=xiaomi / LLM_API_KEY=tp-xxxxx，直接 npm run llm:predict:all
 *
 *   # 任意 OpenAI 兼容 endpoint
 *   LLM_PROVIDER=openai LLM_BASE_URL=https://api.openai.com LLM_MODEL=gpt-4o-mini \
 *     LLM_API_KEY=sk-xxxxx npm run llm:predict:all
 *
 *   # 干跑（不写文件）
 *   npm run llm:predict:all:dry
 *
 * Provider 选择优先级：LLM_PROVIDER 环境变量 > ENDPOINT 自动检测 > 默认 ollama
 *
 * 安全：API key 一律从 LLM_API_KEY 环境变量或 .env 文件读，绝不入 git。
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
async function callOpenAI(prompt, cfg) {
  const headers = { 'content-type': 'application/json' };
  if (process.env.LLM_API_KEY) headers['authorization'] = `Bearer ${process.env.LLM_API_KEY}`;
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
async function callXiaomi(prompt, cfg) {
  const key = process.env.LLM_API_KEY;
  if (!key) {
    throw new Error('xiaomi provider 需要 LLM_API_KEY 环境变量（或 .env 里写 LLM_API_KEY=tp-xxxxx）');
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

function buildH2HPrompt(matches, teams, names) {
  // 给 LLM 简洁的球队信息（top 8 强队 + 24 场重点比赛）
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

  // 选已结束 + 未来 7 天未开始的 24 场
  const now = Date.now();
  const upcoming = matches
    .filter(m => m.status === 'scheduled' && new Date(m.date + 'T' + m.time + ':00Z').getTime() > now)
    .sort((a, b) => new Date(a.date + 'T' + a.time + ':00Z') - new Date(b.date + 'T' + b.time + ':00Z'))
    .slice(0, 24);

  const matchesForLLM = upcoming.map(m => ({
    id: m.id,
    date: m.date,
    time: m.time,
    home: m.home,
    away: m.away,
    homeCn: names.countryNames?.[m.home] || m.home,
    awayCn: names.countryNames?.[m.away] || m.away,
    stage: m.stage,
    group: m.group
  }));

  const sysPrompt = `你是一个 2026 FIFA 男足世界杯预测专家。请基于以下信息：
- 已有的 Elo 评分和模型预测概率
- 两队历史交手（如有）
- 比赛地点和赛程阶段

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
- confidence 在 0.3-0.9 之间（避免极端值）
- reasoning 用中文，简明扼要`;

  const userPrompt = `## 球队 Elo 概览（top 12）

${topTeams.map(t => `- ${t.cn} (${t.country}): Elo ${t.elo} / 修正 ${t.modElo} / 模型概率 ${t.prob}%`).join('\n')}

## 待预测比赛（${matchesForLLM.length} 场）

${matchesForLLM.map(m => `- matchId="${m.id}" | ${m.date} ${m.time} | ${m.homeCn} vs ${m.awayCn} | 阶段: ${m.stage || m.group || '小组'}`).join('\n')}

请为每场比赛输出 JSON（仅输出 JSON 数组，每场一个对象）。`;

  return sysPrompt + '\n\n' + userPrompt;
}

// ============ 冠军 outright prompt + 校验 ============
function buildOutrightPrompt(teams, names) {
  // 48 队按修正 Elo 降序全部给 LLM
  const sorted = [...teams]
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

async function runH2H(teams, names, matches, cfg, endpointDesc) {
  console.log(`\n━━━━ h2h 单场预测 ━━━━`);
  const prompt = buildH2HPrompt(matches, teams, names);
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
  console.log(`\n━━━━ outright 冠军预测 ━━━━`);
  const prompt = buildOutrightPrompt(teams, names);
  const text = await callLLM(prompt, cfg);
  console.log(`📥 解析 LLM 输出（${text.length} 字符）...`);
  const parsed = extractJSON(text);
  if (!parsed) {
    console.error('✗ 无法解析 LLM 输出为 JSON:');
    console.error(text.slice(0, 500));
    return false;
  }
  let result;
  try {
    result = validateOutrightPredictions(parsed, teams);
  } catch (err) {
    console.error('✗ outright 校验失败:', err.message);
    return false;
  }
  const { predictions, providedCount, filledCount } = result;
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
    predictions
  };
  if (DRY_RUN) {
    console.log('🔍 DRY_RUN=1，不写文件。outright 输出预览:');
    console.log(JSON.stringify(output, null, 2).slice(0, 2000));
  } else {
    fs.writeFileSync(OUTRIGHT_OUT_PATH, JSON.stringify(output, null, 2));
    console.log(`✅ 写入 ${OUTRIGHT_OUT_PATH} (${predictions.length} 国 · LLM 直接给 ${providedCount} · Elo 衰减补 ${filledCount})`);
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

  const wantH2h = MODE === 'h2h' || MODE === 'all';
  const wantOutright = MODE === 'outright' || MODE === 'all';

  let ok = true;
  if (wantH2h) ok = (await runH2H(teams, names, matches, cfg, endpointDesc)) && ok;
  if (wantOutright) ok = (await runOutright(teams, names, cfg, endpointDesc)) && ok;

  if (!ok) {
    console.error('\n✗ 有 task 失败');
    process.exit(2);
  }
  console.log(`\n🎉 mode=${MODE} 全部完成`);
}

main().catch(err => {
  console.error('✗', err);
  process.exit(1);
});
