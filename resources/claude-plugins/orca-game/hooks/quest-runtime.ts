import type { EngineInterface } from 'claude-code'

import type { GameConfig } from '../types'
import { isAdvisorCueEndingAt } from './advisor-state'
import { DEMO_STEP_TICKS } from './demo'
import { gameConfigOfEnv, isAbsorbingConfig } from './game-config'
import { forgetFrames, isNewFrame } from './frame-gate'
import { gameLocaleOf, gameStrings, setGameLocale } from './game-strings'
import { raiseTeamEvent } from './hd-team'
import { restoredNotesOf, type FlowPhase, type StoredRow } from './quest-policy'
import { demoNow, gameConfig, quest } from './quest-state'
import { REACTION_TICKS, SCENE_KEY, SCENE_TICK_MS, type Reaction } from './scene'
import { stageCellsOf } from './scene-frame'

export {
  currentScene,
  demoNow,
  gameConfig,
  isAdvisorActing,
  isClawdReacting,
  isSceneShown,
  quest,
  shownPhase,
  type Animated,
  type Stage
} from './quest-state'
export { petScene, stageCellsOf, stageOf } from './scene-frame'

// Why: hd's day and night move by minutes, so the clock is read about every 30 seconds, not every tick.
const CLOCK_EVERY_TICKS = 250

let loading: Promise<void> | undefined
let publishedAbsorbing: boolean | undefined
let ticker: { cancel(): void } | undefined

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

export function clawdReact($: EngineInterface, kind: Reaction['kind']): void {
  quest.reaction = { kind, at: quest.tick }
  if (kind !== 'hello') {
    $.ui.invalidate('ui.render')
  }
}

export function questFleet(
  $: EngineInterface,
  aggregate: FlowPhase | undefined,
  waiting: string
): void {
  const alert = waiting === '' ? '' : gameStrings().art.alert(waiting)
  if (aggregate === quest.fleetPhase && alert === quest.alert) {
    return
  }
  if (alert !== '' && alert !== quest.alert) {
    raiseTeamEvent($, 'needs', alert)
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
    const cells = stageCellsOf(stage)
    if (!isNewFrame(requestId, SCENE_KEY, cells)) {
      continue
    }
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
      if (!isNewFrame(requestId, item.key, cells)) {
        continue
      }
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
  const isReactionOver =
    quest.reaction !== undefined && quest.tick - quest.reaction.at === REACTION_TICKS
  if (isReactionOver || isAdvisorCueEndingAt(quest.tick)) {
    $.ui.invalidate('ui.render')
  }
  quest.tick += 1
  if (quest.tick % CLOCK_EVERY_TICKS === 0) {
    quest.clockMs = await $.clock.now().catch(() => quest.clockMs)
  }
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
  const [mode, scene, hud, rewards, render, timezone, locale] = await Promise.all([
    $.env.get('ORCA_GAME_MODE').catch(() => undefined),
    $.env.get('ORCA_GAME_SCENE').catch(() => undefined),
    $.env.get('ORCA_GAME_HUD').catch(() => undefined),
    $.env.get('ORCA_GAME_REWARDS').catch(() => undefined),
    $.env.get('ORCA_GAME_RENDER').catch(() => undefined),
    $.env.get('ORCA_GAME_TIMEZONE').catch(() => undefined),
    $.env.get('ORCA_GAME_LOCALE').catch(() => undefined)
  ])
  setGameLocale(gameLocaleOf(locale))
  quest.envConfig = gameConfigOfEnv({
    ORCA_GAME_MODE: mode,
    ORCA_GAME_SCENE: scene,
    ORCA_GAME_HUD: hud,
    ORCA_GAME_REWARDS: rewards,
    ORCA_GAME_RENDER: render,
    ORCA_GAME_TIMEZONE: timezone
  })
  await publishAbsorbing($)
  quest.clockMs = await $.clock.now().catch(() => 0)
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
  forgetFrames()
  Object.assign(quest, {
    phase: undefined,
    fleetPhase: undefined,
    alert: '',
    isDone: false,
    action: undefined,
    isDemo: false,
    caption: '',
    hdParty: [],
    isHdPartySeen: false,
    leavers: [],
    marches: new Map(),
    lead: undefined,
    event: undefined
  })
}
