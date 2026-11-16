import type { OrchestratorGameSceneExtension } from '../../../src/shared/orchestrator-game-scene'
import type {
  TeamSceneActivity,
  TeamSceneAgentInput,
  TeamSceneInput,
  TeamSceneMemberInput
} from '../../../src/shared/team-scene/team-scene-types'
import type { TeamSceneStatusColors } from '../../../src/renderer/src/components/team-scene/team-scene-painter-marks'

/** The id of the canvas the WebView document gives the engine. */
export const TEAM_SCENE_CANVAS_ID = 'team-scene'

/** What the Pixel painter is built from; any change builds a new one. */
export type TeamSceneEngineSetup = {
  sceneId: string
  /** The host's entry for a scene that is not built in; null draws the built-in or Quest. */
  extension: OrchestratorGameSceneExtension | null
  /** The project's IANA zone, for the theme of the day and daylight. */
  timezone: string
  colors: TeamSceneStatusColors
}

/** From the app to the WebView. */
export type TeamSceneEngineCommand =
  | { type: 'scene'; setup: TeamSceneEngineSetup; input: TeamSceneInput; reducedMotion: boolean }
  /** The band is out of view or the app is in the background: no frames. */
  | { type: 'run'; running: boolean }

/** From the WebView to the app. `drawn` follows the first frame of each painter height. */
export type TeamSceneEngineEvent =
  | { type: 'ready' }
  | { type: 'drawn'; height: number }
  | { type: 'error'; message: string }

type Rec = Record<string, unknown>

const isRecord = (value: unknown): value is Rec =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isText = (value: unknown): value is string => typeof value === 'string'
const isTextOrNull = (value: unknown): value is string | null => value === null || isText(value)

const ACTIVITIES: readonly TeamSceneActivity[] = [
  'working',
  'resting',
  'needsYou',
  'done',
  'blocked'
]

// Why postMessage text: both platforms deliver the payload as a string.
function recordOf(raw: unknown): Rec | null {
  if (!isText(raw)) {
    return isRecord(raw) ? raw : null
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function isAgent(value: unknown): value is TeamSceneAgentInput {
  return (
    isRecord(value) &&
    isText(value.key) &&
    isText(value.name) &&
    isTextOrNull(value.characterKey) &&
    ACTIVITIES.some((one) => one === value.activity) &&
    (value.decisions === undefined || Array.isArray(value.decisions))
  )
}

function isMember(value: unknown): value is TeamSceneMemberInput {
  if (!isRecord(value) || !isAgent(value)) {
    return false
  }
  const { reportId, mergedPr, site }: Rec = value
  return (
    isTextOrNull(reportId) &&
    (mergedPr === null || typeof mergedPr === 'number') &&
    isRecord(site) &&
    typeof site.stage === 'number' &&
    typeof site.broken === 'boolean'
  )
}

// Why only the shape the director reads first: the sender is this app's own teamSceneInputOf.
function isInput(value: unknown): value is TeamSceneInput {
  return (
    isRecord(value) &&
    isAgent(value.lead) &&
    (value.advisor === null || (isRecord(value.advisor) && isTextOrNull(value.advisor.line))) &&
    Array.isArray(value.members) &&
    value.members.every(isMember)
  )
}

function isColors(value: unknown): value is TeamSceneStatusColors {
  return (
    isRecord(value) &&
    isText(value.attention) &&
    isText(value.done) &&
    isText(value.working) &&
    isText(value.risk)
  )
}

function setupOf(value: unknown): TeamSceneEngineSetup | null {
  if (
    !isRecord(value) ||
    !isText(value.sceneId) ||
    !isText(value.timezone) ||
    !isColors(value.colors)
  ) {
    return null
  }
  const { extension } = value
  if (extension !== null && !isExtension(extension)) {
    return null
  }
  return { sceneId: value.sceneId, extension, timezone: value.timezone, colors: value.colors }
}

// Why the definition past a record check: the app parsed it with the scene schema before sending.
function isExtension(value: unknown): value is OrchestratorGameSceneExtension {
  return isRecord(value) && isText(value.id) && isText(value.pluginId) && isRecord(value.definition)
}

export function teamSceneEngineCommandOf(raw: unknown): TeamSceneEngineCommand | null {
  const message = recordOf(raw)
  if (message?.type === 'run') {
    return typeof message.running === 'boolean' ? { type: 'run', running: message.running } : null
  }
  if (message?.type !== 'scene' || typeof message.reducedMotion !== 'boolean') {
    return null
  }
  const setup = setupOf(message.setup)
  return setup && isInput(message.input)
    ? { type: 'scene', setup, input: message.input, reducedMotion: message.reducedMotion }
    : null
}

export function teamSceneEngineEventOf(raw: unknown): TeamSceneEngineEvent | null {
  const message = recordOf(raw)
  switch (message?.type) {
    case 'ready':
      return { type: 'ready' }
    case 'drawn':
      return typeof message.height === 'number' ? { type: 'drawn', height: message.height } : null
    case 'error':
      return isText(message.message) ? { type: 'error', message: message.message } : null
    default:
      return null
  }
}
