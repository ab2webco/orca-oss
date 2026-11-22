import { useEffect, useMemo, useRef, useState } from 'react'
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native'
import { GestureDetector, type GestureType } from 'react-native-gesture-handler'
import { WebView } from 'react-native-webview'
import { useReducedMotionEnabled } from '../hooks/use-reduced-motion-enabled'
import { useAppInForeground } from '../plugin-panels/use-plugin-panel-session'
import { Text } from '../theme/dynamic-type-text'
import { colors, spacing, typography } from '../theme/mobile-theme'
import type { TeamMemberRow } from './team-drawer-model'
import type { TeamSceneArtPick, TeamSceneBand as Band } from './team-scene-band'
import type {
  TeamSceneCameraMode,
  TeamSceneEngineEvent,
  TeamSceneEngineMessage,
  TeamSceneEngineStage
} from './team-scene-engine-messages'
import {
  TEAM_SCENE_CAMERA_ROW,
  TeamSceneCameraButtons,
  useTeamSceneCameraGesture
} from './TeamSceneCamera'
import {
  TEAM_SCENE_ENGINE_JS,
  TEAM_SCENE_QUEST_IMAGES
} from './team-scene-webview-engine.generated'
import type { TeamSceneArtLoad } from './use-team-scene-art'
import {
  TEAM_SCENE_NAME_FONT,
  TEAM_SCENE_NAME_ROW,
  TEAM_SCENE_NAME_STRIP
} from './team-scene-engine-names'
import { MEMBER_STATE_ROLE, useTeamTones, type TeamTones } from './team-status-tone'

const NO_SHEET_GESTURES: GestureType[] = []

/** The desktop stage's height (TEAM_SCENE_ART_HEIGHT), held until the page says its own. */
export const TEAM_SCENE_BAND_HEIGHT = 176

const HTML = `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; base-uri 'none'; form-action 'none'" />
<style>
  html, body { margin: 0; padding: 0; overflow: hidden; background: ${colors.bgBase}; }
  #wrap { position: relative; }
  #stage, #stage3d { display: block; width: 100%; }
  #overlay { position: absolute; inset: 0; pointer-events: none; }
  /* Why a border, not padding: overflow clips at the padding box, so padding showed a cut line. */
  .bubble { position: absolute; box-sizing: border-box; padding: 0 8px; border-radius: 8px;
    border: solid transparent; border-width: 3px 0;
    background: #f4f4f5; color: #18181b; font: 500 11px/14px -apple-system, system-ui, sans-serif;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    white-space: pre-line; overflow-wrap: anywhere; }
  #names { position: relative; height: ${TEAM_SCENE_NAME_STRIP}px; }
  .name { position: absolute; box-sizing: border-box; padding: 0 4px; color: #eef0f4; text-align: center;
    font: ${TEAM_SCENE_NAME_FONT}; line-height: ${TEAM_SCENE_NAME_ROW}px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
</head>
<body><div id="wrap"><canvas id="stage3d" style="display:none"></canvas><canvas id="stage" height="${TEAM_SCENE_BAND_HEIGHT}" style="height:${TEAM_SCENE_BAND_HEIGHT}px"></canvas><div id="overlay"></div><div id="names"></div></div>
<script>${TEAM_SCENE_ENGINE_JS}</script>
</body>
</html>`

type PageEvent = { kind: 'loaded' } | TeamSceneEngineEvent

const pageEventOf = (data: string): PageEvent | null => {
  try {
    const event = JSON.parse(data) as PageEvent
    return typeof event?.kind === 'string' ? event : null
  } catch {
    return null
  }
}

// Why escaped: U+2028/2029 end a line inside a script, and a name may carry either.
const scriptOf = (message: TeamSceneEngineMessage): string =>
  `window.__teamScene(${JSON.stringify(message).replace(/[\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16)}`)});true;`

// The scene's four meanings on the sheet's tones, as team-scene-status-colors.ts maps the desktop's.
const sceneColorsOf = (tones: TeamTones): TeamSceneEngineStage['colors'] => ({
  attention: tones.attention,
  done: tones.success,
  working: tones.info,
  risk: tones.warning
})

function imagesOf(art: TeamSceneArtPick, ownArt: TeamSceneArtLoad | null): Record<string, string> {
  if (art.kind === 'bundled') {
    return TEAM_SCENE_QUEST_IMAGES[art.style]
  }
  if (art.kind === 'scene' && ownArt?.kind === 'ready') {
    return Object.fromEntries([...ownArt.images].map(([src, image]) => [src, image.uri]))
  }
  return {}
}

/** The desktop's live stage, drawn by its own painters in a WebView and fed each Team reading. */
function StageBand({
  band,
  ownArt,
  leadLine,
  advisorName,
  shown,
  cameraLabels,
  sheetGestures,
  onLayout,
  onBroken
}: {
  band: Extract<Band, { kind: 'stage' }>
  ownArt: TeamSceneArtLoad | null
  leadLine: string | null
  advisorName: string
  shown: boolean
  cameraLabels: { lead: string; all: string }
  sheetGestures: GestureType[]
  onLayout?: (event: LayoutChangeEvent) => void
  /** The stage stopped drawing, so the sheet shows the names instead. */
  onBroken: () => void
}) {
  const ref = useRef<WebView>(null)
  const tones = useTeamTones()
  // Why a count: a reloaded page (its renderer killed) says loaded again and needs everything again.
  const [loaded, setLoaded] = useState(0)
  const [failed, setFailed] = useState(false)
  const [height, setHeight] = useState(TEAM_SCENE_BAND_HEIGHT)
  // Why the page's word: it holds the camera across stage rebuilds, and null means a 2D stage.
  const [camera, setCamera] = useState<TeamSceneCameraMode | null>(null)
  const sendCamera = (message: Extract<TeamSceneEngineMessage, { kind: 'camera' }>) =>
    ref.current?.injectJavaScript(scriptOf(message))
  const gesture = useTeamSceneCameraGesture(camera !== null, sendCamera, sheetGestures)
  const ownFailed = band.art.kind === 'scene' && ownArt?.kind === 'failed'
  const art = failed || ownFailed ? band.fallback : band.art
  const waitsForArt = art.kind === 'scene' && ownArt?.kind !== 'ready'
  const stageKey = JSON.stringify([
    art,
    band.scenes,
    band.timezone,
    tones,
    ownArt?.kind,
    band.diorama
  ])
  const stage = useMemo<TeamSceneEngineStage>(
    () => ({
      art,
      images: imagesOf(art, ownArt),
      scenes: band.scenes,
      timezone: band.timezone,
      nowMs: Date.now(),
      colors: sceneColorsOf(tones),
      ...(band.diorama ? { diorama: band.diorama } : {})
    }),
    // Why by text: every 20 s poll hands a new band, and a new stage re-decodes megabytes of art.
    [stageKey]
  )
  const inputKey = JSON.stringify([band.input, leadLine, advisorName, band.machines])
  const run = useAppInForeground() && shown
  const reduced = useReducedMotionEnabled()
  // Why before the stage: a page that loads with the app in the background must not start frames.
  useEffect(() => {
    if (loaded > 0) {
      ref.current?.injectJavaScript(scriptOf({ kind: 'motion', run, reduced }))
    }
  }, [loaded, run, reduced])
  useEffect(() => {
    if (loaded > 0 && !waitsForArt) {
      ref.current?.injectJavaScript(scriptOf({ kind: 'stage', stage }))
    }
  }, [loaded, waitsForArt, stage])
  useEffect(() => {
    if (loaded > 0 && !waitsForArt) {
      ref.current?.injectJavaScript(
        scriptOf({
          kind: 'input',
          input: band.input,
          leadLine,
          advisorName,
          machines: band.machines
        })
      )
    }
  }, [loaded, waitsForArt, stage, inputKey])
  return (
    <View
      testID="team-scene-band"
      style={[styles.band, { height: height + (camera ? TEAM_SCENE_CAMERA_ROW : 0) }]}
      onLayout={onLayout}
    >
      <GestureDetector gesture={gesture}>
        <View
          style={{ height }}
          collapsable={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <WebView
            ref={ref}
            // Why: the sheet's gestures read every touch, so the stage pans only when they say so.
            pointerEvents="none"
            style={styles.webview}
            originWhitelist={['*']}
            source={{ html: HTML }}
            javaScriptEnabled
            scrollEnabled={false}
            // Why: the stage is self-contained; nothing it draws may navigate the sheet.
            onShouldStartLoadWithRequest={(request) =>
              request.url === 'about:blank' || request.url.startsWith('data:')
            }
            onMessage={(event) => {
              const page = pageEventOf(event.nativeEvent.data)
              if (page?.kind === 'loaded') {
                setLoaded((count) => count + 1)
              } else if (page?.kind === 'ready') {
                setHeight(page.height)
                setCamera(page.camera ?? null)
              } else if (page?.kind === 'camera') {
                setCamera(page.mode)
              } else if (page?.kind === 'artFailed') {
                setFailed(true)
              } else if (page?.kind === 'error') {
                onBroken()
              }
            }}
          />
        </View>
      </GestureDetector>
      {camera ? (
        <TeamSceneCameraButtons
          mode={camera}
          labels={cameraLabels}
          onMode={(mode) => sendCamera({ kind: 'camera', mode })}
        />
      ) : null}
    </View>
  )
}

function ReadableBand({
  leadName,
  members,
  onLayout
}: {
  leadName: string | null
  members: TeamMemberRow[]
  onLayout?: (event: LayoutChangeEvent) => void
}) {
  const tones = useTeamTones()
  const names = [
    ...(leadName ? [{ key: 'lead', name: leadName, tone: colors.textSecondary }] : []),
    ...members.map((one) => ({
      key: one.key,
      name: one.name,
      tone: tones[one.needsYou ? 'attention' : MEMBER_STATE_ROLE[one.state]]
    }))
  ]
  return (
    <View testID="team-scene-band" style={[styles.band, styles.readable]} onLayout={onLayout}>
      {names.map((one) => (
        <View key={one.key} style={styles.chip}>
          <View style={[styles.dot, { backgroundColor: one.tone }]} />
          <Text style={styles.name} numberOfLines={1}>
            {one.name}
          </Text>
        </View>
      ))}
    </View>
  )
}

/** The Game look's stage at phone size: the desktop's own scene, or the names on an older host. */
export function TeamSceneBand({
  band,
  ownArt,
  leadLine,
  leadName,
  advisorName,
  members,
  shown = true,
  cameraLabels,
  sheetGestures = NO_SHEET_GESTURES,
  onLayout
}: {
  band: Band
  /** The scene file's images, for a stage drawn in a scene's own art. */
  ownArt: TeamSceneArtLoad | null
  /** The lead's bubble; null shows none. */
  leadLine: string | null
  leadName: string | null
  /** The advisor's name on its card, for its label under the stage. */
  advisorName: string
  members: TeamMemberRow[]
  /** False while the sheet is scrolled past the band, so its stage runs no frames unseen. */
  shown?: boolean
  /** Follow the lead and Show all, for a 3D stage's camera. */
  cameraLabels: { lead: string; all: string }
  /** The sheet's scroll and drag, which a finger on a 3D stage must not move. */
  sheetGestures?: GestureType[]
  onLayout?: (event: LayoutChangeEvent) => void
}) {
  // Why for the band's life: a stage that threw once would only throw again; reopening retries it.
  const [broken, setBroken] = useState(false)
  return band.kind === 'stage' && !broken ? (
    <StageBand
      band={band}
      ownArt={ownArt}
      leadLine={leadLine}
      advisorName={advisorName}
      shown={shown}
      cameraLabels={cameraLabels}
      sheetGestures={sheetGestures}
      onLayout={onLayout}
      onBroken={() => setBroken(true)}
    />
  ) : (
    <ReadableBand leadName={leadName} members={members} onLayout={onLayout} />
  )
}

const styles = StyleSheet.create({
  band: {
    height: TEAM_SCENE_BAND_HEIGHT,
    marginHorizontal: -spacing.lg,
    overflow: 'hidden',
    backgroundColor: colors.bgBase
  },
  webview: {
    flex: 1,
    backgroundColor: colors.bgBase
  },
  readable: {
    height: 128,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignContent: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4
  },
  name: {
    color: colors.textSecondary,
    fontFamily: typography.monoFamily,
    fontSize: typography.metaSize
  }
})
