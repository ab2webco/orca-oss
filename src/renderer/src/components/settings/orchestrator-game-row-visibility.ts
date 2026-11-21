import {
  resolveOrchestratorGameConfig,
  type OrchestratorGameLayer,
  type OrchestratorGameSource
} from '../../../../shared/orchestrator-game-config'
import { resolveOrchestratorGamePanel } from '../../../../shared/orchestrator-game-panel-layers'
import type { GamePanelLook, GamePanelStyle } from '../../../../shared/orchestrator-game-panel'
import type { OrchestratorGameRender } from '../../../../shared/orchestrator-game-render'
import {
  isOrchestratorGamePixelView,
  orchestratorGameViewOf,
  type OrchestratorGameViewId
} from '../../../../shared/orchestrator-game-view'
import type { AdvisorPluginPresence } from './use-advisor-plugin-presence'
import type { GlobalSettings } from '../../../../shared/global-settings-types'

// Why one table: the page and Settings search must agree on which game rows exist (ORCA-1112).

export type GameRowGroup = 'panel' | 'terminal' | 'band'

/** What decides whether a row does anything, resolved from the layers the page edits. */
export type GameRowFacts = {
  page: 'global' | 'project'
  look: GamePanelLook
  style: GamePanelStyle
  diorama: boolean
  show: boolean
  view: OrchestratorGameViewId
  band: boolean
  render: OrchestratorGameRender
  advisorPlugin: boolean
}

const isPixelView = (f: GameRowFacts): boolean => f.show && isOrchestratorGamePixelView(f.view)
const modRuns = (f: GameRowFacts): boolean => f.show && f.view !== 'off'
const bandDraws = (f: GameRowFacts): boolean => isPixelView(f) && f.band
const isGameLook = (f: GameRowFacts): boolean => f.look === 'game'

/** Each row, in page order, with the condition under which its reader uses it. */
export const GAME_ROWS = [
  { id: 'look', group: 'panel', shows: () => true },
  { id: 'style', group: 'panel', shows: isGameLook },
  { id: 'stylePreview', group: 'panel', shows: isGameLook },
  {
    id: 'diorama',
    group: 'panel',
    shows: (f: GameRowFacts) => isGameLook(f) && f.style === 'figures' && f.diorama
  },
  // Why the band too: ORCA_GAME_SCENE is what a drawing band paints.
  { id: 'scene', group: 'panel', shows: (f: GameRowFacts) => isGameLook(f) || bandDraws(f) },
  { id: 'prs', group: 'panel', shows: () => true },
  { id: 'machines', group: 'panel', shows: () => true },
  {
    id: 'advisor',
    group: 'panel',
    shows: (f: GameRowFacts) => f.page === 'project' && f.advisorPlugin
  },
  {
    id: 'arcade',
    group: 'panel',
    shows: (f: GameRowFacts) => f.page === 'project' && isGameLook(f)
  },
  // Why: the panel scene's day and night, Display's day metrics and an hd band's night.
  {
    id: 'timezone',
    group: 'panel',
    shows: (f: GameRowFacts) => f.look !== 'plain' || (bandDraws(f) && f.render !== 'classic')
  },
  { id: 'show', group: 'terminal', shows: () => true },
  { id: 'view', group: 'terminal', shows: (f: GameRowFacts) => f.show },
  {
    id: 'hud',
    group: 'terminal',
    shows: (f: GameRowFacts) => modRuns(f) && (f.view === 'flat' || f.band)
  },
  { id: 'rewards', group: 'terminal', shows: modRuns },
  { id: 'openLinks', group: 'terminal', shows: modRuns },
  { id: 'tracker', group: 'terminal', shows: modRuns },
  { id: 'band', group: 'band', shows: isPixelView },
  { id: 'bandPreview', group: 'band', shows: bandDraws },
  { id: 'render', group: 'band', shows: bandDraws }
] as const satisfies readonly {
  id: string
  group: GameRowGroup
  shows: (facts: GameRowFacts) => boolean
}[]

export type GameRowId = (typeof GAME_ROWS)[number]['id']

export function shownGameRows(facts: GameRowFacts): ReadonlySet<GameRowId> {
  return new Set(GAME_ROWS.filter((row) => row.shows(facts)).map((row) => row.id))
}

/** Groups with at least one row shown, in page order; an empty one draws no heading. */
export function shownGameRowGroups(facts: GameRowFacts): ReadonlySet<GameRowGroup> {
  return new Set(GAME_ROWS.filter((row) => row.shows(facts)).map((row) => row.group))
}

export function gameRowFactsOf(args: {
  page: GameRowFacts['page']
  layers: Partial<Record<Exclude<OrchestratorGameSource, 'default'>, OrchestratorGameLayer>>
  advisorPlugin?: AdvisorPluginPresence
}): GameRowFacts {
  const { config } = resolveOrchestratorGameConfig(args.layers)
  const panel = resolveOrchestratorGamePanel(args.layers)
  return {
    page: args.page,
    look: panel.look,
    style: panel.style,
    diorama: panel.diorama,
    show: config.show,
    view: orchestratorGameViewOf(config),
    band: config.band,
    render: config.render,
    // Why only missing hides it: a host that cannot answer keeps the row.
    advisorPlugin: args.advisorPlugin !== 'missing'
  }
}

type GameSettings = Partial<Pick<GlobalSettings, 'orchestratorGame' | 'orchestratorGameProjects'>>

/** One project's facts for search; undefined (every row searchable) before settings load. */
export function projectGameRowFactsOf(
  settings: GameSettings | null | undefined,
  repoId: string,
  project?: OrchestratorGameLayer
): GameRowFacts | undefined {
  if (!settings) {
    return undefined
  }
  const layers = {
    global: settings.orchestratorGame,
    project,
    local: settings.orchestratorGameProjects?.[repoId]
  }
  return gameRowFactsOf({ page: 'project', layers })
}
