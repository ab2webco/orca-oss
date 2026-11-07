import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/userData' } }))

import { ClaudeHookService } from './hook-service'

const SCRIPT = process.platform === 'win32' ? 'claude-hook.cmd' : 'claude-hook.sh'
// What a plugin appends after Orca's entry (orca-sonar did on 2026-11-06).
const PLUGIN_HOOK = {
  matcher: 'Bash',
  hooks: [{ type: 'command', command: '/usr/bin/node', args: ['/plugins/sonar/hint.mjs'] }]
}

let home = ''
let settingsPath = ''

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'orca-managed-placement-'))
  vi.stubEnv('HOME', home)
  vi.stubEnv('USERPROFILE', home)
  settingsPath = join(home, '.claude', 'settings.json')
  mkdirSync(join(home, '.claude'), { recursive: true })
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(home, { recursive: true, force: true })
})

function service(): ClaudeHookService {
  return new ClaudeHookService({ detectVersion: () => '2.1.218' })
}

function appendPluginHookAfterOrca(json: string): string {
  const config = JSON.parse(json) as { hooks: Record<string, unknown[]> }
  config.hooks.PreToolUse = [...config.hooks.PreToolUse, PLUGIN_HOOK]
  return `${JSON.stringify(config, null, 2)}\n`
}

function readBackupMtime(): number | null {
  try {
    return statSync(`${settingsPath}.bak`).mtimeMs
  } catch {
    return null
  }
}

describe('an identical Orca entry stays where it is (ORCA-1113)', () => {
  it('does not rewrite ~/.claude/settings.json or rotate its backup', () => {
    writeFileSync(settingsPath, '{}\n')
    service().install()
    writeFileSync(settingsPath, appendPluginHookAfterOrca(readFileSync(settingsPath, 'utf-8')))
    const before = readFileSync(settingsPath, 'utf-8')
    const backupBefore = readBackupMtime()

    service().install()

    expect(readFileSync(settingsPath, 'utf-8')).toBe(before)
    expect(readBackupMtime()).toBe(backupBefore)
  })

  it('leaves an account vault untouched', () => {
    const seeded = service().ensureInjectedVaultInstrumentation('{}')
    const vault = appendPluginHookAfterOrca(seeded!)

    expect(service().ensureInjectedVaultInstrumentation(vault)).toBeNull()
  })
})

describe('a dev Orca keeps the managed entries already in the real settings (ORCA-1113)', () => {
  it('never rewrites an Orca entry whose command differs from its own', () => {
    const installed = {
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: `/opt/old/.orca/agent-hooks/${SCRIPT}` }] }]
      },
      statusLine: { type: 'command', command: '/opt/old/.orca/agent-hooks/claude-statusline.sh' }
    }
    writeFileSync(settingsPath, `${JSON.stringify(installed, null, 2)}\n`)
    const before = readFileSync(settingsPath, 'utf-8')
    const dev = service()
    dev.setHomeManagedHookPolicy('keep-existing')

    dev.install()

    expect(readFileSync(settingsPath, 'utf-8')).toBe(before)
  })

  it('adds its entries when the real settings have no Orca entry', () => {
    writeFileSync(settingsPath, '{}\n')
    const dev = service()
    dev.setHomeManagedHookPolicy('keep-existing')

    const status = dev.install()

    expect(status.state).toBe('installed')
    expect(readFileSync(settingsPath, 'utf-8')).toContain(SCRIPT)
  })
})
