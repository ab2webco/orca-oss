import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findSkillRepointAgentKeys } from './skill-repoint-agent-keys'

describe('findSkillRepointAgentKeys', () => {
  let home: string

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'orca-repoint-'))
  })

  afterEach(async () => {
    await rm(home, { recursive: true, force: true })
  })

  it('names every agent home that holds an Orca skill, plus universal', async () => {
    // An independent copy in Claude's home, a canonical copy, and a link from Codex.
    await mkdir(join(home, '.claude', 'skills', 'orca-cli'), { recursive: true })
    await mkdir(join(home, '.agents', 'skills', 'orca-cli'), { recursive: true })
    await mkdir(join(home, '.codex', 'skills'), { recursive: true })
    await symlink(
      join(home, '.agents', 'skills', 'orca-cli'),
      join(home, '.codex', 'skills', 'orca-cli'),
      'junction'
    )

    expect(
      await findSkillRepointAgentKeys(['orca-cli', 'orchestration'], { homeDir: home })
    ).toEqual({
      'orca-cli': ['claude-code', 'codex', 'universal'],
      orchestration: ['universal']
    })
  })

  it('skips names Orca does not ship, so a requested name never reaches the filesystem', async () => {
    await mkdir(join(home, '.claude', 'skills', 'find-skills'), { recursive: true })

    expect(await findSkillRepointAgentKeys(['find-skills', '../x'], { homeDir: home })).toEqual({})
  })
})
