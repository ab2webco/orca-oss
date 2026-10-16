import type { SceneDefinition } from '../hooks/scenes/scene-definition'

export type GameMode = 'on' | 'zen' | 'off'

export type GameConfig = { mode: GameMode; scene: string; hud: boolean; rewards: boolean }

export type GameAgentState = 'working' | 'waiting' | 'idle' | 'done'

export type GameAgent = {
  paneKey: string
  displayName: string
  agentType: string
  state: GameAgentState
  toolName: string | null
  isLeader: boolean
  /** Only a pane Orca maps to a live terminal has one; older hosts send none. */
  terminalHandle?: string
}

export type GameCi = 'pending' | 'success' | 'failure' | 'neutral' | 'none'

export type GameReview = {
  provider: 'github' | 'gitlab' | 'bitbucket' | 'azure-devops' | 'gitea'
  number: number
  title: string
  url: string
  state: 'open' | 'draft' | 'merged' | 'closed'
  ci: GameCi
}

export type GameStatusGroup =
  | 'backlog'
  | 'todo'
  | 'in_progress'
  | 'review'
  | 'done'
  | 'cancelled'
  | 'unknown'

export type GameWorkItem = {
  provider: 'plane' | 'jira' | 'linear' | 'github' | 'gitlab'
  identifier: string
  title: string
  url: string
  status: string
  statusGroup: GameStatusGroup
}

export type GameWorktree = { id: string; path: string; branch: string; displayName: string }

export type GameSceneExtension = { id: string; pluginId: string; definition: SceneDefinition }

export type GameState = {
  config: Partial<GameConfig>
  warnings: string[]
  worktree: GameWorktree | null
  agents: GameAgent[]
  review: GameReview | null
  workItem: GameWorkItem | null
  extensions: { scenes: GameSceneExtension[] }
}

export type FleetState = {
  isLoading: boolean
  refreshedAt: number
  state: GameState | null
  note: string
  xp: number
}

/** A line another plugin set with `$.ui.status`, held for the allies strip while the game draws. */
export type AllyStatus = { plugin: string; text: string }

export type AlliesState = { statuses: AllyStatus[] }

declare module 'claude-code' {
  // oxlint-disable-next-line typescript/consistent-type-definitions -- only an interface merges into the engine's
  interface PluginState {
    'orca-game': { fleet: FleetState; allies: AlliesState }
    // Read, never depended on: hooks/allies.ts checks the shape at runtime.
    'orca-jev-mod-skills': { advisor: unknown }
  }
}
