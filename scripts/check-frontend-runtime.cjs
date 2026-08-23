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
  let apiCalls = 0;
  const pages = makeSandbox('lrwei91.github.io', async () => {
    apiCalls += 1;
    throw new Error('GitHub Pages 不应请求 API');
  });
  runScript(pages, 'js/runtime.js');
  runScript(pages, 'js/worldcup-data.js');
  assert.equal(pages.TicaiRuntime.isGitHubPages(), true);
  assert.equal(pages.TicaiRuntime.canUseApi(), false);
  assert.equal(await pages.WorldCupData.loadApi('/api/matches'), null);
  assert.equal(apiCalls, 0);

  const requested = [];
  const vercel = makeSandbox('lottery.vercel.app', async (url) => {
    requested.push(url);
    const payload = url.includes('worldcup_names')
      ? { countryNames: { France: '法国' } }
      : url.includes('worldcup_matches')
        ? { groups: {} }
        : url.includes('worldcup_2026')
          ? { teams: [] }
          : { ok: true };
    return { ok: true, json: async () => payload };
  });
  vercel.KimiBenchmarks = { load: async () => ({ ready: true }) };
  runScript(vercel, 'js/runtime.js');
  runScript(vercel, 'js/worldcup-data.js');
  assert.equal(vercel.TicaiRuntime.canUseApi(), true);
  const bundle = await vercel.WorldCupData.loadStaticBundle();
  assert.equal(bundle.names.countryNames.France, '法国');
  assert.equal(bundle.benchmark.ready, true);
  assert.equal(requested.filter((url) => String(url).includes('data/')).length, 3);
  assert.deepEqual(await vercel.WorldCupData.loadApi('/api/matches'), { ok: true });

  const indexSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(indexSource, /<meta name="color-scheme" content="light">/);
  assert.ok(!indexSource.includes('colorModeSelect'));
  assert.ok(!indexSource.includes('js/color-mode.js'));
  assert.match(indexSource, /id="loadingOverlay"[^>]*hidden/);
  const appSource = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
  const workbenchSource = fs.readFileSync(path.join(root, 'css/workbench.css'), 'utf8');
  assert.ok(!appSource.includes('TicaiColorMode'));
  assert.match(appSource, /const validRoutes = \['dlt', 'pl3'\]/);
  assert.match(appSource, /if \(type === 'worldcup'\) \{[\s\S]*?window\.location\.hash = 'dlt'/);
  assert.match(workbenchSource, /\.selector-tab\[data-lottery="worldcup"\],[\s\S]*?#sectionWorldcup[\s\S]*?display: none !important/);
  assert.ok(appSource.includes('}, 150);'));
  assert.ok(!appSource.includes('minDisplay'));
  assert.ok(!appSource.includes("classList.add('fade-out')"));

  console.log(JSON.stringify({ ok: true, scenarios: 4 }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
