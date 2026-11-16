// The Team scene WebView's engine, bundled by build-team-scene-webview-engine.mjs. It runs in the
// WebView only, so the painter code it pulls in never reaches Hermes or the Metro graph.
import './team-scene-webview-engine-shims'
import { daylightAt, hourOf } from '../../resources/claude-plugins/orca-game/hooks/hd-daylight'
import type { TeamScenePainter } from '../../src/renderer/src/components/team-scene/team-scene-painter'
import { createPixelPainter } from '../../src/renderer/src/components/team-scene/team-scene-pixel-painter'
import { teamScenePixelSceneOf } from '../../src/renderer/src/components/team-scene/team-scene-pixel-scene'
import {
  createTeamSceneEngine,
  type TeamSceneEngineCanvas
} from '../src/team-drawer/team-scene-webview-driver'
import {
  TEAM_SCENE_CANVAS_ID,
  type TeamSceneEngineEvent,
  type TeamSceneEngineSetup
} from '../src/team-drawer/team-scene-webview-messages'

type NativeBridge = { postMessage: (data: string) => void }

const isBridge = (value: unknown): value is NativeBridge =>
  typeof value === 'object' &&
  value !== null &&
  typeof Reflect.get(value, 'postMessage') === 'function'

const isCanvas = (value: unknown): value is TeamSceneEngineCanvas =>
  typeof value === 'object' &&
  value !== null &&
  typeof Reflect.get(value, 'getContext') === 'function'

// Why the theme and light at build time: the desktop resolves them when its painter is made too.
function makePainter(setup: TeamSceneEngineSetup): TeamScenePainter {
  const nowMs = Date.now()
  const scene = teamScenePixelSceneOf({
    sceneId: setup.sceneId,
    extensions: { scenes: setup.extension ? [setup.extension] : [] },
    nowMs,
    timezone: setup.timezone
  })
  return createPixelPainter({
    scene,
    light: daylightAt(hourOf(nowMs, setup.timezone)),
    colors: setup.colors
  })
}

function boot(): void {
  const bridge: unknown = Reflect.get(window, 'ReactNativeWebView')
  const post = (event: TeamSceneEngineEvent): void => {
    if (isBridge(bridge)) {
      bridge.postMessage(JSON.stringify(event))
    }
  }
  window.addEventListener('error', (event) =>
    post({ type: 'error', message: String(event.message) })
  )
  const canvas: unknown = document.getElementById(TEAM_SCENE_CANVAS_ID)
  if (!isCanvas(canvas)) {
    post({ type: 'error', message: 'No scene canvas' })
    return
  }
  const engine = createTeamSceneEngine({
    canvas,
    ratio: () => window.devicePixelRatio || 1,
    scheduler: {
      request: (cb) => window.requestAnimationFrame(cb),
      cancel: (id) => window.cancelAnimationFrame(id)
    },
    post,
    makePainter
  })
  const receive = (event: Event): void => {
    if ('data' in event) {
      engine.receive(event.data)
    }
  }
  // Why both: react-native-webview dispatches on window on iOS and on document on Android.
  window.addEventListener('message', receive)
  document.addEventListener('message', receive)
  window.addEventListener('resize', () => engine.resize())
  post({ type: 'ready' })
}

boot()
