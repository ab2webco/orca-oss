import type { WorktreeCardProperty } from '../../../../shared/ui-chrome-types'
import { TASK_WORKTREE_CARD_PROPERTIES } from '../../../../shared/constants'
import { translate } from '@/i18n/i18n'
import { AGENT_ROW_PROPERTY_OPTIONS } from './worktree-card-agent-row-property-options'

export type WorktreeCardPropertyGroup = 'work' | 'agent' | 'source'

export type WorktreeCardPropertyOption = {
  id: string
  properties: readonly WorktreeCardProperty[]
  label: string
  /** The Card display section it sits in; only the new card style groups its toggles. */
  group?: WorktreeCardPropertyGroup
}

// Why this order: ORCA-1163 puts the work an agent operator acts on first, then the agent, then the source.
const NEW_CARD_STYLE_GROUPS: readonly (readonly [WorktreeCardPropertyGroup, readonly string[]])[] =
  [
    ['work', ['issue', 'linear-issue', 'jira-issue', 'plane-issue', 'pr', 'comment']],
    ['agent', ['inline-agents', 'account', 'model']],
    ['source', ['branch', 'ports', 'automation', 'cli']]
  ]

const PR_WORKTREE_CARD_PROPERTY_OPTION: WorktreeCardPropertyOption = {
  id: 'pr',
  // Why ci rides along: the PR icon is already tinted by its checks, and nothing draws ci alone.
  properties: ['pr'],
  get label() {
    return translate(
      'auto.components.sidebar.SidebarWorkspaceOptionsMenu.prAndChecks',
      'Pull request and checks'
    )
  }
}

const BASE_WORKTREE_CARD_PROPERTY_OPTIONS: WorktreeCardPropertyOption[] = [
  {
    id: 'status',
    properties: ['status'],
    get label() {
      return translate('auto.components.sidebar.SidebarWorkspaceOptionsMenu.1a0eec0d35', 'Status')
    }
  },
  {
    id: 'comment',
    properties: ['comment'],
    get label() {
      return translate('auto.components.sidebar.SidebarWorkspaceOptionsMenu.8d62c68b35', 'Notes')
    }
  },
  {
    id: 'automation',
    properties: ['automation'],
    get label() {
      return translate(
        'auto.components.sidebar.SidebarWorkspaceOptionsMenu.automation',
        'Automation'
      )
    }
  },
  {
    id: 'cli',
    properties: ['cli'],
    get label() {
      return translate('auto.components.sidebar.SidebarWorkspaceOptionsMenu.cli', 'Orca Lab CLI')
    }
  },
  {
    id: 'ports',
    properties: ['ports'],
    get label() {
      return translate('auto.components.sidebar.SidebarWorkspaceOptionsMenu.2d74665a56', 'Ports')
    }
  },
  {
    id: 'inline-agents',
    properties: ['inline-agents'],
    get label() {
      return translate(
        'auto.components.sidebar.SidebarWorkspaceOptionsMenu.65a9820bd1',
        'Agent statuses'
      )
    }
  },
  ...AGENT_ROW_PROPERTY_OPTIONS,
  {
    id: 'branch',
    properties: ['branch'],
    get label() {
      return translate(
        'auto.components.sidebar.SidebarWorkspaceOptionsMenu.219ebf1961',
        'Branch name'
      )
    }
  }
]

const TASK_WORKTREE_CARD_PROPERTY_OPTION: WorktreeCardPropertyOption = {
  id: 'tasks',
  properties: TASK_WORKTREE_CARD_PROPERTIES,
  get label() {
    return translate('auto.components.sidebar.SidebarWorkspaceOptionsMenu.b5536d5a88', 'Tasks')
  }
}

const ISSUE_WORKTREE_CARD_PROPERTY_OPTIONS: WorktreeCardPropertyOption[] = [
  {
    id: 'issue',
    properties: ['issue'],
    get label() {
      return translate(
        'auto.components.sidebar.SidebarWorkspaceOptionsMenu.bdd23b4e07',
        'GitHub issues'
      )
    }
  },
  {
    id: 'linear-issue',
    properties: ['linear-issue'],
    get label() {
      return translate(
        'auto.components.sidebar.SidebarWorkspaceOptionsMenu.44713a5d04',
        'Linear issues'
      )
    }
  },
  {
    id: 'jira-issue',
    properties: ['jira-issue'],
    get label() {
      return translate(
        'auto.components.sidebar.SidebarWorkspaceOptionsMenu.jiraIssues',
        'Jira issues'
      )
    }
  },
  {
    id: 'plane-issue',
    properties: ['plane-issue'],
    get label() {
      return translate(
        'auto.components.sidebar.SidebarWorkspaceOptionsMenu.planeWorkItems',
        'Plane work items'
      )
    }
  }
]

type WorktreeCardPropertyOptionsInput = {
  newCardStyle?: boolean
  hasProjectGroups?: boolean
}

export function getWorktreeCardPropertyOptions({
  newCardStyle = false,
  hasProjectGroups = false
}: WorktreeCardPropertyOptionsInput = {}): WorktreeCardPropertyOption[] {
  const issueOptions = newCardStyle
    ? ISSUE_WORKTREE_CARD_PROPERTY_OPTIONS
    : [TASK_WORKTREE_CARD_PROPERTY_OPTION]
  const branchOption: WorktreeCardPropertyOption = {
    id: 'branch',
    properties: ['branch'],
    get label() {
      // Why: new-card project groups can contain folder workspaces, so the
      // branch setting copy must describe both repo and folder identity.
      return newCardStyle && hasProjectGroups
        ? translate(
            'auto.components.sidebar.SidebarWorkspaceOptionsMenu.folderPathIdentity',
            'Branch / folder path'
          )
        : translate('auto.components.sidebar.SidebarWorkspaceOptionsMenu.219ebf1961', 'Branch name')
    }
  }
  if (newCardStyle) {
    const byId = new Map(
      [
        ...issueOptions,
        PR_WORKTREE_CARD_PROPERTY_OPTION,
        ...BASE_WORKTREE_CARD_PROPERTY_OPTIONS.slice(1, -1),
        branchOption
      ].map((option) => [option.id, option])
    )
    return NEW_CARD_STYLE_GROUPS.flatMap(([group, ids]) =>
      ids.flatMap((id) => {
        const option = byId.get(id)
        if (!option) {
          return []
        }
        const grouped: WorktreeCardPropertyOption = {
          id: option.id,
          properties: option.properties,
          group,
          get label() {
            return option.label
          }
        }
        return [grouped]
      })
    )
  }
  return [
    BASE_WORKTREE_CARD_PROPERTY_OPTIONS[0],
    ...issueOptions,
    ...BASE_WORKTREE_CARD_PROPERTY_OPTIONS.slice(1, -1),
    branchOption
  ]
}

export const WORKTREE_CARD_PROPERTY_OPTIONS = getWorktreeCardPropertyOptions()
