import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { localDispatchBriefHost, writeDispatchBrief } from './dispatch-brief-file'

describe('writeDispatchBrief', () => {
  let worktree: string

  beforeEach(() => {
    worktree = mkdtempSync(path.join(os.tmpdir(), 'orca-dispatch-brief-'))
  })

  afterEach(() => {
    rmSync(worktree, { recursive: true, force: true })
  })

  it('writes the full preamble to the brief and returns the path the member reads', async () => {
    const written = await writeDispatchBrief(localDispatchBriefHost, {
      worktreePath: worktree,
      dispatchId: 'ctx_ab12',
      preamble: 'full preamble\n=== TASK ===\ndo it\n',
      joinPath: path.join
    })
    expect(written).toBe('.orca/briefs/ctx_ab12.md')
    expect(readFileSync(path.join(worktree, '.orca/briefs/ctx_ab12.md'), 'utf8')).toBe(
      'full preamble\n=== TASK ===\ndo it\n'
    )
  })

  it('keeps the briefs folder out of git, including its own ignore file', async () => {
    await writeDispatchBrief(localDispatchBriefHost, {
      worktreePath: worktree,
      dispatchId: 'ctx_ab12',
      preamble: 'p',
      joinPath: path.join
    })
    expect(readFileSync(path.join(worktree, '.orca/briefs/.gitignore'), 'utf8')).toBe('*\n')
  })

  it('leaves a parent .orca/.gitignore alone, since .orca also holds tracked project files', async () => {
    await writeDispatchBrief(localDispatchBriefHost, {
      worktreePath: worktree,
      dispatchId: 'ctx_ab12',
      preamble: 'p',
      joinPath: path.join
    })
    expect(() => statSync(path.join(worktree, '.orca/.gitignore'))).toThrow()
  })

  it.skipIf(process.platform === 'win32')(
    'is readable only by its owner locally, since it holds the dispatch capability',
    async () => {
      await writeDispatchBrief(localDispatchBriefHost, {
        worktreePath: worktree,
        dispatchId: 'ctx_ab12',
        preamble: 'p',
        joinPath: path.join
      })
      expect(statSync(path.join(worktree, '.orca/briefs/ctx_ab12.md')).mode & 0o777).toBe(0o600)
    }
  )

  it('writes through any host with createDir and writeFile, as the SSH provider does', async () => {
    const calls: string[] = []
    const host = {
      createDir: async (dirPath: string) => {
        calls.push(`dir ${dirPath}`)
        await mkdir(dirPath, { recursive: true })
      },
      writeFile: async (filePath: string, content: string) => {
        calls.push(`file ${filePath}`)
        await writeFile(filePath, content)
      }
    }
    await writeDispatchBrief(host, {
      worktreePath: worktree,
      dispatchId: 'ctx_ab12',
      preamble: 'remote preamble',
      joinPath: path.posix.join
    })
    expect(calls).toEqual([
      `dir ${worktree}/.orca/briefs`,
      `file ${worktree}/.orca/briefs/.gitignore`,
      `file ${worktree}/.orca/briefs/ctx_ab12.md`
    ])
    expect(readFileSync(path.join(worktree, '.orca/briefs/ctx_ab12.md'), 'utf8')).toBe(
      'remote preamble'
    )
  })

  it('rejects when the host cannot write, so the caller can type the full preamble', async () => {
    const host = {
      createDir: async () => undefined,
      writeFile: async () => {
        throw new Error('EACCES: permission denied')
      }
    }
    await expect(
      writeDispatchBrief(host, {
        worktreePath: worktree,
        dispatchId: 'ctx_ab12',
        preamble: 'p',
        joinPath: path.join
      })
    ).rejects.toThrow('EACCES')
  })
})
