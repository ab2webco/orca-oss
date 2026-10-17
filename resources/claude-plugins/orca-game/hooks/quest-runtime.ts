import type { EngineInterface } from 'claude-code'

import type { GameConfig } from '../types'
import { DEMO_STEP_TICKS, demoFrameOf, type DemoFrame } from './demo'
import {
  DEFAULT_GAME_CONFIG,
  effectiveConfigOf,
  gameConfigOfEnv,
  isAbsorbingConfig
} from './game-config'
import { gameLocaleOf, gameStrings, setGameLocale } from './game-strings'
import {
  actionOf,
  activityOf,
  isFinishingCall,
  phaseOf,
  restoredNotesOf,
  type Action,
  type FlowPhase,
  type StoredRow
} from './quest-policy'
import {
  REACTION_TICKS,
  SCENE_KEY,
  SCENE_ROWS,
  SCENE_TICK_MS,
  isReacting,
  sceneCellsOf,
  type Reaction
} from './scene'
import { sceneOf, type SceneDefinition, type ScenePhase } from './scenes/index'

export type Animated = {
  key: string
  columns: number
  rows: number
  draw: (tick: number) => string
}

type QuestRuntime = {
  envConfig: GameConfig
  liveConfig: Partial<GameConfig>
  modeOverride: GameConfig['mode'] | undefined
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
  stages: Map<string, { columns: number; rows: number }>
  animations: Map<string, readonly Animated[]>
  cardPhases: Map<string, ScenePhase>
}

// Module state: a hot reload starts it over, which only costs the scene its current pose.
export const quest: QuestRuntime = {
  envConfig: DEFAULT_GAME_CONFIG,
  liveConfig: {},
  modeOverride: undefined,
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
  stages: new Map<string, { columns: number; rows: number }>(),
  animations: new Map<string, readonly Animated[]>(),
  cardPhases: new Map<string, ScenePhase>()
}

let loading: Promise<void> | undefined
let publishedAbsorbing: boolean | undefined
let ticker: { cancel(): void } | undefined

export const gameConfig = (): GameConfig =>
  effectiveConfigOf(quest.envConfig, quest.liveConfig, quest.modeOverride)

const ABSORBING = { plugin: 'orca-game', key: 'absorbing' } as const

// Why: Jev reads the env once; this follows /quest and Orca's live config so it never draws twice or not at all.
export async function publishAbsorbing($: EngineInterface): Promise<void> {
  const absorbing = isAbsorbingConfig(gameConfig())
  if (absorbing === publishedAbsorbing) {
    return
  }
  publishedAbsorbing = absorbing
  await $.state.set(ABSORBING, absorbing).catch(() => {
    publishedAbsorbing = undefined
  })
}

export const currentScene = (): SceneDefinition => sceneOf(gameConfig().scene)

export const demoNow = (): DemoFrame => demoFrameOf(quest.demoStep)

export const shownPhase = (): FlowPhase | undefined =>
  quest.isDemo ? demoNow().phase : (quest.phase ?? quest.fleetPhase)

const shownCaption = (): string => {
  if (quest.isDemo) {
    return demoNow().caption
  }
  return quest.caption === '' ? quest.alert : quest.caption
}

const shownResting = (): boolean => (quest.isDemo ? demoNow().isResting : quest.isDone)

const shownAction = (): Action | undefined => (quest.isDemo ? demoNow().action : quest.action)

const reactionNow = (): Reaction | undefined =>
  quest.reaction === undefined
    ? undefined
    : { kind: quest.reaction.kind, age: quest.tick - quest.reaction.at }

export const isSceneShown = (): boolean => quest.stages.size > 0

export const isClawdReacting = (): boolean => isReacting(reactionNow())

export function clawdReact($: EngineInterface, kind: Reaction['kind']): void {
  quest.reaction = { kind, at: quest.tick }
  if (kind !== 'hello') {
    $.ui.invalidate('ui.render')
  }
}

export const spinnerCellsOf = (columns: number) =>
  sceneCellsOf(
    currentScene(),
    shownPhase(),
    columns,
    quest.tick,
    shownCaption(),
    quest.isDemo ? quest.demoAt : quest.captionAt,
    reactionNow(),
    shownResting(),
    shownAction()
  )

export const petScene = (key: string, columns: number): Animated => ({
  key,
  columns,
  rows: SCENE_ROWS,
  draw: (at) => {
    const reaction = quest.reaction
    const age = reaction === undefined ? undefined : { kind: reaction.kind, age: at - reaction.at }
    const scene = currentScene()
    return sceneCellsOf(
      scene,
      shownPhase(),
      columns,
      at,
      '',
      -Infinity,
      age,
      shownResting(),
      shownAction()
    ).cells
  }
})

export function questFleet(
  $: EngineInterface,
  aggregate: FlowPhase | undefined,
  waiting: string
): void {
  const alert = waiting === '' ? '' : gameStrings().art.alert(waiting)
  if (aggregate === quest.fleetPhase && alert === quest.alert) {
    return
  }
  quest.fleetPhase = aggregate
  quest.alert = alert
  $.ui.invalidate('ui.render')
}

export function questLiveConfig($: EngineInterface, live: Partial<GameConfig>): void {
  if (JSON.stringify(live) === JSON.stringify(quest.liveConfig)) {
    return
  }
  quest.liveConfig = live
  $.ui.invalidate('ui.render')
  void publishAbsorbing($)
}

async function blitAll($: EngineInterface): Promise<void> {
  for (const [requestId, stage] of quest.stages) {
    const { cells } = spinnerCellsOf(stage.columns)
    const result = await $.ui
      .blit({ requestId, key: SCENE_KEY, cells, columns: stage.columns, rows: stage.rows })
      .catch(() => ({ deny: 'failed' }))
    if (result.deny !== undefined && quest.stages.get(requestId) === stage) {
      quest.stages.delete(requestId)
    }
  }
  for (const [requestId, items] of quest.animations) {
    for (const item of items) {
      const cells = item.draw(quest.tick)
      const result = await $.ui
        .blit({ requestId, key: item.key, cells, columns: item.columns, rows: item.rows })
        .catch(() => ({ deny: 'failed' }))
      if (result.deny !== undefined && quest.animations.get(requestId) === items) {
        quest.animations.delete(requestId)
        break
      }
    }
  }
}

async function repaint($: EngineInterface): Promise<void> {
  if (quest.reaction !== undefined && quest.tick - quest.reaction.at === REACTION_TICKS) {
    $.ui.invalidate('ui.render')
  }
  quest.tick += 1
  if (quest.isDemo && quest.tick - quest.demoAt >= DEMO_STEP_TICKS) {
    quest.demoAt = quest.tick
    quest.demoStep += 1
    if (demoNow().isLevelUp && gameConfig().rewards) {
      quest.reaction = { kind: 'level', at: quest.tick }
    }
    $.ui.invalidate('ui.render')
  }
  if (gameConfig().mode !== 'off') {
    await blitAll($)
  }
}

async function load($: EngineInterface): Promise<void> {
  // The engine lists what a mod reads only from literal names.
  const [mode, scene, hud, rewards, locale] = await Promise.all([
    $.env.get('ORCA_GAME_MODE').catch(() => undefined),
    $.env.get('ORCA_GAME_SCENE').catch(() => undefined),
    $.env.get('ORCA_GAME_HUD').catch(() => undefined),
    $.env.get('ORCA_GAME_REWARDS').catch(() => undefined),
    $.env.get('ORCA_GAME_LOCALE').catch(() => undefined)
  ])
  setGameLocale(gameLocaleOf(locale))
  quest.envConfig = gameConfigOfEnv({
    ORCA_GAME_MODE: mode,
    ORCA_GAME_SCENE: scene,
    ORCA_GAME_HUD: hud,
    ORCA_GAME_REWARDS: rewards
  })
  await publishAbsorbing($)
  const rows = (await $.session.messages().catch(() => [])) as readonly StoredRow[]
  const restored = restoredNotesOf(rows)
  for (const key of restored.notes) {
    quest.notes.add(key)
  }
  for (const key of restored.replies) {
    quest.replies.add(key)
  }
  ticker ??= $.clock.every(SCENE_TICK_MS, () => void repaint($).catch(() => undefined))
  $.ui.invalidate('ui.render')
}

export function ready($: EngineInterface): Promise<void> {
  loading ??= load($).catch(() => undefined)
  return loading
}

export function startDemo(): void {
  quest.isDemo = true
  quest.demoStep = 0
  quest.demoAt = quest.tick
  if (gameConfig().mode === 'off') {
    quest.modeOverride = 'on'
  }
}

export function resetQuest(): void {
  loading = undefined
  publishedAbsorbing = undefined
  for (const store of [quest.notes, quest.replies]) {
    store.clear()
  }
  quest.stages.clear()
  quest.animations.clear()
  quest.cardPhases.clear()
  Object.assign(quest, {
    phase: undefined,
    fleetPhase: undefined,
    alert: '',
    isDone: false,
    action: undefined,
    isDemo: false,
    caption: ''
  })
}

export function questToolCall(tool: string, input: unknown, agentId: string | undefined): void {
  if (agentId !== undefined) {
    return
  }
  quest.phase = phaseOf(tool, input) ?? quest.phase
  if (isFinishingCall(tool, input)) {
    quest.isDone = true
  }
  quest.action = actionOf(tool, input) ?? quest.action
  const said = activityOf(tool, input)
  if (said !== quest.caption) {
    quest.captionAt = quest.tick
  }
  quest.caption = said
}

export function questTurnComplete(agentId: string | undefined): void {
  if (agentId !== undefined) {
    return
  }
  quest.caption = ''
  quest.action = undefined
}
