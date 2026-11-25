import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

// Inlined: importing the setup module would itself clear the keys and hide a missing setup entry.
const PANE_STATE_ENV_KEYS = [
  'CLAUDE_CONFIG_DIR',
  'ORCA_USER_DATA_PATH',
  'CODEX_HOME',
  'ORCA_CODEX_HOME'
] as const
const repoRoot = resolve(__dirname, '..', '..')
// Suites that wrote into a pane's real state before the setup cleared these keys (ORCA-1430).
const leakingSuites = [
  'src/main/claude-accounts/runtime-auth-service-injected-accounts.test.ts',
  'src/main/codex/codex-legacy-session-resume.test.ts'
]

describe('vitest pane state isolation', () => {
  const sentinels: string[] = []

  afterEach(() => {
    for (const sentinel of sentinels.splice(0)) {
      rmSync(sentinel, { recursive: true, force: true })
    }
  })

  it('hides every pane state pointer from tests', () => {
    for (const key of PANE_STATE_ENV_KEYS) {
      expect(process.env[key], key).toBeUndefined()
    }
  })

  it('leaves the directories a pane exports untouched by suites that used to write there', () => {
    const paneEnv = Object.fromEntries(
      PANE_STATE_ENV_KEYS.map((key) => {
        const sentinel = mkdtempSync(join(tmpdir(), `orca-pane-${key.toLowerCase()}-`))
        sentinels.push(sentinel)
        return [key, sentinel]
      })
    )

    const run = spawnSync(
      process.execPath,
      [
        join(repoRoot, 'node_modules', 'vitest', 'vitest.mjs'),
        'run',
        '--config',
        'config/vitest.config.ts',
        ...leakingSuites
      ],
      {
        cwd: repoRoot,
        env: { ...process.env, ...paneEnv },
        encoding: 'utf8',
        timeout: 120_000
      }
    )

    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
    const written = Object.fromEntries(
      Object.entries(paneEnv).map(([key, sentinel]) => [key, readdirSync(sentinel)])
    )
    expect(written).toEqual(Object.fromEntries(PANE_STATE_ENV_KEYS.map((key) => [key, []])))
  }, 150_000)
})
