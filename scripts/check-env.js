#!/usr/bin/env node
/**
 * scripts/check-env.js
 *
 * 扫一遍 Vercel / 本地 / GitHub Actions 环境里 ticai 项目需要的 env 变量
 * 给出按"必须 / 推荐 / 可选"三档的分级诊断 + 获取链接
 *
 * 不需要任何 npm 依赖，纯 Node 18+ stdlib。
 *
 * 用法:
 *   node scripts/check-env.js               # 只读 process.env
 *   node scripts/check-env.js --vercel      # 提示 Vercel Dashboard 位置
 *   node scripts/check-env.js --strict      # 推荐项缺失也 fail
 *
 * 输出: 人类可读 (CLI)
 * 退出码: 0 = 全部 OK 或只有可选缺失, 1 = 必需项缺失
 */
'use strict';

const fs = require('fs');
const path = require('path');

// ============================================================
// Env 规范定义
// ============================================================
// 必填性: 'required' (必需) / 'recommended' (推荐) / 'optional' (可选)
// 范围: 'vercel' (Vercel API 需要) / 'local' (本地脚本) / 'both' (两边都看)
// 链接: 文档/申请页
// detected 用函数延迟求值, 这样 loadDotenv() 之后 process.env 已就绪
const SPEC = {
  // ─── Vercel: Upstash Redis 存储 ───
  UPSTASH_REDIS_REST_URL: {
    required: 'recommended',
    scope: 'vercel',
    purpose: 'Upstash Redis REST endpoint (KV 存储)',
    obtain: 'Vercel → Storage → Marketplace → Upstash → Connect',
    fallback: 'KV_REST_API_URL (老 KV 数据库)',
    detected: () => !!process.env.UPSTASH_REDIS_REST_URL || !!process.env.KV_REST_API_URL
  },
  UPSTASH_REDIS_REST_TOKEN: {
    required: 'recommended',
    scope: 'vercel',
    purpose: 'Upstash Redis REST auth token',
    obtain: 'Vercel → Storage → Marketplace → Upstash → Connect (自动注入)',
    fallback: 'KV_REST_API_TOKEN',
    detected: () => !!process.env.UPSTASH_REDIS_REST_TOKEN || !!process.env.KV_REST_API_TOKEN
  },
  // ─── Vercel: Odds 数据源 (cron sync-odds.js) ───
  ODDS_API_KEY: {
    required: 'optional',
    scope: 'vercel',
    purpose: 'The Odds API — 单场赔率 (h2h/spreads/totals)',
    obtain: 'https://the-odds-api.com/ (免费 500 req/月)',
    detected: () => !!process.env.ODDS_API_KEY
  },
  POLYMARKET_PUBLIC_ENABLED: {
    required: 'optional',
    scope: 'vercel',
    purpose: '启用 Polymarket 公开 API (h2h + outright)',
    obtain: '设 true 即可，Polymarket 公开 API 不用 key',
    detected: () => process.env.POLYMARKET_PUBLIC_ENABLED === 'true'
  },
  POLYMARKET_TAG_ID: {
    required: 'optional',
    scope: 'vercel',
    purpose: 'Polymarket h2h tag (默认 102350 = 2026 WC)',
    detected: () => !!process.env.POLYMARKET_TAG_ID
  },
  POLYMARKET_OUTRIGHT_TAG_ID: {
    required: 'optional',
    scope: 'vercel',
    purpose: 'Polymarket outright tag (默认 100350 = WC Winner)',
    detected: () => !!process.env.POLYMARKET_OUTRIGHT_TAG_ID
  },
  FOOTBALL_DATA_API_KEY: {
    required: 'optional',
    scope: 'vercel',
    purpose: 'football-data.org — 赛程+实时比分',
    obtain: 'https://www.football-data.org/ (免费)',
    detected: () => !!process.env.FOOTBALL_DATA_API_KEY
  },
  ODDS_REGIONS: {
    required: 'optional',
    scope: 'vercel',
    purpose: 'The Odds API 区域 (默认 us,uk,eu)',
    detected: () => !!process.env.ODDS_REGIONS
  },
  ODDS_MARKETS: {
    required: 'optional',
    scope: 'vercel',
    purpose: 'The Odds API 盘口 (默认 h2h,spreads,totals)',
    detected: () => !!process.env.ODDS_MARKETS
  },
  // ─── 本地: 彩票爬虫 ───
  JISU_API_KEY: {
    required: 'optional',
    scope: 'local',
    purpose: '极速数据 API — 彩票历史 (scraper.js / scraper_pl3.js)',
    obtain: 'https://www.jisuapi.com/ (免费)',
    detected: () => !!process.env.JISU_API_KEY || !!process.env.JISU_APPKEY
  },
  // ─── 本地: LLM 预测 ───
  LLM_PROVIDER: {
    required: 'optional',
    scope: 'local',
    purpose: 'LLM provider: ollama / openai / xiaomi',
    detected: () => !!process.env.LLM_PROVIDER
  },
  XIAOMI_API_KEY: {
    required: 'optional',
    scope: 'local',
    purpose: 'Xiaomi MiMo API key (本项目当前唯一 LLM provider,2026-06-12 从 LLM_API_KEY 改名)',
    detected: () => !!process.env.XIAOMI_API_KEY
  },
  LLM_BASE_URL: {
    required: 'optional',
    scope: 'local',
    purpose: 'LLM base URL (默认走 provider defaults)',
    detected: () => !!process.env.LLM_BASE_URL
  },
  LLM_MODEL: {
    required: 'optional',
    scope: 'local',
    purpose: 'LLM 模型名',
    detected: () => !!process.env.LLM_MODEL
  }
};

// ============================================================
// 推断运行环境
// ============================================================

// Mini dotenv: 解析 .env 文件注入到 process.env
// (避免依赖 dotenv 包; 支持 # 注释、空行、KEY=VALUE、引号)
// 注意: 只在 process.env 里没值时注入, 已存在的更高优先级
function loadDotenv(silent = false) {
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return false;
  const content = fs.readFileSync(envPath, 'utf-8');
  let count = 0;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const m = trimmed.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i);
    if (!m) continue;
    const key = m[1];
    let val = m[2];
    // 去掉引号
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = val;
      count += 1;
    }
  }
  if (count > 0 && !silent) {
    console.log(`  \x1b[90mℹ .env: 加载了 ${count} 个 env 变量\x1b[0m`);
  }
  return true;
}

function detectEnv() {
  if (process.env.VERCEL) return 'vercel';
  if (process.env.GITHUB_ACTIONS) return 'github-actions';
  if (process.env.CI) return 'ci';
  // 检查 .env 文件 + 自动加载
  try {
    if (fs.existsSync(path.join(process.cwd(), '.env'))) {
      loadDotenv();
      return 'local-with-env-file';
    }
  } catch (_) { /* noop */ }
  return 'local';
}

// ============================================================
// 输出
// ============================================================
const COLORS = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  red:    '\x1b[31m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  blue:   '\x1b[34m',
  cyan:   '\x1b[36m',
  gray:   '\x1b[90m'
};
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (color, text) => useColor ? `${COLORS[color]}${text}${COLORS.reset}` : text;

function groupByScope() {
  const groups = { vercel: [], local: [] };
  for (const [key, spec] of Object.entries(SPEC)) {
    if (spec.scope === 'vercel') groups.vercel.push([key, spec]);
    else if (spec.scope === 'local') groups.local.push([key, spec]);
  }
  return groups;
}

function printStatus(key, spec) {
  // detected 是函数, 延迟求值 (保证 loadDotenv 后再读 process.env)
  const isDetected = spec.detected();
  const mark = isDetected ? c('green', '✓') : c('red', '✗');
  const tag = spec.required === 'recommended' ? c('yellow', '[推荐]') :
              spec.required === 'optional'   ? c('gray',  '[可选]') :
                                                c('red',    '[必需]');
  const scope = c('blue', `(${spec.scope})`);
  console.log(`  ${mark} ${c('bold', key)} ${tag} ${scope}`);
  console.log(`     ${c('dim', spec.purpose)}`);
  if (!isDetected) {
    if (spec.fallback) console.log(`     ${c('dim', '兼容: ' + spec.fallback)}`);
    if (spec.obtain)   console.log(`     ${c('cyan', spec.obtain)}`);
  }
}

function main() {
  const args = process.argv.slice(2);
  const strict = args.includes('--strict');
  const showVercel = args.includes('--vercel') || args.length === 0;  // 默认显示 Vercel 操作路径

  console.log(c('bold', '\n🔍 ticai env 诊断\n'));
  console.log(`  ${c('dim', '运行环境: ' + detectEnv())}`);
  console.log(`  ${c('dim', '项目根: ' + process.cwd())}`);
  console.log(`  ${c('dim', 'Node: ' + process.version)}`);
  console.log(`  ${c('dim', 'Vercel env (VERCEL=' + (process.env.VERCEL || '未设置') + ')\n')}`);

  const groups = groupByScope();

  // Vercel
  console.log(c('bold', c('cyan', '━━━ Vercel 生产环境 ━━━')));
  const missingVercelRequired = [];
  const missingVercelRecommended = [];
  for (const [key, spec] of groups.vercel) {
    printStatus(key, spec);
    if (!spec.detected()) {
      if (spec.required === 'recommended') missingVercelRecommended.push(key);
      if (spec.required === 'required')    missingVercelRequired.push(key);
    }
  }

  // 本地
  console.log(c('bold', c('cyan', '\n━━━ 本地脚本环境 ━━━')));
  const missingLocal = [];
  for (const [key, spec] of groups.local) {
    printStatus(key, spec);
    if (!spec.detected()) missingLocal.push(key);
  }

  // 总结
  console.log(c('bold', c('cyan', '\n━━━ 总结 ━━━')));
  const totalVercel = groups.vercel.length;
  const okVercel = groups.vercel.filter(([, s]) => s.detected()).length;
  console.log(`  Vercel: ${c(okVercel === totalVercel ? 'green' : 'yellow', okVercel + '/' + totalVercel)} 已配置`);
  if (missingVercelRecommended.length > 0) {
    console.log(`    ${c('yellow', '⚠ 推荐项缺失:')} ${missingVercelRecommended.join(', ')}`);
  }
  if (missingVercelRequired.length > 0) {
    console.log(`    ${c('red', '✗ 必需项缺失:')} ${missingVercelRequired.join(', ')}`);
  }

  const totalLocal = groups.local.length;
  const okLocal = groups.local.filter(([, s]) => s.detected()).length;
  console.log(`  Local:  ${c(okLocal === totalLocal ? 'green' : 'gray', okLocal + '/' + totalLocal)} 已配置`);

  // 影响范围诊断
  console.log(c('bold', c('cyan', '\n━━━ 实际影响 ━━━')));
  const upsOk = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const oddsOk = process.env.ODDS_API_KEY;
  const polyOk = process.env.POLYMARKET_PUBLIC_ENABLED === 'true';
  const fdOk = process.env.FOOTBALL_DATA_API_KEY;

  if (!upsOk) {
    console.log(`  ${c('red', '✗')} /api/odds/snapshots 会返回 503 (KV env 缺失)`);
  } else {
    console.log(`  ${c('green', '✓')} KV env OK`);
  }
  if (upsOk && !oddsOk) {
    console.log(`  ${c('yellow', '⚠')} the-odds-api 源会 skipped (无赔率) — 4 源融合只剩 Elo + LLM`);
  } else if (oddsOk) {
    console.log(`  ${c('green', '✓')} The Odds API 启用`);
  }
  if (upsOk && !polyOk) {
    console.log(`  ${c('yellow', '⚠')} polymarket 源会 skipped — 缺真钱投票信号`);
  } else if (polyOk) {
    console.log(`  ${c('green', '✓')} Polymarket 启用`);
  }
  if (upsOk && !fdOk) {
    console.log(`  ${c('gray', '·')} football-data 源 skipped (比分实时) — 不影响预测核心`);
  }

  // Vercel 部署提示
  if (showVercel) {
    console.log(c('bold', c('cyan', '\n━━━ Vercel Dashboard 操作路径 ━━━')));
    console.log(`  1. https://vercel.com/dashboard`);
    console.log(`  2. 选项目 → Settings → Environment Variables`);
    console.log(`  3. 加上述 env → 选 Production / Preview / Development 三档`);
    console.log(`  4. Deployments → 最新 → ⋮ → Redeploy (env 才生效)`);
    console.log(`  5. 手动触发 cron:  curl -X POST https://你的域名/api/cron/sync-odds`);
  } else {
    console.log(c('dim', '\n  💡 加 --vercel 看 Dashboard 操作路径'));
  }

  // 退出码
  const hasFailed = missingVercelRequired.length > 0 ||
                    (strict && (missingVercelRecommended.length > 0));
  if (hasFailed) {
    console.log(c('red', c('bold', '\n✗ 检查失败 (有必需/严格项缺失)\n')));
    process.exit(1);
  } else {
    console.log(c('green', c('bold', '\n✓ 检查通过\n')));
  }
}

main();
