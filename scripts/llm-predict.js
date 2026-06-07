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
 *   - data/wc_llm_predictions.json  写入仓库，Vercel 部署时自动包含
 *
 * 用法：
 *   # 默认：调 Ollama 本地服务 (http://localhost:11434)
 *   node scripts/llm-predict.js
 *
 *   # 小米 MiMo（Anthropic 协议，需要 API key）
 *   LLM_PROVIDER=xiaomi \
 *     LLM_API_KEY=tp-xxxxx \
 *     npm run llm:predict
 *   # 或在 .env 里写 LLM_PROVIDER=xiaomi / LLM_API_KEY=tp-xxxxx，直接 npm run llm:predict:xiaomi
 *
 *   # 任意 OpenAI 兼容 endpoint
 *   LLM_PROVIDER=openai LLM_BASE_URL=https://api.openai.com LLM_MODEL=gpt-4o-mini \
 *     LLM_API_KEY=sk-xxxxx npm run llm:predict
 *
 *   # 干跑（不写文件）
 *   npm run llm:predict:dry
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
const OUT_PATH = path.join(ROOT, 'data', 'wc_llm_predictions.json');

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

function buildPrompt(matches, teams, names) {
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

function validatePredictions(parsed) {
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

async function main() {
  ensureInputs();
  const cfg = resolveConfig();
  console.log(`📂 读取数据...`);
  const teamsPayload = readJSON(TEAMS_PATH);
  const matchesPayload = readJSON(MATCHES_PATH);
  const names = readJSON(NAMES_PATH);
  const matches = Object.values(matchesPayload.groups || {}).flatMap(g => g.matches || []);
  const teams = teamsPayload.teams || [];

  const endpointDesc = cfg.baseUrl
    ? `${cfg.baseUrl}/v1/messages`
    : cfg.endpoint;
  console.log(`🤖 调用 LLM (provider=${PROVIDER}, model=${cfg.model}, endpoint=${endpointDesc})...`);
  const prompt = buildPrompt(matches, teams, names);
  const text = await callLLM(prompt, cfg);

  console.log(`📥 解析 LLM 输出（${text.length} 字符）...`);
  const parsed = extractJSON(text);
  if (!parsed) {
    console.error('✗ 无法解析 LLM 输出为 JSON:');
    console.error(text.slice(0, 500));
    process.exit(2);
  }

  const predictions = validatePredictions(parsed);
  if (predictions.length === 0) {
    console.error('✗ LLM 输出经校验后无有效预测');
    process.exit(2);
  }

  const output = {
    generatedAt: new Date().toISOString(),
    provider: PROVIDER,
    model: cfg.model,
    endpoint: endpointDesc,
    temperature: TEMPERATURE,
    matchCount: predictions.length,
    predictions
  };

  if (DRY_RUN) {
    console.log('🔍 DRY_RUN=1，不写文件。输出预览:');
    console.log(JSON.stringify(output, null, 2).slice(0, 2000));
  } else {
    fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2));
    console.log(`✅ 写入 ${OUT_PATH} (${predictions.length} 场预测)`);
  }
}

main().catch(err => {
  console.error('✗', err);
  process.exit(1);
});
