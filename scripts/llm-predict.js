#!/usr/bin/env node
/**
 * 本地 LLM 跑 2026 世界杯预测
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
 *   # 指定 model / endpoint
 *   LLM_MODEL=qwen2.5 node scripts/llm-predict.js
 *   LLM_ENDPOINT=http://localhost:1234/v1/chat/completions LLM_MODEL=local node scripts/llm-predict.js
 *
 *   # 干跑（不写文件）
 *   DRY_RUN=1 node scripts/llm-predict.js
 *
 * 不需要 API key、不需要联网（只要本地 LLM 服务在跑）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const ENDPOINT = process.env.LLM_ENDPOINT || 'http://localhost:11434/api/chat';
const MODEL = process.env.LLM_MODEL || 'llama3.2';
const TEMPERATURE = Number(process.env.LLM_TEMPERATURE || '0.3');
const DRY_RUN = process.env.DRY_RUN === '1';

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

// Ollama chat 格式（同时兼容 /api/chat 和 OpenAI /v1/chat/completions）
async function callLLM(prompt) {
  const isOllama = ENDPOINT.includes('localhost:11434') || ENDPOINT.endsWith('/api/chat');
  const isOpenAI = ENDPOINT.endsWith('/v1/chat/completions');

  let body, headers = { 'content-type': 'application/json' };
  if (isOllama) {
    body = {
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      options: { temperature: TEMPERATURE }
    };
  } else if (isOpenAI) {
    body = {
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: TEMPERATURE
    };
    if (process.env.LLM_API_KEY) headers['authorization'] = `Bearer ${process.env.LLM_API_KEY}`;
  } else {
    // 通用 /api/generate 风格 fallback
    body = { model: MODEL, prompt, stream: false };
  }

  const res = await fetch(ENDPOINT, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`LLM HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  if (isOllama || isOpenAI) {
    return data.message?.content || data.choices?.[0]?.message?.content || '';
  }
  return data.response || '';
}

function buildPrompt(matches, teams, names) {
  // 给 LLM 简洁的球队信息（top 8 强队 + 12 场重点比赛）
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
  console.log(`📂 读取数据...`);
  const teamsPayload = readJSON(TEAMS_PATH);
  const matchesPayload = readJSON(MATCHES_PATH);
  const names = readJSON(NAMES_PATH);
  const matches = Object.values(matchesPayload.groups || {}).flatMap(g => g.matches || []);
  const teams = teamsPayload.teams || [];

  console.log(`🤖 调用 LLM (${ENDPOINT}, model=${MODEL})...`);
  const prompt = buildPrompt(matches, teams, names);
  const text = await callLLM(prompt);

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
    model: MODEL,
    endpoint: ENDPOINT,
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
