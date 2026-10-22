import type { GameMode, GameRender } from '../types'

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
    default:
      return { mode: id }
  }
}
