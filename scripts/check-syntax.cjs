#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const scanRoots = ['js', 'api', 'scripts'];

function collect(dir, extensions, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full, extensions, files);
    else if (extensions.has(path.extname(entry.name))) files.push(full);
  }
  return files;
}

function run(command, args, label) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    process.stderr.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    throw new Error(`${label} 语法检查失败`);
  }
}

const jsFiles = scanRoots.flatMap((rel) => collect(path.join(root, rel), new Set(['.js', '.cjs'])));
for (const file of jsFiles) run(process.execPath, ['--check', file], path.relative(root, file));

const pyFiles = collect(path.join(root, 'scripts'), new Set(['.py']));
const pyCheck = [
  'import ast, pathlib, sys',
  'p = pathlib.Path(sys.argv[1])',
  'ast.parse(p.read_text(encoding="utf-8"), filename=str(p))'
].join('; ');
for (const file of pyFiles) run('python3', ['-c', pyCheck, file], path.relative(root, file));

console.log(JSON.stringify({ ok: true, javascript: jsFiles.length, python: pyFiles.length }));
