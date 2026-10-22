import type { OrchestratorGameMode } from './orchestrator-game-config'
import type { OrchestratorGameRender } from './orchestrator-game-render'

// Why stored as mode and render: old orca.yaml files and old mods keep reading the same keys.

export type OrchestratorGameViewId = 'off' | 'flat' | 'zen' | '2d-classic' | '2d-hd'

export type OrchestratorGameViewCost = 'light' | 'medium' | 'heavy'

export type OrchestratorGameView = { id: OrchestratorGameViewId; cost: OrchestratorGameViewCost }

/** Every view this build draws, in menu order; the 3D views join with ORCA-683. Mirrored by the mod's game-view.ts. */
export const ORCHESTRATOR_GAME_VIEWS: readonly OrchestratorGameView[] = [
  { id: 'off', cost: 'light' },
  { id: 'flat', cost: 'light' },
  { id: 'zen', cost: 'medium' },
  { id: '2d-classic', cost: 'medium' },
  { id: '2d-hd', cost: 'heavy' }
]

/** Where a view is stored beyond the pane: this repo on this machine, or every project. */
export type OrchestratorGameViewScope = 'project' | 'global'

export const ORCHESTRATOR_GAME_VIEW_SCOPES: readonly OrchestratorGameViewScope[] = [
  'project',
  'global'
]

type ViewLook = { mode: OrchestratorGameMode; render: OrchestratorGameRender }

export const isOrchestratorGameViewId = (value: unknown): value is OrchestratorGameViewId =>
  ORCHESTRATOR_GAME_VIEWS.some((view) => view.id === value)

export function orchestratorGameViewOf({ mode, render }: ViewLook): OrchestratorGameViewId {
  if (mode !== 'on') {
    return mode
  }
  return render === 'classic' ? '2d-classic' : '2d-hd'
}

/** The mode and render keys that store a view; 2D hd keeps hd-compact when that is the look now. */
export function orchestratorGameViewPatchOf(
  id: OrchestratorGameViewId,
  now: ViewLook
): Partial<ViewLook> {
  switch (id) {
    case '2d-classic':
      return { mode: 'on', render: 'classic' }
    case '2d-hd':
      return { mode: 'on', render: now.render === 'hd-compact' ? 'hd-compact' : 'hd' }
    case 'off':
    case 'flat':
    case 'zen':
      return { mode: id }
  }
}

const GIB = 1024 ** 3

/** The one rule behind the suggested view; ORCA-706 can swap the signal without touching callers. */
export function suggestedOrchestratorGameView(memory: {
  totalMemory: number
  availableMemory: number
}): OrchestratorGameViewId {
  if (memory.totalMemory <= 8 * GIB || memory.availableMemory < 2 * GIB) {
    return 'flat'
  }
  return memory.totalMemory <= 16 * GIB ? '2d-classic' : '2d-hd'
}

/** The mode a pane is launched and fed with: Show the game off hides it and keeps the chosen mode. */
export const shownOrchestratorGameModeOf = (config: {
  mode: OrchestratorGameMode
  show: boolean
}): OrchestratorGameMode => (config.show ? config.mode : 'off')
