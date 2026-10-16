import { describe, expect, it } from 'vitest'
import {
  orchestratorGameSceneFileCandidates,
  orchestratorGameSceneFileId,
  orchestratorGameSceneFileOfId,
  orchestratorGameSceneFileWithin,
  parseOrchestratorGameSceneFile
} from './orchestrator-game-scene-file'

describe('parseOrchestratorGameSceneFile', () => {
  it.each([
    ['.orca/scenes/mario.json', '.orca/scenes/mario.json'],
    ['  ./scenes//space.json ', 'scenes/space.json'],
    ['scenes\\windows.json', 'scenes/windows.json'],
    ['my scenes/día.json', 'my scenes/día.json']
  ])('keeps %j as the worktree path %j', (value, path) => {
    expect(parseOrchestratorGameSceneFile(value)).toEqual({ ok: true, path })
  })

  it.each([
    ['/etc/scene.json', 'absolute'],
    ['C:\\scenes\\a.json', 'absolute'],
    ['c:/scenes/a.json', 'absolute'],
    ['\\\\server\\share\\a.json', 'absolute'],
    ['../other/a.json', 'outside'],
    ['scenes/../../a.json', 'outside'],
    ['scenes/..', 'outside'],
    ['', 'not-a-path'],
    ['   ', 'not-a-path'],
    ['./', 'not-a-path'],
    [7, 'not-a-path'],
    ['scenes/\u001b.json', 'not-a-path'],
    [`${'a'.repeat(513)}`, 'not-a-path']
  ])('rejects %j as %s', (value, error) => {
    expect(parseOrchestratorGameSceneFile(value)).toEqual({ ok: false, error })
  })
})

describe('orchestratorGameSceneFileId', () => {
  it('round-trips a worktree path through the scene id the mod draws it under', () => {
    const id = orchestratorGameSceneFileId('.orca/scenes/mario.json')
    expect(id).toBe('file:.orca/scenes/mario.json')
    expect(orchestratorGameSceneFileOfId(id)).toBe('.orca/scenes/mario.json')
    expect(orchestratorGameSceneFileOfId('quest')).toBeNull()
    expect(orchestratorGameSceneFileOfId('acme.space/orbit')).toBeNull()
  })
})

describe('orchestratorGameSceneFileWithin', () => {
  it('turns a picked file inside the worktree into its worktree path', () => {
    expect(orchestratorGameSceneFileWithin('/repo', '/repo/.orca/scenes/a.json')).toBe(
      '.orca/scenes/a.json'
    )
    expect(orchestratorGameSceneFileWithin('/repo/', '/repo/a.json')).toBe('a.json')
    expect(orchestratorGameSceneFileWithin('C:\\Repo', 'c:\\repo\\scenes\\a.json')).toBe(
      'scenes/a.json'
    )
  })

  it('refuses a file outside the worktree, including a sibling sharing its prefix', () => {
    expect(orchestratorGameSceneFileWithin('/repo', '/repo-other/a.json')).toBeNull()
    expect(orchestratorGameSceneFileWithin('/repo', '/elsewhere/a.json')).toBeNull()
    expect(orchestratorGameSceneFileWithin('/repo', '/repo')).toBeNull()
    expect(orchestratorGameSceneFileWithin('/Repo', '/repo/a.json')).toBeNull()
  })
})

describe('orchestratorGameSceneFileCandidates', () => {
  it('names the copy after the scene, then numbers it, so an existing file is never reused', () => {
    expect(orchestratorGameSceneFileCandidates('quest').slice(0, 3)).toEqual([
      '.orca/scenes/quest.json',
      '.orca/scenes/quest-2.json',
      '.orca/scenes/quest-3.json'
    ])
  })
})
