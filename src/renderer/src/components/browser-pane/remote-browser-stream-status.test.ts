import { describe, expect, it } from 'vitest'
import {
  canOpenRemoteBrowserContextMenu,
  canReconnectRemoteBrowserStream,
  isRemoteBrowserStreamBusy,
  REMOTE_BROWSER_STREAM_IDLE,
  REMOTE_BROWSER_STREAM_LIVE,
  REMOTE_BROWSER_STREAM_OPENING,
  remoteBrowserStreamNotice,
  remoteBrowserStreamRetrying,
  remoteBrowserStreamStopped,
  type RemoteBrowserStreamStatus
} from './remote-browser-stream-status'

// These pin the derivation rules, which are what make the four defects three review rounds found
// unrepresentable. The type stops you writing an invalid state; these stop the derivations drifting
// so that a valid state renders as an invalid one.
const ALL: RemoteBrowserStreamStatus[] = [
  REMOTE_BROWSER_STREAM_IDLE,
  REMOTE_BROWSER_STREAM_OPENING,
  REMOTE_BROWSER_STREAM_LIVE,
  remoteBrowserStreamRetrying('Lost connection to the remote server.'),
  remoteBrowserStreamStopped('Lost connection to the remote server.')
]

describe('remote browser stream status', () => {
  // "stopped, but no message" made the reconnect control unrenderable, because it lives inside the
  // notice. The constructor requires one, so this holds by construction — asserted anyway because
  // the render coupling is the part no unit test can see.
  it('always carries a notice in the states that report a failure', () => {
    expect(remoteBrowserStreamNotice(remoteBrowserStreamStopped('gone'))).toBe('gone')
    expect(remoteBrowserStreamNotice(remoteBrowserStreamRetrying('dropped'))).toBe('dropped')
  })

  // The budget exists to absorb a blip invisibly, so a retry that has not failed yet says nothing.
  it('stays silent while retrying until an attempt has actually failed', () => {
    expect(remoteBrowserStreamNotice(remoteBrowserStreamRetrying(null))).toBeNull()
    expect(isRemoteBrowserStreamBusy(remoteBrowserStreamRetrying(null))).toBe(true)
    expect(canReconnectRemoteBrowserStream(remoteBrowserStreamRetrying(null))).toBe(false)
  })

  it('reports no notice while nothing has failed', () => {
    for (const status of [
      REMOTE_BROWSER_STREAM_IDLE,
      REMOTE_BROWSER_STREAM_OPENING,
      REMOTE_BROWSER_STREAM_LIVE
    ]) {
      expect(remoteBrowserStreamNotice(status)).toBeNull()
    }
  })

  // "retrying, but the control is up" offered a manual retry ~500ms before the automatic one.
  it('offers reconnect only once automatic recovery is over', () => {
    expect(canReconnectRemoteBrowserStream(remoteBrowserStreamStopped('gone'))).toBe(true)
    for (const status of ALL.filter((candidate) => candidate.kind !== 'stopped')) {
      expect(canReconnectRemoteBrowserStream(status)).toBe(false)
    }
  })

  // "stopped, but still busy" left a spinner over a frozen frame, which also blocked the pane's
  // own input handlers.
  it('is never busy in a state the user is expected to act on', () => {
    expect(isRemoteBrowserStreamBusy(remoteBrowserStreamStopped('gone'))).toBe(false)
    expect(isRemoteBrowserStreamBusy(REMOTE_BROWSER_STREAM_LIVE)).toBe(false)
    expect(isRemoteBrowserStreamBusy(REMOTE_BROWSER_STREAM_IDLE)).toBe(false)
  })

  it('is busy exactly while recovery is in flight', () => {
    expect(isRemoteBrowserStreamBusy(REMOTE_BROWSER_STREAM_OPENING)).toBe(true)
    expect(isRemoteBrowserStreamBusy(remoteBrowserStreamRetrying('dropped'))).toBe(true)
  })

  // The combination that must never be derivable: something to act on, with no way to act.
  it('never offers reconnect without a notice to render it in', () => {
    for (const status of ALL) {
      if (canReconnectRemoteBrowserStream(status)) {
        expect(remoteBrowserStreamNotice(status)).not.toBeNull()
        expect(isRemoteBrowserStreamBusy(status)).toBe(false)
      }
    }
  })

  // ORCA-1232: a reopen keeps the last frame on screen, so a right-click on it must still open the
  // menu; the hit-test reads the page over RPC and never needed the screencast.
  it('opens the context menu over a frame the stream is reopening', () => {
    for (const status of ALL) {
      expect(canOpenRemoteBrowserContextMenu(status, false)).toBe(true)
    }
  })

  // A navigation in flight is about to replace the frame, so a hit-test would read the next page.
  it('holds the context menu while the pane itself is navigating', () => {
    expect(canOpenRemoteBrowserContextMenu(REMOTE_BROWSER_STREAM_LIVE, true)).toBe(false)
    expect(canOpenRemoteBrowserContextMenu(REMOTE_BROWSER_STREAM_OPENING, true)).toBe(false)
  })
})
