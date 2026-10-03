#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function makeSandbox(hostname, fetchImpl) {
  const sandbox = {
    AbortController,
    Date,
    Promise,
    console,
    fetch: fetchImpl,
    setTimeout,
    clearTimeout,
    location: { hostname }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  return sandbox;
}

function runScript(sandbox, relativePath) {
  vm.runInContext(fs.readFileSync(path.join(root, relativePath), 'utf8'), sandbox, { filename: relativePath });
}

async function main() {
  // 场景 1-2：runtime.js 在 GitHub Pages 与 Vercel 两种部署下的能力判定
  let apiCalls = 0;
  const pages = makeSandbox('lrwei91.github.io', async () => {
    apiCalls += 1;
    throw new Error('GitHub Pages 不应请求 API');
  });
  runScript(pages, 'js/runtime.js');
  assert.equal(pages.TicaiRuntime.isGitHubPages(), true);
  assert.equal(pages.TicaiRuntime.canUseApi(), false);
  assert.equal(apiCalls, 0);

  const requested = [];
  const vercel = makeSandbox('lottery.vercel.app', async (url) => {
    requested.push(url);
    return { ok: true, json: async () => ({ ok: true }) };
  });
  runScript(vercel, 'js/runtime.js');
  assert.equal(vercel.TicaiRuntime.canUseApi(), true);
  const res = await vercel.TicaiRuntime.fetchWithTimeout('/api/records', {});
  assert.equal(res.ok, true);
  assert.deepEqual(await res.json(), { ok: true });
  assert.deepEqual(requested, ['/api/records']);

  // 场景 3：index.html 视觉与加载契约
  const indexSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(indexSource, /<meta name="color-scheme" content="light">/);
  assert.ok(!indexSource.includes('colorModeSelect'));
  assert.ok(!indexSource.includes('js/color-mode.js'));
  assert.match(indexSource, /id="loadingOverlay"[^>]*hidden/);

  // 场景 4：app.js 路由、加载时序与已移除的世界杯模块
  const appSource = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
  assert.ok(!appSource.includes('TicaiColorMode'));
  assert.match(appSource, /const validRoutes = \['dlt', 'pl3'\]/);
  assert.ok(appSource.includes('}, 150);'));
  assert.ok(!appSource.includes('minDisplay'));
  assert.ok(!appSource.includes("classList.add('fade-out')"));
  assert.ok(!appSource.includes('isWorldCup'));
  assert.ok(!appSource.includes('showWorldCup'));
  assert.ok(!appSource.includes('sectionWorldcup'));

  // 场景 5：世界杯模块已彻底移除，不留死引用
  for (const removed of [
    'js/worldcup.js', 'js/worldcup-data.js', 'js/conformal.js',
    'js/factor_attribution.js', 'js/kimi-benchmarks.js', 'js/odds-utils.js'
  ]) {
    assert.ok(!indexSource.includes(removed), `index.html 仍引用已删除的 ${removed}`);
    assert.ok(!fs.existsSync(path.join(root, removed)), `${removed} 应已删除`);
  }
  assert.ok(!indexSource.includes('data-lottery="worldcup"'));
  assert.ok(!indexSource.includes('id="sectionWorldcup"'));
  for (const orphan of ['api/matches.js', 'api/weather.js', 'api/odds', 'api/cron']) {
    assert.ok(!fs.existsSync(path.join(root, orphan)), `${orphan} 应已删除`);
  }
  const vercelConfig = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  assert.ok(!vercelConfig.crons, 'vercel.json 不应再有世界杯赔率 cron');

  console.log(JSON.stringify({ ok: true, scenarios: 5 }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
