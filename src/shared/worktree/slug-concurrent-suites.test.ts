import { spawn } from 'node:child_process'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { worktreeSlugEnv } from './slug'

// A fixture "test suite": it claims a resource named from the slug exclusively, as a test
// database would, holds it while it runs, and fails if a sibling run already holds it.
const SUITE = `
const fs = require('node:fs')
const path = require('node:path')
const name = 'test_db_' + (process.env.ORCA_WORKTREE_SLUG || 'shared') + '.lock'
const fd = fs.openSync(path.join(process.argv[1], name), 'wx')
setTimeout(() => { fs.closeSync(fd); process.exit(0) }, 300)
`

function runSuite(dir: string, env: Record<string, string>): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['-e', SUITE, dir], {
      env: { ...process.env, ORCA_WORKTREE_SLUG: '', ...env },
      stdio: 'ignore'
    })
    child.on('exit', (code) => resolve(code))
  })
}

describe('ORCA_WORKTREE_SLUG keeps concurrent suites of sibling worktrees apart', () => {
  let dir = ''
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('collides without the slug and runs both suites with it', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'orca-slug-'))
    const unslugged = await Promise.all([runSuite(dir, {}), runSuite(dir, {})])
    expect(unslugged.filter((code) => code !== 0)).toHaveLength(1)
    await rm(dir, { recursive: true, force: true })

    dir = await mkdtemp(path.join(tmpdir(), 'orca-slug-'))
    const codes = await Promise.all([
      runSuite(dir, worktreeSlugEnv('repo-1::/w/orca/feature-a')),
      runSuite(dir, worktreeSlugEnv('repo-1::/w/orca/feature-b'))
    ])
    expect(codes).toEqual([0, 0])
    expect(await readdir(dir)).toHaveLength(2)
  })
})
