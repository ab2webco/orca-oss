import { act, forwardRef, useImperativeHandle, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { AccessibilityInfo, DeviceEventEmitter, View } from 'react-native'
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
  State
} from 'react-native-gesture-handler'
import { getByGestureTestId } from 'react-native-gesture-handler/jest-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TeamSceneInput } from '../../../src/shared/team-scene/team-scene-types'
import type { TeamSceneBand as Band } from './team-scene-band'
import { TeamSceneBand } from './TeamSceneBand'

type WebViewProps = {
  source: { html: string }
  onMessage: (event: { nativeEvent: { data: string } }) => void
  style: unknown
}

const webview = vi.hoisted(() => ({
  props: null as WebViewProps | null,
  injected: [] as string[]
}))

// Why a stand-in: react-native-webview ships native source; this keeps its props and injections.
vi.mock('react-native-webview', () => ({
  WebView: forwardRef((props: WebViewProps, ref) => {
    webview.props = props
    useImperativeHandle(ref, () => ({
      injectJavaScript: (js: string) => webview.injected.push(js)
    }))
    return null
  })
}))

let root: Root | null = null
const render = (element: ReactElement) => {
  if (!root) {
    const host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  }
  act(() => root!.render(element))
  return { rerender: render }
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  webview.props = null
  webview.injected = []
  Reflect.deleteProperty(document, 'visibilityState')
  vi.restoreAllMocks()
})

// Why the document: react-native-web's AppState reads the app's state from its visibility.
const showApp = (state: 'hidden' | 'visible') =>
  act(() => {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })

const input: TeamSceneInput = {
  lead: { key: 'lead', name: 'Alfred', characterKey: null, activity: 'working' },
  advisor: null,
  members: [
    {
      key: 'm1',
      name: 'Toadette',
      characterKey: null,
      activity: 'working',
      reportId: null,
      mergedPr: null,
      site: { stage: 1, broken: false }
    }
  ]
}

const officeBand: Band = {
  kind: 'stage',
  art: { kind: 'bundled', style: 'office' },
  fallback: { kind: 'bundled', style: 'office' },
  scenes: [],
  timezone: 'UTC',
  input
}

/** What the page was told, in order: each injection calls `window.__teamScene(message)`. */
const messages = (): { kind: string; [key: string]: unknown }[] =>
  webview.injected.map((js) => JSON.parse(js.match(/^window\.__teamScene\((.*)\);true;$/s)![1]!))

const send = (event: unknown) =>
  act(() => webview.props!.onMessage({ nativeEvent: { data: JSON.stringify(event) } }))

describe('the Team sheet scene band', () => {
  it("runs the desktop's scene engine in a WebView and hands it the stage, then the team", () => {
    render(
      <TeamSceneBand
        band={officeBand}
        ownArt={null}
        leadLine="Reviewing #1249"
        leadName="Alfred"
        advisorName="Mago"
        members={[]}
      />
    )
    expect(webview.props?.source.html).toContain('window.__teamScene')
    expect(webview.injected).toEqual([])
    send({ kind: 'loaded' })
    const [motion, stage, team] = messages()
    expect(motion).toEqual({ kind: 'motion', run: true, reduced: false })
    expect(stage).toMatchObject({ kind: 'stage', stage: { art: officeBand.art } })
    expect(Object.keys((stage!.stage as { images: object }).images)).toContain('office/desk.png')
    expect(team).toEqual({
      kind: 'input',
      input,
      leadLine: 'Reviewing #1249',
      advisorName: 'Mago'
    })
  })

  it('ends a long bubble on a whole line: the box that clamps its lines has no vertical padding', () => {
    render(
      <TeamSceneBand
        band={officeBand}
        ownArt={null}
        leadLine={null}
        leadName="Alfred"
        advisorName="Mago"
        members={[]}
      />
    )
    const page = new DOMParser().parseFromString(webview.props!.source.html, 'text/html')
    const clamped = [...page.styleSheets]
      .flatMap((sheet) => [...sheet.cssRules])
      .flatMap((rule) => ('style' in rule ? [rule.style as CSSStyleDeclaration] : []))
      .filter((style) => style.getPropertyValue('-webkit-line-clamp') !== '')
    expect(clamped).not.toHaveLength(0)
    // Why: overflow clips at the padding box, so a bottom padding shows the top of the next line.
    for (const style of clamped) {
      expect([
        style.getPropertyValue('padding-top'),
        style.getPropertyValue('padding-bottom')
      ]).toEqual(['0px', '0px'])
    }
  })

  it('sends a new reading of the team without reloading the stage', () => {
    const view = render(
      <TeamSceneBand
        band={officeBand}
        ownArt={null}
        leadLine={null}
        leadName="Alfred"
        members={[]}
      />
    )
    send({ kind: 'loaded' })
    const html = webview.props!.source.html
    const waiting = {
      ...officeBand,
      input: { ...input, members: [{ ...input.members[0]!, activity: 'needsYou' as const }] }
    }
    view.rerender(
      <TeamSceneBand band={waiting} ownArt={null} leadLine={null} leadName="Alfred" members={[]} />
    )
    expect(webview.props!.source.html).toBe(html)
    expect(messages().map((one) => one.kind)).toEqual(['motion', 'stage', 'input', 'input'])
    expect(messages()[3]).toMatchObject({ input: { members: [{ activity: 'needsYou' }] } })
  })

  it('hands the stage and team again when the page reloads, as after its renderer was killed', () => {
    render(
      <TeamSceneBand
        band={officeBand}
        ownArt={null}
        leadLine={null}
        leadName="Alfred"
        members={[]}
      />
    )
    send({ kind: 'loaded' })
    send({ kind: 'loaded' })
    expect(messages().map((one) => one.kind)).toEqual([
      'motion',
      'stage',
      'input',
      'motion',
      'stage',
      'input'
    ])
  })

  it('lets the inline page load from a data URL, as Android serves it, and nothing else', () => {
    render(
      <TeamSceneBand
        band={officeBand}
        ownArt={null}
        leadLine={null}
        leadName="Alfred"
        members={[]}
      />
    )
    const allow = (url: string) =>
      (
        webview.props as unknown as {
          onShouldStartLoadWithRequest: (request: { url: string }) => boolean
        }
      ).onShouldStartLoadWithRequest({ url })
    expect(allow('about:blank')).toBe(true)
    expect(allow('data:text/html;base64,PGh0bWw+')).toBe(true)
    expect(allow('https://example.com')).toBe(false)
  })

  it('draws the fallback stage when the art does not load', () => {
    const scene: Band = {
      ...officeBand,
      art: { kind: 'pixel', sceneId: 'quest' },
      fallback: { kind: 'pixel', sceneId: 'quest' }
    }
    render(
      <TeamSceneBand
        band={{ ...scene, art: officeBand.art }}
        ownArt={null}
        leadLine={null}
        leadName="Alfred"
        members={[]}
      />
    )
    send({ kind: 'loaded' })
    send({ kind: 'artFailed' })
    expect(messages().at(-2)).toMatchObject({
      kind: 'stage',
      stage: { art: { kind: 'pixel', sceneId: 'quest' } }
    })
  })

  it('shows the names in place of the stage once the stage stops drawing', () => {
    render(
      <TeamSceneBand
        band={officeBand}
        ownArt={null}
        leadLine={null}
        leadName="Alfred"
        members={[]}
      />
    )
    send({ kind: 'loaded' })
    expect(document.body.textContent).toBe('')
    send({ kind: 'error', message: 'Error: canvas lost' })
    expect(document.body.textContent).toBe('Alfred')
  })

  it("stops the stage's frames while the app is in the background", () => {
    render(
      <TeamSceneBand
        band={officeBand}
        ownArt={null}
        leadLine={null}
        leadName="Alfred"
        members={[]}
      />
    )
    send({ kind: 'loaded' })
    expect(messages()[0]).toEqual({ kind: 'motion', run: true, reduced: false })
    showApp('hidden')
    expect(messages().at(-1)).toEqual({ kind: 'motion', run: false, reduced: false })
    showApp('visible')
    expect(messages().at(-1)).toEqual({ kind: 'motion', run: true, reduced: false })
  })

  it("keeps the stage still when the phone's Reduce Motion is on", async () => {
    vi.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true)
    render(
      <TeamSceneBand
        band={officeBand}
        ownArt={null}
        leadLine={null}
        leadName="Alfred"
        members={[]}
      />
    )
    await act(async () => {})
    send({ kind: 'loaded' })
    expect(messages()[0]).toEqual({ kind: 'motion', run: true, reduced: true })
  })

  it('stops the stage while the sheet is scrolled past it, and runs it again in view', () => {
    const view = render(
      <TeamSceneBand
        band={officeBand}
        ownArt={null}
        leadLine={null}
        leadName="Alfred"
        members={[]}
        shown={false}
      />
    )
    send({ kind: 'loaded' })
    expect(messages()[0]).toEqual({ kind: 'motion', run: false, reduced: false })
    view.rerender(
      <TeamSceneBand
        band={officeBand}
        ownArt={null}
        leadLine={null}
        leadName="Alfred"
        members={[]}
        shown
      />
    )
    expect(messages().at(-1)).toEqual({ kind: 'motion', run: true, reduced: false })
  })

  describe('the 3D stage camera (ORCA-1335)', () => {
    const figuresBand: Band = {
      ...officeBand,
      art: { kind: 'bundled', style: 'figures' },
      fallback: { kind: 'bundled', style: 'figures' },
      diorama: { quality: 'high', pace: 'normal' },
      machines: []
    }
    const labels = { lead: 'Follow the lead', all: 'Show all' }
    // Why attached around the band: as in the sheet, a relation names gestures by their handler tag.
    let sheet = [Gesture.Native(), Gesture.Pan()]
    const renderStage = (band: Band) => {
      sheet = [Gesture.Native(), Gesture.Pan()]
      return render(
        <GestureHandlerRootView>
          <GestureDetector gesture={Gesture.Simultaneous(...sheet)}>
            <View collapsable={false}>
              <TeamSceneBand
                band={band}
                ownArt={null}
                leadLine={null}
                leadName="Alfred"
                advisorName="Mago"
                members={[]}
                cameraLabels={labels}
                sheetGestures={sheet}
              />
            </View>
          </GestureDetector>
        </GestureHandlerRootView>
      )
    }
    const cameraButton = (mode: 'lead' | 'all') =>
      document.querySelector<HTMLElement>(`[data-testid="team-scene-camera-${mode}"]`)
    const selected = () =>
      (['lead', 'all'] as const).filter(
        (mode) => cameraButton(mode)?.getAttribute('aria-selected') === 'true'
      )
    const bandHeight = () =>
      getComputedStyle(document.querySelector<HTMLElement>('[data-testid="team-scene-band"]')!)
        .height
    // Why the emitter, not jest-utils' fireGestureHandler: under Vite that emits on another copy of
    // react-native; this one reaches the handler's callbacks through RNGH's own event receiver.
    const drive = (
      gesture: ReturnType<typeof getByGestureTestId>,
      moves: Record<string, number>[]
    ) => {
      const handlerTag = gesture.handlerTag
      const at = (one: Record<string, number>) => ({ handlerTag, numberOfPointers: 1, ...one })
      act(() => {
        DeviceEventEmitter.emit('onGestureHandlerStateChange', {
          ...at(moves[0]!),
          state: State.BEGAN,
          oldState: State.UNDETERMINED
        })
        DeviceEventEmitter.emit('onGestureHandlerStateChange', {
          ...at(moves[0]!),
          state: State.ACTIVE,
          oldState: State.BEGAN
        })
        for (const one of moves.slice(1)) {
          DeviceEventEmitter.emit('onGestureHandlerEvent', { ...at(one), state: State.ACTIVE })
        }
        DeviceEventEmitter.emit('onGestureHandlerStateChange', {
          ...at(moves.at(-1)!),
          state: State.END,
          oldState: State.ACTIVE
        })
      })
    }
    const nextFrame = () =>
      act(async () => {
        await new Promise((resolve) => requestAnimationFrame(resolve))
      })

    it('offers Follow the lead and Show all under a 3D stage, following the lead first', () => {
      renderStage(figuresBand)
      send({ kind: 'loaded' })
      expect(cameraButton('lead')).toBeNull()
      send({ kind: 'ready', height: 240, camera: 'lead' })
      expect(cameraButton('lead')?.textContent).toBe('Follow the lead')
      expect(cameraButton('all')?.textContent).toBe('Show all')
      expect(selected()).toEqual(['lead'])
      // Why a row of its own: buttons over the stage would cover the figures.
      expect(bandHeight()).toBe('284px')
      expect(getComputedStyle(cameraButton('all')!).minHeight).toBe('44px')
    })

    it('tells the page each button, and a camera moved by hand selects neither', () => {
      renderStage(figuresBand)
      send({ kind: 'loaded' })
      send({ kind: 'ready', height: 240, camera: 'lead' })
      act(() => cameraButton('all')!.click())
      expect(messages().at(-1)).toEqual({ kind: 'camera', mode: 'all' })
      send({ kind: 'camera', mode: 'all' })
      expect(selected()).toEqual(['all'])
      send({ kind: 'camera', mode: 'free' })
      expect(selected()).toEqual([])
      act(() => cameraButton('lead')!.click())
      expect(messages().at(-1)).toEqual({ kind: 'camera', mode: 'lead' })
    })

    it('pans and pinches the 3D stage, ahead of the sheet scroll and drag', async () => {
      renderStage(figuresBand)
      send({ kind: 'loaded' })
      send({ kind: 'ready', height: 240, camera: 'lead' })
      // Why: RNGH registers an updated gesture in a microtask.
      await act(async () => {})
      const pan = getByGestureTestId('team-scene-camera-pan')
      const pinch = getByGestureTestId('team-scene-camera-pinch')
      // Why blocks: a touch that starts on the stage must never scroll or close the sheet.
      const tags = sheet.map((one) => one.handlerTag)
      expect(tags.every((tag) => tag > 0)).toBe(true)
      expect(pan.config.enabled).toBe(true)
      expect(pan.config.blocksHandlers).toEqual(tags)
      expect(pinch.config.blocksHandlers).toEqual(tags)
      const injected = webview.injected.length
      drive(pan, [
        { translationX: 4, translationY: 2 },
        { translationX: 30, translationY: -10 },
        { translationX: 34, translationY: -40 }
      ])
      await nextFrame()
      // Why one message: the frame's moves arrive at once, not a script per touch event.
      expect(messages().slice(injected)).toEqual([{ kind: 'camera', pan: [30, -42] }])
      drive(pinch, [{ scale: 1 }, { scale: 1.5 }, { scale: 2 }])
      await nextFrame()
      expect(messages().at(-1)).toEqual({ kind: 'camera', zoom: 2 })
    })

    it('leaves a 2D stage to the sheet: no buttons, and its gestures off', async () => {
      renderStage(officeBand)
      send({ kind: 'loaded' })
      send({ kind: 'ready', height: 200 })
      expect(cameraButton('lead')).toBeNull()
      expect(bandHeight()).toBe('200px')
      await act(async () => {})
      // Why disabled: RNGH never begins a disabled gesture, so the sheet's scroll takes the drag.
      expect(getByGestureTestId('team-scene-camera-pan').config.enabled).toBe(false)
      expect(getByGestureTestId('team-scene-camera-pinch').config.enabled).toBe(false)
    })
  })
})
