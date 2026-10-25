import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ORCHESTRATOR_GAME_ARCADE_RUNNER } from '../../shared/orchestrator-game-arcade-file'
import type { RuntimeClient } from '../runtime-client'
import { ORCHESTRATOR_GAME_ARCADE_HANDLERS } from './orchestrator-game-arcade'

// Why: validating never reaches the runtime, so any call is a bug.
const offline = {
  call: async () => {
    throw new Error('no runtime call expected')
  }
} as unknown as RuntimeClient

describe('orca game game validate', () => {
  let dir = ''
  let out = ''
  const run = (cwd: string, flags: Record<string, string>, json = false) =>
    ORCHESTRATOR_GAME_ARCADE_HANDLERS['game game validate']({
      flags: new Map(Object.entries(flags)),
      client: offline,
      cwd,
      json
    })

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'orca-arcade-cli-'))
    out = ''
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      out += String(chunk)
      return true
    })
    process.exitCode = undefined
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(dir, { recursive: true, force: true })
    process.exitCode = undefined
  })

  it('says a good game is ready and lists every problem of a bad one', async () => {
    writeFileSync(join(dir, 'good.json'), ORCHESTRATOR_GAME_ARCADE_RUNNER)
    await run(dir, { file: 'good.json' })
    expect(out).toContain('good.json: valid')
    expect(process.exitCode).toBeUndefined()

    const bad = JSON.parse(ORCHESTRATOR_GAME_ARCADE_RUNNER)
    bad.fps = 60
    delete bad.jump
    writeFileSync(join(dir, 'bad.json'), JSON.stringify(bad))
    out = ''
    await run(dir, { file: 'bad.json' }, true)
    expect(JSON.parse(out)).toEqual({
      file: 'bad.json',
      valid: false,
      issues: [
        'fps: must be a whole number from 5 to 15',
        'jump: Invalid input: expected object, received undefined'
      ]
    })
    expect(process.exitCode).toBe(1)
  })

  it('refuses a missing file and one too large for the game to read', async () => {
    await run(dir, { file: 'nope.json' })
    expect(out).toContain('nope.json: 1 problem(s)\n  not found')
    expect(process.exitCode).toBe(1)

    writeFileSync(join(dir, 'big.json'), ' '.repeat(20 * 1024))
    out = ''
    await run(dir, { file: 'big.json' })
    expect(out).toContain('larger than 16 KB')
  })
})
