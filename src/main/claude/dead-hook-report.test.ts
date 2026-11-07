import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ Notification: class {} }))
vi.mock('../i18n/main-i18n', () => ({
  translateMain: (_key: string, fallback: string, options?: Record<string, unknown>) =>
    fallback.replace(/{{\s*(\w+)\s*}}/g, (_match, name: string) => String(options?.[name]))
}))

import {
  collectNewDeadHookScripts,
  formatDeadHookNotice,
  listClaudeSettingsPaths
} from './dead-hook-report'
import type { DeadHookScript } from './dead-hook-scripts'

const DEAD = '/tmp/orca-fresh-profile.abc/plugins/ab2web.orca-jev-advisor/e5c6/gate-bash.ts'
const settingsWithDeadGate = JSON.stringify({
  hooks: {
    PreToolUse: [
      {
        hooks: [
          {
            command: '/usr/local/bin/node',
            args: [DEAD],
            statusMessage: 'orca-jev-advisor: asking Jev before running this command'
          }
        ]
      }
    ]
  }
})

let root: string | null = null

afterEach(() => {
  if (root) {
    rmSync(root, { recursive: true, force: true })
    root = null
  }
})

describe('listClaudeSettingsPaths', () => {
  it('lists the home settings and each account vault', () => {
    root = mkdtempSync(join(tmpdir(), 'orca-dead-hooks-'))
    mkdirSync(join(root, 'acc-1', 'auth'), { recursive: true })
    mkdirSync(join(root, 'acc-2'), { recursive: true })
    writeFileSync(join(root, 'stray-file'), '')
    expect(listClaudeSettingsPaths('/h/.claude/settings.json', root).sort()).toEqual(
      [
        '/h/.claude/settings.json',
        join(root, 'acc-1', 'auth', 'settings.json'),
        join(root, 'acc-2', 'auth', 'settings.json')
      ].sort()
    )
  })

  it('still lists the home settings when there are no accounts', () => {
    expect(listClaudeSettingsPaths('/h/s.json', '/missing/accounts')).toEqual(['/h/s.json'])
  })
})

describe('collectNewDeadHookScripts (ORCA-1113)', () => {
  const files: Record<string, string> = {
    '/home/settings.json': settingsWithDeadGate,
    '/vault/settings.json': settingsWithDeadGate,
    '/broken/settings.json': '{not json'
  }
  const deps = { readFile: (path: string) => files[path] ?? null, exists: () => false }
  const paths = ['/home/settings.json', '/vault/settings.json', '/broken/settings.json', '/none']

  it('reports a dead hook in the home settings and in every vault, once per session', () => {
    const reported = new Set<string>()
    const first = collectNewDeadHookScripts(paths, deps, reported)
    expect(first.map((dead) => dead.settingsPath)).toEqual([
      '/home/settings.json',
      '/vault/settings.json'
    ])
    expect(first[0]).toMatchObject({ plugin: 'ab2web.orca-jev-advisor', scriptPath: DEAD })
    expect(collectNewDeadHookScripts(paths, deps, reported)).toEqual([])
  })
})

describe('formatDeadHookNotice', () => {
  const dead = (name: string, plugin: string | null, scriptPath: string): DeadHookScript => ({
    settingsPath: '/s.json',
    event: 'PreToolUse',
    name,
    plugin,
    scriptPath
  })

  it('names one hook, its plugin and its script, and says it is not running', () => {
    const notice = formatDeadHookNotice([
      dead('asking Jev', 'ab2web.orca-jev-advisor', DEAD),
      dead('asking Jev', 'ab2web.orca-jev-advisor', DEAD)
    ])
    expect(notice.title).toBe('Claude hooks are not running')
    expect(notice.body).toBe(
      `asking Jev (ab2web.orca-jev-advisor) is not running: its script ${DEAD} is missing. Reinstall it or remove the hook from settings.json.`
    )
  })

  it('names up to three hooks and counts the rest', () => {
    const notice = formatDeadHookNotice(
      ['a', 'b', 'c', 'd', 'e'].map((name) => dead(name, null, `/p/${name}.mjs`))
    )
    expect(notice.body).toBe(
      '5 hooks are not running because their scripts are missing: a; b; c and 2 more. See the Orca Lab log for each path.'
    )
  })

  it('names every hook when there are three or fewer', () => {
    const notice = formatDeadHookNotice([dead('a', 'p', '/p/a.mjs'), dead('b', null, '/p/b.mjs')])
    expect(notice.body).toBe(
      '2 hooks are not running because their scripts are missing: a (p); b. See the Orca Lab log for each path.'
    )
  })
})
