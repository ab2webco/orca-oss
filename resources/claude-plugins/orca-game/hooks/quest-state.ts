import type { GameConfig, GameRender, GameSources } from '../types'
import { advisorSpriteOf } from './advisor-art'
import { advisorPoseAt, isAdvisorActingAt } from './advisor-state'
import { demoFrameOf, type DemoFrame } from './demo'
import { DEFAULT_GAME_CONFIG, effectiveConfigOf, isAbsorbingConfig } from './game-config'
import { daylightAt, hourOf, NOON, type Daylight } from './hd-daylight'
import type { TeamEvent } from './hd-overlay'
import type { HdMember, March } from './hd-party'
import type { Action, FlowPhase } from './quest-policy'
import { isReacting, type Reaction } from './scene'
import { sceneOf, type SceneDefinition, type ScenePhase } from './scenes/index'

export type Animated = {
  key: string
  columns: number
  rows: number
  draw: (tick: number) => string
}

/** A spinner scene on screen: the size and render its Raster was drawn with. */
export type Stage = { columns: number; rows: number; render: GameRender }

type QuestRuntime = {
  envConfig: GameConfig
  liveConfig: Partial<GameConfig>
  liveSources: GameSources
  modeOverride: GameConfig['mode'] | undefined
  renderOverride: GameRender | undefined
  tick: number
  phase: FlowPhase | undefined
  fleetPhase: FlowPhase | undefined
  alert: string
  isDone: boolean
  action: Action | undefined
  isDemo: boolean
  demoStep: number
  demoAt: number
  caption: string
  captionAt: number
  reaction: { kind: Reaction['kind']; at: number } | undefined
  notes: Set<string>
  replies: Set<string>
  stages: Map<string, Stage>
  animations: Map<string, readonly Animated[]>
  cardPhases: Map<string, ScenePhase>
  /** The time hd's day and night read, sampled from `$.clock`; 0 until the first sample. */
  clockMs: number
  hdParty: readonly HdMember[]
  isHdPartySeen: boolean
  leavers: readonly HdMember[]
  marches: ReadonlyMap<string, March>
  lead: string | undefined
  event: { kind: TeamEvent['kind']; text: string; at: number } | undefined
}

// Module state: a hot reload starts it over, which only costs the scene its current pose.
export const quest: QuestRuntime = {
  envConfig: DEFAULT_GAME_CONFIG,
  liveConfig: {},
  liveSources: {},
  modeOverride: undefined,
  renderOverride: undefined,
  tick: 0,
  phase: undefined,
  fleetPhase: undefined,
  alert: '',
  isDone: false,
  action: undefined,
  isDemo: false,
  demoStep: 0,
  demoAt: 0,
  caption: '',
  captionAt: 0,
  reaction: undefined,
  notes: new Set<string>(),
  replies: new Set<string>(),
  stages: new Map<string, Stage>(),
  animations: new Map<string, readonly Animated[]>(),
  cardPhases: new Map<string, ScenePhase>(),
  clockMs: 0,
  hdParty: [],
  isHdPartySeen: false,
  leavers: [],
  marches: new Map<string, March>(),
  lead: undefined,
  event: undefined
}

export const gameConfig = (): GameConfig =>
  effectiveConfigOf(quest.envConfig, quest.liveConfig, quest.modeOverride, quest.renderOverride)

/** The config without this session's /quest overrides: what Orca's layers and the launch env say. */
export const configuredConfig = (): GameConfig =>
  effectiveConfigOf(quest.envConfig, quest.liveConfig, undefined)

export const currentScene = (): SceneDefinition => sceneOf(gameConfig().scene)

export const demoNow = (): DemoFrame => demoFrameOf(quest.demoStep)

export const shownPhase = (): FlowPhase | undefined =>
  quest.isDemo ? demoNow().phase : (quest.phase ?? quest.fleetPhase)

export const shownCaption = (): string => {
  if (quest.isDemo) {
    return demoNow().caption
  }
  return quest.caption === '' ? quest.alert : quest.caption
}

export const shownResting = (): boolean => (quest.isDemo ? demoNow().isResting : quest.isDone)

export const shownAction = (): Action | undefined =>
  quest.isDemo ? demoNow().action : quest.action

export const reactionAt = (tick: number): Reaction | undefined =>
  quest.reaction === undefined
    ? undefined
    : { kind: quest.reaction.kind, age: tick - quest.reaction.at }

export const isSceneShown = (): boolean => quest.stages.size > 0

export const isClawdReacting = (): boolean => isReacting(reactionAt(quest.tick))

/** Jev's advisor acts something out now, so the band shows the scene when no spinner does. */
export const isAdvisorActing = (): boolean =>
  isAbsorbingConfig(gameConfig()) && isAdvisorActingAt(quest.tick, gameConfig().mode === 'zen')

/** hd's light now, on the project's timezone; noon until the clock is first read. */
export const daylightNow = (): Daylight =>
  quest.clockMs === 0 ? NOON : daylightAt(hourOf(quest.clockMs, gameConfig().timezone))

export const teamEventAt = (tick: number): TeamEvent | undefined =>
  quest.event === undefined
    ? undefined
    : { kind: quest.event.kind, text: quest.event.text, age: tick - quest.event.at }

/** The caption is the alert of a teammate waiting on the person. */
export const isAlertShown = (): boolean =>
  !quest.isDemo && quest.caption === '' && quest.alert !== ''

// Why absorbing: while the game is not drawing Jev's lines, Jev draws its own and the scene has no advisor.
export const advisorShownAt = (tick: number) =>
  isAbsorbingConfig(gameConfig())
    ? advisorPoseAt(tick, advisorSpriteOf(currentScene()), gameConfig().mode === 'zen')
    : undefined
