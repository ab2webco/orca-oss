// Why: locks in the remote-install contract so a refactor cannot silently
// drift the produced settings.json shape, the wrapper-quoted command path,
// or the script body that lands on the remote box. Local install behavior
// is exercised through `installer-utils.test.ts` and the per-CLI status
// audit; this file covers ONLY the SFTP-backed path added in commit #8.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vi, describe, expect, it } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/userData'
  }
}))

// Why: keep the default (uninjected) service deterministic — never spawn a real
// `claude --version` in unit tests. Pin a recent version so the full event set
// is eligible; gating-specific tests inject their own `detectVersion`.
vi.mock('./hook-event-versions', async (importActual) => {
  const actual = await importActual<typeof HookEventVersionsModule>()
  return { ...actual, detectClaudeCodeVersion: () => '2.1.218' }
})

import type { SFTPWrapper } from 'ssh2'
import type * as HookEventVersionsModule from './hook-event-versions'
import { createManagedCommandMatcher } from '../agent-hooks/installer-utils'
import { ClaudeHookService } from './hook-service'
import { OPENCLAUDE_HOOK_SETTINGS } from './hook-settings'

const CLAUDE_SCRIPT_FILE_NAME = process.platform === 'win32' ? 'claude-hook.cmd' : 'claude-hook.sh'
const STATUSLINE_SCRIPT_FILE_NAME =
  process.platform === 'win32' ? 'claude-statusline.cmd' : 'claude-statusline.sh'
const OPENCLAUDE_SCRIPT_FILE_NAME =
  process.platform === 'win32' ? 'openclaude-hook.cmd' : 'openclaude-hook.sh'
const WINDOWS_POWERSHELL_LAUNCHER =
  /^[A-Za-z]:\/[^"]*\/System32\/WindowsPowerShell\/v1\.0\/powershell\.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand \S+$/
const isClaudeManagedCommand = createManagedCommandMatcher(CLAUDE_SCRIPT_FILE_NAME)
const isOpenClaudeManagedCommand = createManagedCommandMatcher(OPENCLAUDE_SCRIPT_FILE_NAME)

type FakeFs = {
  files: Map<string, string>
  dirs: Set<string>
  modes: Map<string, number>
}

function createFakeSftp(): { sftp: SFTPWrapper; fs: FakeFs } {
  const fs: FakeFs = {
    files: new Map(),
    dirs: new Set(['/']),
    modes: new Map()
  }
  const noEntryError = (path: string): { code: number; message: string } => ({
    code: 2,
    message: `ENOENT ${path}`
  })
  const fakeStats = (mode: number): { mode: number } => ({ mode })
  const sftp = {
    readFile: (path: string, _enc: string, cb: (err: unknown, data?: string) => void): void => {
      const v = fs.files.get(path)
      if (v === undefined) {
        cb(noEntryError(path))
        return
      }
      cb(null, v)
    },
    writeFile: (
      path: string,
      content: string,
      options: string | { mode?: number },
      cb: (err: unknown) => void
    ): void => {
      fs.files.set(path, content)
      if (typeof options !== 'string' && options.mode !== undefined) {
        fs.modes.set(path, options.mode)
      }
      cb(null)
    },
    rename: (src: string, dst: string, cb: (err: unknown) => void): void => {
      const v = fs.files.get(src)
      if (v === undefined) {
        cb(noEntryError(src))
        return
      }
      fs.files.set(dst, v)
      fs.files.delete(src)
      const mode = fs.modes.get(src)
      if (mode !== undefined) {
        fs.modes.set(dst, mode)
        fs.modes.delete(src)
      }
      cb(null)
    },
    unlink: (path: string, cb: (err: unknown) => void): void => {
      fs.files.delete(path)
      fs.modes.delete(path)
      cb(null)
    },
    chmod: (path: string, mode: number, cb: (err: unknown) => void): void => {
      fs.modes.set(path, mode)
      cb(null)
    },
    stat: (path: string, cb: (err: unknown, stats?: { mode: number }) => void): void => {
      if (!fs.files.has(path)) {
        cb(noEntryError(path))
        return
      }
      cb(null, fakeStats(fs.modes.get(path) ?? 0o100644))
    },
    readdir: (path: string, cb: (err: unknown, list?: { filename: string }[]) => void): void => {
      if (fs.dirs.has(path)) {
        cb(null, [])
        return
      }
      cb(noEntryError(path))
    },
    mkdir: (path: string, cb: (err: unknown) => void): void => {
      fs.dirs.add(path)
      cb(null)
    }
  } as unknown as SFTPWrapper
  return { sftp, fs }
}

describe('ClaudeHookService.install', () => {
  it('installs managed hooks into Claude settings and preserves user Bedrock settings', () => {
    const tmpHome = mkdtempSync(join(tmpdir(), 'orca-claude-hooks-'))
    vi.stubEnv('HOME', tmpHome)
    vi.stubEnv('USERPROFILE', tmpHome)
    try {
      const legacyPath = join(tmpHome, '.claude', 'settings.json')
      mkdirSync(join(tmpHome, '.claude'), { recursive: true })
      writeFileSync(
        legacyPath,
        JSON.stringify({
          apiKeyHelper: '/opt/company/claude-key-helper',
          awsAuthRefresh: '/opt/company/aws-refresh',
          awsCredentialExport: '/opt/company/aws-export',
          env: {
            CLAUDE_CODE_USE_BEDROCK: '1',
            AWS_REGION: 'us-west-2'
          },
          hooks: {
            Stop: [
              {
                hooks: [{ type: 'command', command: '/usr/local/bin/user-hook' }]
              },
              {
                hooks: [
                  {
                    type: 'command',
                    command: '/Users/old/.orca/agent-hooks/claude-hook.sh'
                  }
                ]
              }
            ]
          }
        })
      )

      // Why: pin a recent version so StopFailure (minVersion 2.1.78) is eligible.
      const status = new ClaudeHookService({ detectVersion: () => '2.1.218' }).install()
      expect(status.state).toBe('installed')

      const legacy = JSON.parse(readFileSync(legacyPath, 'utf-8'))
      expect(legacy).toMatchObject({
        apiKeyHelper: '/opt/company/claude-key-helper',
        awsAuthRefresh: '/opt/company/aws-refresh',
        awsCredentialExport: '/opt/company/aws-export',
        env: {
          CLAUDE_CODE_USE_BEDROCK: '1',
          AWS_REGION: 'us-west-2'
        }
      })
      const legacyCommands = legacy.hooks.Stop.flatMap(
        (definition: { hooks: { command: string }[] }) =>
          definition.hooks.map((hook) => hook.command)
      )
      expect(legacyCommands).toContain('/usr/local/bin/user-hook')
      expect(legacyCommands.some((command: string) => isClaudeManagedCommand(command))).toBe(true)
      expect(
        legacyCommands.some((command: string) =>
          command.includes('/Users/old/.orca/agent-hooks/claude-hook.sh')
        )
      ).toBe(false)
      expect(isClaudeManagedCommand(legacy.hooks.StopFailure[0].hooks[0].command)).toBe(true)
      expect(
        readFileSync(join(tmpHome, '.orca', 'agent-hooks', CLAUDE_SCRIPT_FILE_NAME), 'utf-8')
      ).toContain('DEVIN_PROJECT_DIR')
    } finally {
      vi.unstubAllEnvs()
      rmSync(tmpHome, { recursive: true, force: true })
    }
  })

  it('installs the managed statusLine command and forwards rate_limits posts', () => {
    const tmpHome = mkdtempSync(join(tmpdir(), 'orca-claude-statusline-'))
    vi.stubEnv('HOME', tmpHome)
    vi.stubEnv('USERPROFILE', tmpHome)
    try {
      expect(new ClaudeHookService().install().state).toBe('installed')

      const settings = JSON.parse(
        readFileSync(join(tmpHome, '.claude', 'settings.json'), 'utf-8')
      ) as { statusLine?: { type: string; command: string } }
      expect(settings.statusLine?.type).toBe('command')
      expect(settings.statusLine?.command).toContain('claude-statusline')

      const script = readFileSync(
        join(tmpHome, '.orca', 'agent-hooks', STATUSLINE_SCRIPT_FILE_NAME),
        'utf-8'
      )
      expect(script).toContain('/statusline/claude')
      // Why: non-subscriber sessions never carry rate_limits; both branches must guard before spawning curl.
      if (process.platform === 'win32') {
        expect(script).toContain('findstr.exe" /c:\\"rate_limits\\"')
        expect(script).toContain('--data-urlencode "payload@%ORCA_STATUSLINE_PAYLOAD_FILE%"')
      } else {
        expect(script).toContain('"rate_limits"')
        expect(script).toContain('--data-urlencode "payload@-"')
      }
    } finally {
      vi.unstubAllEnvs()
      rmSync(tmpHome, { recursive: true, force: true })
    }
  })

  it('never overwrites a user-owned statusLine command', () => {
    const tmpHome = mkdtempSync(join(tmpdir(), 'orca-claude-user-statusline-'))
    vi.stubEnv('HOME', tmpHome)
    vi.stubEnv('USERPROFILE', tmpHome)
    try {
      const settingsPath = join(tmpHome, '.claude', 'settings.json')
      mkdirSync(join(tmpHome, '.claude'), { recursive: true })
      writeFileSync(
        settingsPath,
        JSON.stringify({ statusLine: { type: 'command', command: '/usr/local/bin/my-statusline' } })
      )

      expect(new ClaudeHookService().install().state).toBe('installed')

      const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'))
      expect(settings.statusLine).toEqual({
        type: 'command',
        command: '/usr/local/bin/my-statusline'
      })

      // remove() must also leave the user's statusLine untouched.
      new ClaudeHookService().remove()
      const afterRemove = JSON.parse(readFileSync(settingsPath, 'utf-8'))
      expect(afterRemove.statusLine).toEqual({
        type: 'command',
        command: '/usr/local/bin/my-statusline'
      })
    } finally {
      vi.unstubAllEnvs()
      rmSync(tmpHome, { recursive: true, force: true })
    }
  })

  it('removes the managed statusLine on remove()', () => {
    const tmpHome = mkdtempSync(join(tmpdir(), 'orca-claude-statusline-remove-'))
    vi.stubEnv('HOME', tmpHome)
    vi.stubEnv('USERPROFILE', tmpHome)
    try {
      new ClaudeHookService().install()
      new ClaudeHookService().remove()
      const settings = JSON.parse(readFileSync(join(tmpHome, '.claude', 'settings.json'), 'utf-8'))
      expect(settings.statusLine).toBeUndefined()
    } finally {
      vi.unstubAllEnvs()
      rmSync(tmpHome, { recursive: true, force: true })
    }
  })

  it('does not re-install a managed statusLine the user deleted, until remove() resets the opt-out', () => {
    const tmpHome = mkdtempSync(join(tmpdir(), 'orca-claude-statusline-optout-'))
    vi.stubEnv('HOME', tmpHome)
    vi.stubEnv('USERPROFILE', tmpHome)
    try {
      const settingsPath = join(tmpHome, '.claude', 'settings.json')
      new ClaudeHookService().install()
      expect(JSON.parse(readFileSync(settingsPath, 'utf-8')).statusLine).toBeTruthy()

      // The user deletes the managed statusLine from settings.json (e.g. via /statusline or an editor).
      const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'))
      delete settings.statusLine
      writeFileSync(settingsPath, JSON.stringify(settings))

      // A later install (app restart) must respect the deletion — statusLine is opportunistic, not required.
      new ClaudeHookService().install()
      expect(JSON.parse(readFileSync(settingsPath, 'utf-8')).statusLine).toBeUndefined()

      // An Orca-level remove() resets the opt-out memory, so a fresh install re-adds it.
      new ClaudeHookService().remove()
      new ClaudeHookService().install()
      expect(JSON.parse(readFileSync(settingsPath, 'utf-8')).statusLine).toBeTruthy()
    } finally {
      vi.unstubAllEnvs()
      rmSync(tmpHome, { recursive: true, force: true })
    }
  })

  it('keeps refreshing a still-managed statusLine across installs', () => {
    const tmpHome = mkdtempSync(join(tmpdir(), 'orca-claude-statusline-refresh-'))
    vi.stubEnv('HOME', tmpHome)
    vi.stubEnv('USERPROFILE', tmpHome)
    try {
      const settingsPath = join(tmpHome, '.claude', 'settings.json')
      new ClaudeHookService().install()
      new ClaudeHookService().install()
      const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'))
      expect(settings.statusLine?.command).toContain('claude-statusline')
    } finally {
      vi.unstubAllEnvs()
      rmSync(tmpHome, { recursive: true, force: true })
    }
  })

  // Why: #6078 — Claude Code runs hooks through Git Bash, and an unquoted path
  // with a space (e.g. `C:/Users/Jane Doe`) splits at the space. The managed
  // command must use an encoded launcher so Git Bash/cmd.exe never splits or
  // expands the raw path before invoking the managed .cmd.
  it.skipIf(process.platform !== 'win32')(
    'wraps the managed hook command to survive spaces in the profile path (#6078)',
    () => {
      const tmpHome = mkdtempSync(join(tmpdir(), 'orca claude home with spaces '))
      vi.stubEnv('HOME', tmpHome)
      vi.stubEnv('USERPROFILE', tmpHome)
      try {
        expect(new ClaudeHookService({ detectVersion: () => '2.1.218' }).install().state).toBe(
          'installed'
        )

        const settings = JSON.parse(
          readFileSync(join(tmpHome, '.claude', 'settings.json'), 'utf-8')
        ) as { hooks: Record<string, { hooks: { command: string }[] }[]> }

        for (const eventName of ['UserPromptSubmit', 'Stop', 'StopFailure']) {
          const command = settings.hooks[eventName]?.[0]?.hooks?.[0]?.command
          expect(command).toMatch(WINDOWS_POWERSHELL_LAUNCHER)
        }
      } finally {
        vi.unstubAllEnvs()
        rmSync(tmpHome, { recursive: true, force: true })
      }
    }
  )

  // Why: the launcher must stay PowerShell-encoded for Git Bash, but the hook
  // POST inside the .cmd should use curl.exe so each hook spawns one
  // interpreter, not two. Posting via a second PowerShell was the slow path.
  it.skipIf(process.platform !== 'win32')(
    'posts from the managed .cmd via curl.exe, not a second PowerShell',
    () => {
      const tmpHome = mkdtempSync(join(tmpdir(), 'orca-claude-curl-'))
      vi.stubEnv('HOME', tmpHome)
      vi.stubEnv('USERPROFILE', tmpHome)
      try {
        expect(new ClaudeHookService().install().state).toBe('installed')
        const script = readFileSync(
          join(tmpHome, '.orca', 'agent-hooks', CLAUDE_SCRIPT_FILE_NAME),
          'utf-8'
        )
        expect(script).toContain('%SystemRoot%\\System32\\curl.exe')
        expect(script).toContain('--data-urlencode "payload@-"')
        expect(script).toContain('/hook/claude')
        expect(script).not.toMatch(/Invoke-WebRequest/i)
      } finally {
        vi.unstubAllEnvs()
        rmSync(tmpHome, { recursive: true, force: true })
      }
    }
  )
})

describe('ClaudeHookService version gating', () => {
  const GATED_EVENTS = [
    'StopFailure',
    'SubagentStart',
    'TeammateIdle',
    'PostToolUseFailure',
    'PermissionRequest'
  ]
  const BASE_EVENTS = ['UserPromptSubmit', 'Stop', 'SubagentStop', 'PreToolUse', 'PostToolUse']

  const withTmpHome = (fn: (home: string) => void): void => {
    const tmpHome = mkdtempSync(join(tmpdir(), 'orca-claude-gating-'))
    vi.stubEnv('HOME', tmpHome)
    vi.stubEnv('USERPROFILE', tmpHome)
    try {
      fn(tmpHome)
    } finally {
      vi.unstubAllEnvs()
      rmSync(tmpHome, { recursive: true, force: true })
    }
  }

  const readHooks = (home: string): Record<string, unknown> =>
    JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf-8')).hooks

  // Why: an older client that never received StopFailure et al. must not be told
  // its install is degraded forever — getStatus() gates on the same version.
  it('omits gated keys for an old client and does not report perpetual partial', () => {
    withTmpHome((home) => {
      const svc = new ClaudeHookService({ detectVersion: () => '2.0.44' })
      const status = svc.install()
      expect(status.state).toBe('installed')
      const hooks = readHooks(home)
      // 2.0.44 has the base set plus SubagentStart (2.0.43)...
      for (const event of ['UserPromptSubmit', 'Stop', 'PreToolUse', 'SubagentStart']) {
        expect(hooks[event]).toBeTruthy()
      }
      // ...but predates PermissionRequest (2.0.45), TeammateIdle (2.1.33) and StopFailure (2.1.78).
      for (const event of [
        'PermissionRequest',
        'TeammateIdle',
        'StopFailure',
        'PostToolUseFailure'
      ]) {
        expect(hooks[event]).toBeUndefined()
      }
      // A fresh instance reading the same file still reports installed, not partial.
      expect(new ClaudeHookService({ detectVersion: () => '2.0.44' }).getStatus().state).toBe(
        'installed'
      )
    })
  })

  it('injects the full event set for a new client', () => {
    withTmpHome((home) => {
      const status = new ClaudeHookService({ detectVersion: () => '2.1.218' }).install()
      expect(status.state).toBe('installed')
      const hooks = readHooks(home)
      for (const event of [...BASE_EVENTS, ...GATED_EVENTS]) {
        expect(hooks[event]).toBeTruthy()
      }
    })
  })

  it('injects only the safe base set when the version is undetectable', () => {
    withTmpHome((home) => {
      const status = new ClaudeHookService({ detectVersion: () => null }).install()
      expect(status.state).toBe('installed')
      const hooks = readHooks(home)
      for (const event of BASE_EVENTS) {
        expect(hooks[event]).toBeTruthy()
      }
      for (const event of GATED_EVENTS) {
        expect(hooks[event]).toBeUndefined()
      }
      expect(new ClaudeHookService({ detectVersion: () => null }).getStatus().state).toBe(
        'installed'
      )
    })
  })

  // Why: OpenClaude forks Claude Code with its own versioning, so it stays
  // ungated and keeps receiving StopFailure regardless of Claude Code floors.
  it('keeps OpenClaude ungated (full set) even with an old detected version', () => {
    withTmpHome((home) => {
      const svc = new ClaudeHookService({
        agent: 'openclaude',
        displayName: 'OpenClaude',
        settings: OPENCLAUDE_HOOK_SETTINGS,
        detectVersion: () => '1.0.0'
      })
      expect(svc.install().state).toBe('installed')
      const hooks = JSON.parse(
        readFileSync(join(home, '.openclaude', 'settings.json'), 'utf-8')
      ).hooks
      for (const event of [...BASE_EVENTS, ...GATED_EVENTS]) {
        expect(hooks[event]).toBeTruthy()
      }
    })
  })
})

describe('ClaudeHookService.installRemote', () => {
  it('writes Claude settings + managed script under the remote $HOME', async () => {
    const svc = new ClaudeHookService()
    const { sftp, fs } = createFakeSftp()
    const status = await svc.installRemote(sftp, '/home/dev')
    expect(status.state).toBe('installed')
    expect(status.configPath).toBe('/home/dev/.claude/settings.json')
    const settings = fs.files.get('/home/dev/.claude/settings.json')
    expect(settings).toBeTruthy()
    const parsed = JSON.parse(settings!)
    // Why: the remote box's Claude version is unknown and unprobed, so remote
    // installs inject only the always-safe base events. A gated key would make
    // an older remote client reject the entire settings.json.
    for (const event of ['UserPromptSubmit', 'Stop', 'SubagentStop', 'PreToolUse', 'PostToolUse']) {
      expect(parsed.hooks[event]).toBeTruthy()
      const cmd = parsed.hooks[event][0].hooks[0].command as string
      expect(cmd).toContain('/home/dev/.orca/agent-hooks/claude-hook.sh')
      expect(cmd).toMatch(/^if \[ -f /)
    }
    // Gated events are omitted remotely — see the base-set rationale above.
    for (const event of [
      'StopFailure',
      'SubagentStart',
      'TeammateIdle',
      'PostToolUseFailure',
      'PermissionRequest'
    ]) {
      expect(parsed.hooks[event]).toBeUndefined()
    }
    // Managed script body
    const script = fs.files.get('/home/dev/.orca/agent-hooks/claude-hook.sh')
    expect(script).toContain('#!/bin/sh')
    expect(script).toContain('DEVIN_PROJECT_DIR')
    // Why: payload is piped to curl via stdin (`payload@-`) so it never lands
    // on the curl command line (EDR oversized-command-line false positive),
    // matching the Windows curl.exe hook post.
    expect(script).toContain('printf \'%s\' "$payload" | curl')
    expect(script).toContain('--data-urlencode "payload@-"')
    expect(script).not.toContain('--data-urlencode "payload=${payload}"')
    expect(fs.modes.get('/home/dev/.orca/agent-hooks/claude-hook.sh')).toBe(0o755)
    // Why: no remote statusLine — this path serves SSH remotes and WSL guests, whose relay
    // listener doesn't route /statusline/claude and whose accounts aren't attributable locally.
    expect(parsed.statusLine).toBeUndefined()
    expect(fs.files.get('/home/dev/.orca/agent-hooks/claude-statusline.sh')).toBeUndefined()
  })

  it('reports parse error when remote settings.json cannot be parsed', async () => {
    const svc = new ClaudeHookService()
    const { sftp, fs } = createFakeSftp()
    fs.files.set('/home/dev/.claude/settings.json', 'not json')
    const status = await svc.installRemote(sftp, '/home/dev')
    expect(status.state).toBe('error')
    expect(status.managedHooksPresent).toBe(false)
    expect(status.detail).toContain('Could not parse remote Claude settings.json')
  })

  it('preserves user-authored hook entries while sweeping old managed entries', async () => {
    const svc = new ClaudeHookService()
    const { sftp, fs } = createFakeSftp()
    fs.files.set(
      '/home/dev/.claude/settings.json',
      JSON.stringify({
        hooks: {
          Stop: [
            {
              hooks: [{ type: 'command', command: '/usr/local/bin/my-user-hook' }]
            },
            {
              hooks: [
                {
                  type: 'command',
                  command:
                    'if [ -x /home/dev/.orca/agent-hooks/claude-hook.sh ]; then /bin/sh /home/dev/.orca/agent-hooks/claude-hook.sh; fi'
                }
              ]
            }
          ]
        }
      })
    )
    await svc.installRemote(sftp, '/home/dev')
    const parsed = JSON.parse(fs.files.get('/home/dev/.claude/settings.json')!)
    // Original user-authored entry survives, while stale Orca entries are
    // replaced with the current managed hook command.
    const stopDefs = parsed.hooks.Stop as { hooks: { command: string }[] }[]
    const userCmds = stopDefs.flatMap((d) => d.hooks.map((h) => h.command))
    expect(userCmds).toContain('/usr/local/bin/my-user-hook')
    expect(userCmds.filter((c) => c.includes('claude-hook.sh'))).toHaveLength(1)
  })
})

describe('OpenClaudeHookService-compatible install', () => {
  const makeOpenClaudeService = (): ClaudeHookService =>
    new ClaudeHookService({
      agent: 'openclaude',
      displayName: 'OpenClaude',
      settings: OPENCLAUDE_HOOK_SETTINGS
    })

  it('installs managed hooks into OpenClaude settings without touching Claude settings', () => {
    const tmpHome = mkdtempSync(join(tmpdir(), 'orca-openclaude-hooks-'))
    vi.stubEnv('HOME', tmpHome)
    vi.stubEnv('USERPROFILE', tmpHome)
    try {
      const openClaudeSettings = join(tmpHome, '.openclaude', 'settings.json')
      mkdirSync(join(tmpHome, '.openclaude'), { recursive: true })
      writeFileSync(openClaudeSettings, JSON.stringify({ hooks: {} }))

      const status = makeOpenClaudeService().install()

      expect(status).toMatchObject({
        agent: 'openclaude',
        state: 'installed',
        configPath: openClaudeSettings
      })
      const parsed = JSON.parse(readFileSync(openClaudeSettings, 'utf-8'))
      for (const event of ['UserPromptSubmit', 'Stop', 'StopFailure']) {
        const command = parsed.hooks[event][0].hooks[0].command as string
        expect(isOpenClaudeManagedCommand(command)).toBe(true)
        if (process.platform !== 'win32') {
          expect(command).toMatch(/^if \[ -f /)
        }
      }
      expect(
        readFileSync(join(tmpHome, '.orca', 'agent-hooks', OPENCLAUDE_SCRIPT_FILE_NAME), 'utf-8')
      ).toContain('/hook/claude')
      expect(
        readFileSync(join(tmpHome, '.orca', 'agent-hooks', OPENCLAUDE_SCRIPT_FILE_NAME), 'utf-8')
      ).not.toContain('DEVIN_PROJECT_DIR')
      // Why: the statusline usage feed is Claude-only; OpenClaude installs must not set statusLine.
      expect(parsed.statusLine).toBeUndefined()
      expect(existsSync(join(tmpHome, '.claude', 'settings.json'))).toBe(false)
    } finally {
      vi.unstubAllEnvs()
      rmSync(tmpHome, { recursive: true, force: true })
    }
  })

  it('writes remote OpenClaude settings under .openclaude', async () => {
    const { sftp, fs } = createFakeSftp()

    const status = await makeOpenClaudeService().installRemote(sftp, '/home/dev')

    expect(status).toMatchObject({
      agent: 'openclaude',
      state: 'installed',
      configPath: '/home/dev/.openclaude/settings.json'
    })
    const parsed = JSON.parse(fs.files.get('/home/dev/.openclaude/settings.json')!)
    const command = parsed.hooks.StopFailure[0].hooks[0].command as string
    expect(command).toContain('/home/dev/.orca/agent-hooks/openclaude-hook.sh')
    expect(fs.files.get('/home/dev/.orca/agent-hooks/openclaude-hook.sh')).toContain('/hook/claude')
  })
})

// Why: a worktree pinned to a managed account launches with CLAUDE_CONFIG_DIR set to an
// isolated vault, so the shared ~/.claude instrumentation never applies. This entry point
// derives the SAME hook + statusLine (from the shared installer) for the vault's settings.json.
describe('ClaudeHookService.ensureInjectedVaultInstrumentation', () => {
  it('merges managed hooks + statusLine while preserving existing vault keys', () => {
    const tmpHome = mkdtempSync(join(tmpdir(), 'orca-claude-vault-'))
    vi.stubEnv('HOME', tmpHome)
    vi.stubEnv('USERPROFILE', tmpHome)
    try {
      const merged = new ClaudeHookService().ensureInjectedVaultInstrumentation(
        JSON.stringify({
          skipDangerousModePermissionPrompt: true,
          theme: 'dark',
          env: { ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic', ANTHROPIC_AUTH_TOKEN: 't' }
        })
      )
      expect(merged).not.toBeNull()
      const parsed = JSON.parse(merged!) as {
        skipDangerousModePermissionPrompt?: boolean
        theme?: string
        env?: Record<string, string>
        hooks?: Record<string, { hooks: { command: string }[] }[]>
        statusLine?: { type: string; command: string }
      }
      // Existing keys — including a custom-endpoint env token — must survive untouched.
      expect(parsed.skipDangerousModePermissionPrompt).toBe(true)
      expect(parsed.theme).toBe('dark')
      expect(parsed.env).toEqual({
        ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic',
        ANTHROPIC_AUTH_TOKEN: 't'
      })
      expect(isClaudeManagedCommand(parsed.hooks!.Stop[0].hooks[0].command)).toBe(true)
      expect(parsed.statusLine?.command).toContain('claude-statusline')
      // The shared scripts the vault points at are written under ~/.orca.
      expect(existsSync(join(tmpHome, '.orca', 'agent-hooks', CLAUDE_SCRIPT_FILE_NAME))).toBe(true)
      expect(existsSync(join(tmpHome, '.orca', 'agent-hooks', STATUSLINE_SCRIPT_FILE_NAME))).toBe(
        true
      )
    } finally {
      vi.unstubAllEnvs()
      rmSync(tmpHome, { recursive: true, force: true })
    }
  })

  it('treats an absent (null) vault settings.json as an empty config to seed', () => {
    const tmpHome = mkdtempSync(join(tmpdir(), 'orca-claude-vault-empty-'))
    vi.stubEnv('HOME', tmpHome)
    vi.stubEnv('USERPROFILE', tmpHome)
    try {
      const merged = new ClaudeHookService().ensureInjectedVaultInstrumentation(null)
      expect(merged).not.toBeNull()
      const parsed = JSON.parse(merged!) as {
        hooks: Record<string, { hooks: { command: string }[] }[]>
        statusLine: { command: string }
      }
      expect(isClaudeManagedCommand(parsed.hooks.Stop[0].hooks[0].command)).toBe(true)
      expect(parsed.statusLine.command).toContain('claude-statusline')
    } finally {
      vi.unstubAllEnvs()
      rmSync(tmpHome, { recursive: true, force: true })
    }
  })

  it('returns null when the merge changes nothing (idempotent, no needless write)', () => {
    const tmpHome = mkdtempSync(join(tmpdir(), 'orca-claude-vault-idem-'))
    vi.stubEnv('HOME', tmpHome)
    vi.stubEnv('USERPROFILE', tmpHome)
    try {
      const service = new ClaudeHookService()
      const merged = service.ensureInjectedVaultInstrumentation('{}')
      expect(merged).not.toBeNull()
      expect(service.ensureInjectedVaultInstrumentation(merged)).toBeNull()
    } finally {
      vi.unstubAllEnvs()
      rmSync(tmpHome, { recursive: true, force: true })
    }
  })

  it('never clobbers unparseable or non-object vault content', () => {
    const tmpHome = mkdtempSync(join(tmpdir(), 'orca-claude-vault-bad-'))
    vi.stubEnv('HOME', tmpHome)
    vi.stubEnv('USERPROFILE', tmpHome)
    try {
      const service = new ClaudeHookService()
      expect(service.ensureInjectedVaultInstrumentation('{ not json')).toBeNull()
      expect(service.ensureInjectedVaultInstrumentation('"a string"')).toBeNull()
    } finally {
      vi.unstubAllEnvs()
      rmSync(tmpHome, { recursive: true, force: true })
    }
  })
})
