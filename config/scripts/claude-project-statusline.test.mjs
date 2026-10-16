import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const projectDir = resolve(import.meta.dirname, '../..')
const helperScript = join(projectDir, '.claude/helpers/statusline.cjs')
const settingsPath = join(projectDir, '.claude/settings.json')
const payload = JSON.stringify({ session_id: 's-1', model: { display_name: 'Opus 5.5' } })
const tempDirs = []

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

// A project copy holding the helper next to a stand-in graft helper, and a HOME with or without Orca's script.
function fixture({ withOrca }) {
  const root = mkdtempSync(join(tmpdir(), 'claude-statusline-'))
  tempDirs.push(root)
  const helpers = join(root, 'project', '.claude', 'helpers')
  mkdirSync(helpers, { recursive: true })
  copyFileSync(helperScript, join(helpers, 'statusline.cjs'))
  writeFileSync(
    join(helpers, 'graft-statusline.cjs'),
    "const input = require('node:fs').readFileSync(0, 'utf8')\n" +
      "process.stdout.write('graft-line ' + JSON.parse(input).session_id)\n"
  )
  const home = join(root, 'home')
  if (withOrca) {
    const hooks = join(home, '.orca', 'agent-hooks')
    mkdirSync(hooks, { recursive: true })
    const script = join(hooks, 'claude-statusline.sh')
    writeFileSync(script, '#!/bin/sh\ninput=$(cat)\nprintf "orca-line %s" "${input%%,*}"\n')
    chmodSync(script, 0o755)
  } else {
    mkdirSync(home, { recursive: true })
  }
  return { helper: join(helpers, 'statusline.cjs'), home }
}

function run({ helper, home }) {
  return spawnSync(process.execPath, [helper], {
    input: payload,
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home }
  })
}

describe('project Claude statusline', () => {
  it('points the project statusLine at the combined helper', () => {
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
    expect(settings.statusLine.command).toBe(
      'node "${CLAUDE_PROJECT_DIR:-.}/.claude/helpers/statusline.cjs"'
    )
  })

  it.skipIf(process.platform === 'win32')(
    "prints Orca's line first and graft's after, both fed the same payload",
    () => {
      const result = run(fixture({ withOrca: true }))
      expect(result.status).toBe(0)
      expect(result.stdout).toBe('orca-line {"session_id":"s-1"\ngraft-line s-1')
    }
  )

  it("prints only graft's line when Orca's script is not installed", () => {
    const result = run(fixture({ withOrca: false }))
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('graft-line s-1')
  })
})
