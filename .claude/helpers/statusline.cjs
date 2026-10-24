#!/usr/bin/env node
// Project statusLine: project settings replace the user's, so show Orca's line too.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

let input = '';
try { input = fs.readFileSync(0, 'utf8'); } catch { /* no stdin */ }

function orcaLine() {
  const hooks = path.join(os.homedir(), '.orca', 'agent-hooks');
  const win = process.platform === 'win32';
  const script = path.join(hooks, win ? 'claude-statusline.cmd' : 'claude-statusline.sh');
  if (!fs.existsSync(script)) { return ''; }
  const result = win
    ? spawnSync(`"${script}"`, { input, encoding: 'utf8', shell: true })
    : spawnSync('/bin/sh', [script], { input, encoding: 'utf8' });
  return result.status === 0 ? (result.stdout || '').trimEnd() : '';
}

process.stdout.write(orcaLine());
