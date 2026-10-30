import type { GameMode, GameRender, GameState } from '../types'

// Mirrors Orca's src/shared/orchestrator-game-view.ts, which the mod cannot import.

export type GameViewId = 'off' | 'flat' | 'zen' | '2d-classic' | '2d-hd'

export type GameViewCost = 'light' | 'medium' | 'heavy'

export type GameView = { id: GameViewId; cost: GameViewCost }

export const GAME_VIEWS: readonly GameView[] = [
  { id: 'off', cost: 'light' },
  { id: 'flat', cost: 'light' },
  { id: 'zen', cost: 'medium' },
  { id: '2d-classic', cost: 'medium' },
  { id: '2d-hd', cost: 'heavy' }
]

type ViewLook = { mode: GameMode; render: GameRender }

export const isGameViewId = (value: unknown): value is GameViewId =>
  GAME_VIEWS.some((view) => view.id === value)

// Why filtered: a newer Orca may add scopes or views this mod cannot store or draw.
export const viewSwitchOf = (
  body: Record<string, unknown>
): Pick<GameState, 'viewScopes' | 'suggestedView'> => {
  const scopes = Array.isArray(body.viewScopes)
    ? body.viewScopes.filter(
        (one): one is 'project' | 'global' => one === 'project' || one === 'global'
      )
    : undefined
  return {
    ...(scopes === undefined ? {} : { viewScopes: scopes }),
    ...(isGameViewId(body.suggestedView) ? { suggestedView: body.suggestedView } : {})
  }
}

export function gameViewOf({ mode, render }: ViewLook): GameViewId {
  if (mode !== 'on') {
    return mode
  }
  return render === 'classic' ? '2d-classic' : '2d-hd'
}

export function gameViewPatchOf(id: GameViewId, now: ViewLook): Partial<ViewLook> {
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
