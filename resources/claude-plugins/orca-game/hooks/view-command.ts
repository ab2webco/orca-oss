import { GAME_VIEWS, isGameViewId, type GameViewId } from './game-view'
import { viewWords, type ViewScope } from './view-words'

export type ViewCommand =
  | { list: true }
  | { view: GameViewId; scope: ViewScope }
  | { error: string }

const isViewScope = (value: string): value is ViewScope =>
  value === 'pane' || value === 'project' || value === 'global'

/** `/orca-game:view [<view> [pane|project|global]]`; with no scope it changes this pane only. */
export const viewCommandOf = (args: string): ViewCommand => {
  const [asked = '', scope = 'pane'] = args.trim().toLowerCase().split(/\s+/)
  if (asked === '') {
    return { list: true }
  }
  if (!isGameViewId(asked)) {
    return { error: viewWords().unknownView(asked) }
  }
  return isViewScope(scope) ? { view: asked, scope } : { error: viewWords().unknownScope(scope) }
}

/** Every view with its cost, the one shown now and the one this machine suggests. */
export const viewListOf = (
  now: GameViewId,
  suggested: GameViewId | undefined,
  scopes: readonly ViewScope[]
): string => {
  const words = viewWords()
  const width = Math.max(...GAME_VIEWS.map((view) => words.names[view.id].length)) + 2
  const costWidth = Math.max(...GAME_VIEWS.map((view) => words.costs[view.cost].length)) + 2
  const lines = GAME_VIEWS.map((view) => {
    const mark = view.id === now ? '●' : '○'
    const cost = words.costs[view.cost]
    const line = `  ${mark} ${words.names[view.id].padEnd(width)}${cost}`
    return view.id === suggested ? `${line.padEnd(line.length - cost.length + costWidth)}★` : line
  })
  return [words.listTitle, ...lines, words.help(scopes)].join('\n')
}
