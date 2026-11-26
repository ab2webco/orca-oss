import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import type * as FsPromises from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renameDurable, writeFileDurable, writeFileDurableIfCurrent } from './durable-file-write'

// Windows reader and antivirus locks cannot be provoked on Linux CI, so queue the errno codes instead.
const locks = vi.hoisted(() => ({ codes: [] as string[], renames: 0 }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>()
  return {
    ...actual,
    rename: async (source: string, target: string) => {
      locks.renames += 1
      const code = locks.codes.shift()
      if (!code) {
        return actual.rename(source, target)
      }
      throw Object.assign(new Error(`simulated ${code}`), { code })
    }
  }
})

function withPlatform(platform: string): () => void {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  return () => {
    if (original) {
      Object.defineProperty(process, 'platform', original)
    }
  }
}

describe('a durable write over a file Windows holds open', () => {
  let dir: string
  let restorePlatform: () => void = () => undefined

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'orca-durable-lock-'))
    locks.codes = []
    locks.renames = 0
  })

  afterEach(() => {
    restorePlatform()
    restorePlatform = () => undefined
    rmSync(dir, { recursive: true, force: true })
  })

  for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
    it(`retries a rename that fails with ${code} and publishes the payload`, async () => {
      restorePlatform = withPlatform('win32')
      const final = join(dir, 'state.json')
      writeFileSync(final, 'stale', 'utf-8')
      locks.codes = [code, code]
      await writeFileDurable(`${final}.tmp`, final, 'fresh')
      expect(readFileSync(final, 'utf-8')).toBe('fresh')
      expect(locks.renames).toBe(3)
      expect(readdirSync(dir)).toEqual(['state.json'])
    })
  }

  it('gives up after the last retry, keeps the old file and removes the temp', async () => {
    restorePlatform = withPlatform('win32')
    const final = join(dir, 'state.json')
    writeFileSync(final, 'stale', 'utf-8')
    locks.codes = Array.from({ length: 6 }, () => 'EPERM')
    await expect(writeFileDurable(`${final}.tmp`, final, 'fresh')).rejects.toMatchObject({
      code: 'EPERM'
    })
    expect(locks.renames).toBe(6)
    expect(readFileSync(final, 'utf-8')).toBe('stale')
    expect(readdirSync(dir)).toEqual(['state.json'])
  })

  it('never retries off Windows, where EPERM is a real permission error', async () => {
    restorePlatform = withPlatform('linux')
    const final = join(dir, 'state.json')
    locks.codes = ['EPERM']
    await expect(writeFileDurable(`${final}.tmp`, final, 'fresh')).rejects.toMatchObject({
      code: 'EPERM'
    })
    expect(locks.renames).toBe(1)
  })

  it('drops a snapshot a newer writer superseded while it waited out the lock', async () => {
    restorePlatform = withPlatform('win32')
    const final = join(dir, 'state.json')
    writeFileSync(final, 'newer', 'utf-8')
    locks.codes = ['EBUSY']
    // Current for the check before the first rename, superseded by the time the lock clears.
    let checks = 0
    const isCurrent = (): boolean => (checks += 1) === 1
    expect(await writeFileDurableIfCurrent(`${final}.tmp`, final, 'older', isCurrent)).toBe(false)
    expect(locks.renames).toBe(1)
    expect(checks).toBe(2)
    expect(readFileSync(final, 'utf-8')).toBe('newer')
    expect(readdirSync(dir)).toEqual(['state.json'])
  })

  it('retries the rename of renameDurable too', async () => {
    restorePlatform = withPlatform('win32')
    const final = join(dir, 'state.json')
    writeFileSync(`${final}.tmp`, 'fresh', 'utf-8')
    locks.codes = ['EPERM']
    await renameDurable(`${final}.tmp`, final)
    expect(readFileSync(final, 'utf-8')).toBe('fresh')
  })
})
