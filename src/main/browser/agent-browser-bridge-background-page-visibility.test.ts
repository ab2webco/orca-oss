import { describe, it, expect, vi, beforeEach } from 'vitest'

const { execFileMock, webContentsFromIdMock, existsSyncMock, readFileSyncMock, stdinWrites } =
  vi.hoisted(() => ({
    execFileMock: vi.fn(),
    webContentsFromIdMock: vi.fn(),
    existsSyncMock: vi.fn(() => false),
    readFileSyncMock: vi.fn(() => Buffer.from('')),
    stdinWrites: [] as string[]
  }))

vi.mock('child_process', () => ({ execFile: execFileMock }))
vi.mock('fs', () => ({
  existsSync: existsSyncMock,
  readFileSync: readFileSyncMock,
  accessSync: vi.fn(),
  chmodSync: vi.fn(),
  constants: { X_OK: 1 }
}))
vi.mock('os', () => ({ platform: () => 'darwin', arch: () => 'arm64' }))
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/app'), getAppPath: vi.fn(() => '/project'), isPackaged: false },
  webContents: { fromId: webContentsFromIdMock }
}))

const { CdpWsProxyMock } = vi.hoisted(() => {
  const instances: unknown[] = []
  const MockClass = vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.start = vi.fn(async () => 'ws://127.0.0.1:9222')
    this.stop = vi.fn(async () => {})
    this.getPort = vi.fn(() => 9222)
    instances.push(this)
  })
  return { CdpWsProxyMock: Object.assign(MockClass, { instances }) }
})

vi.mock('./cdp-ws-proxy', () => ({ CdpWsProxy: CdpWsProxyMock }))
vi.mock('./cdp-bridge', () => ({
  BrowserError: class BrowserError extends Error {
    code: string
    constructor(code: string, message: string) {
      super(message)
      this.code = code
    }
  }
}))

import { AgentBrowserBridge } from './agent-browser-bridge'
import {
  createSucceedWith,
  mockBrowserManager,
  mockWebContents,
  overrideBridgeWebContentsLookup,
  resetAgentBrowserBridgeMocks
} from './agent-browser-bridge-test-harness'

overrideBridgeWebContentsLookup(AgentBrowserBridge.prototype, webContentsFromIdMock)

const succeedWith = createSucceedWith(execFileMock, stdinWrites)

const FOREGROUND_PAGE = 'tab-foreground'
const BACKGROUND_PAGE = 'tab-background'
const FOREGROUND_WC = 100
const BACKGROUND_WC = 200

function buildBridge(): {
  bridge: AgentBrowserBridge
  acquireAutomationVisibility: ReturnType<typeof vi.fn>
  foreground: ReturnType<typeof mockWebContents>
  background: ReturnType<typeof mockWebContents>
} {
  const tabs = new Map([
    [FOREGROUND_PAGE, FOREGROUND_WC],
    [BACKGROUND_PAGE, BACKGROUND_WC]
  ])
  const foreground = mockWebContents(FOREGROUND_WC)
  const background = mockWebContents(BACKGROUND_WC, 'https://example.com/background', 'Background')
  background.debugger.sendCommand.mockResolvedValue({ result: { value: 'evaluated' } })
  foreground.debugger.sendCommand.mockResolvedValue({ result: { value: 'evaluated' } })
  webContentsFromIdMock.mockImplementation((id: number) =>
    id === FOREGROUND_WC ? foreground : id === BACKGROUND_WC ? background : null
  )
  const acquireAutomationVisibility = vi.fn(async () => () => {})
  const bridge = new AgentBrowserBridge(
    mockBrowserManager(tabs, undefined, { acquireAutomationVisibility })
  )
  bridge.setActiveTab(FOREGROUND_WC)
  return { bridge, acquireAutomationVisibility, foreground, background }
}

describe('targeted browser commands against a background page (ORCA-512)', () => {
  beforeEach(() => {
    resetAgentBrowserBridgeMocks({
      webContentsFromIdMock,
      existsSyncMock,
      readFileSyncMock,
      stdinWrites,
      cdpWsProxyInstances: CdpWsProxyMock.instances
    })
  })

  // Breaks if `eval --page <background>` still takes the automation-visibility
  // lease: that lease is what puts the guest on screen over the user's pane.
  it('does not make an explicitly targeted background page paintable for eval', async () => {
    const { bridge, acquireAutomationVisibility } = buildBridge()

    await expect(bridge.evaluate('1 + 1', undefined, BACKGROUND_PAGE)).resolves.toEqual({
      result: 'evaluated',
      origin: 'https://example.com/background'
    })

    expect(acquireAutomationVisibility).not.toHaveBeenCalled()
  })

  // Breaks if `snapshot --page <background>` keeps raising the pane.
  it('does not make an explicitly targeted background page paintable for snapshot', async () => {
    const { bridge, acquireAutomationVisibility } = buildBridge()
    succeedWith({ snapshot: 'tree' })

    await expect(bridge.snapshot(undefined, BACKGROUND_PAGE)).resolves.toEqual({
      browserPageId: BACKGROUND_PAGE,
      snapshot: 'tree'
    })

    expect(acquireAutomationVisibility).not.toHaveBeenCalled()
  })

  // Breaks if the read surface stays partially fixed: `get`/`is`/console/network
  // are the same background poll the WhatsApp use case makes every few minutes.
  it('does not make an explicitly targeted background page paintable for other reads', async () => {
    const { bridge, acquireAutomationVisibility } = buildBridge()
    succeedWith({ ok: true })

    await bridge.get('text', '@e1', undefined, BACKGROUND_PAGE)
    await bridge.is('visible', '@e1', undefined, BACKGROUND_PAGE)
    await bridge.consoleLog(undefined, undefined, BACKGROUND_PAGE)
    await bridge.networkLog(undefined, undefined, BACKGROUND_PAGE)
    await bridge.cookieGet(undefined, undefined, BACKGROUND_PAGE)

    expect(acquireAutomationVisibility).not.toHaveBeenCalled()
  })

  // Breaks if the fix is over-broad and strips the lease from commands with no
  // explicit target: those run against the tab the user is already looking at.
  it('still makes the active tab paintable when no explicit page was given', async () => {
    const { bridge, acquireAutomationVisibility } = buildBridge()
    succeedWith({ snapshot: 'tree' })

    await bridge.snapshot()

    expect(acquireAutomationVisibility).toHaveBeenCalledWith(FOREGROUND_WC)
  })

  // Breaks if the rule carves out "the named page is the active tab": that is the
  // shape the bug was reported in — one browser tab, marked active, while the user
  // was looking at a terminal. Active browser tab is not the visible surface.
  it('does not make a named page paintable even when it is the active tab', async () => {
    const { bridge, acquireAutomationVisibility } = buildBridge()
    succeedWith({ snapshot: 'tree' })

    await bridge.snapshot(undefined, FOREGROUND_PAGE)

    expect(acquireAutomationVisibility).not.toHaveBeenCalled()
  })

  // Breaks if commands that hit-test or need a painted guest lose their lease:
  // a click against an unrendered webview lands on nothing.
  it('keeps the lease for commands that need the page rendered', async () => {
    const { bridge, acquireAutomationVisibility } = buildBridge()
    succeedWith({ ok: true })

    await bridge.click('@e1', undefined, BACKGROUND_PAGE)
    expect(acquireAutomationVisibility).toHaveBeenCalledWith(BACKGROUND_WC)

    acquireAutomationVisibility.mockClear()
    await bridge.hover('@e1', undefined, BACKGROUND_PAGE)
    expect(acquireAutomationVisibility).toHaveBeenCalledWith(BACKGROUND_WC)

    acquireAutomationVisibility.mockClear()
    await bridge.scroll('down', 100, undefined, BACKGROUND_PAGE)
    expect(acquireAutomationVisibility).toHaveBeenCalledWith(BACKGROUND_WC)

    acquireAutomationVisibility.mockClear()
    await bridge.keypress('Enter', undefined, BACKGROUND_PAGE)
    expect(acquireAutomationVisibility).toHaveBeenCalledWith(BACKGROUND_WC)
  })

  // Breaks if dropping the lease also drops the routing: a read that silently ran
  // against the active tab instead would still satisfy "the view did not change".
  it('still routes the read to the named background page, not the active tab', async () => {
    const { bridge, foreground, background } = buildBridge()

    await bridge.evaluate('document.title', undefined, BACKGROUND_PAGE)

    expect(background.debugger.sendCommand).toHaveBeenCalledWith(
      'Runtime.evaluate',
      expect.objectContaining({ expression: 'document.title' })
    )
    expect(foreground.debugger.sendCommand).not.toHaveBeenCalled()
  })
})
