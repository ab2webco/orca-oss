import { describe, expect, it } from 'vitest'
import { teamPanelProjectOf } from './team-panel-project'

const state = {
  repos: [
    { id: 'repo-orca', displayName: 'orca', kind: 'git' as const },
    { id: 'repo-notes', displayName: 'notes', kind: 'folder' as const }
  ],
  worktreesByRepo: {
    'repo-orca': [{ id: 'repo-orca::/a' }, { id: 'repo-orca::/b' }],
    'repo-notes': [{ id: 'repo-notes::/notes' }]
  },
  projectGroups: [{ id: 'group-1', name: 'Docs' }],
  folderWorkspaces: [
    { id: 'ws-1', projectGroupId: 'group-1' },
    { id: 'ws-2', projectGroupId: 'group-2' }
  ]
}

describe('the Team panel project (ORCA-1135)', () => {
  it('scopes a folder workspace to its group, its folders and the folder kind', () => {
    expect(teamPanelProjectOf(state, 'folder-workspace:group-1')).toEqual({
      name: 'Docs',
      worktreeIds: ['folder:ws-1'],
      isFolder: true
    })
  })

  it('keeps a repo, git or folder, as before', () => {
    expect(teamPanelProjectOf(state, 'repo-orca')).toEqual({
      name: 'orca',
      worktreeIds: ['repo-orca::/a', 'repo-orca::/b'],
      isFolder: false
    })
    expect(teamPanelProjectOf(state, 'repo-notes')?.isFolder).toBe(true)
  })

  it('has none for a project it does not know', () => {
    expect(teamPanelProjectOf(state, 'folder-workspace:gone')).toBeNull()
    expect(teamPanelProjectOf(state, 'repo-gone')).toBeNull()
  })
})
