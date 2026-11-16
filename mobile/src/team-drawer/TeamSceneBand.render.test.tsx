import { act, forwardRef, useImperativeHandle, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { AccessibilityInfo } from 'react-native'
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
})
