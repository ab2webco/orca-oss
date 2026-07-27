// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../../shared/native-chat-types'
import type { NativeChatLiveSession } from '../native-chat/use-native-chat-live-session'

const mockSession: { current: NativeChatLiveSession | null } = { current: null }

vi.mock('../native-chat/use-native-chat-live-session', () => ({
  useNativeChatLiveSession: () => mockSession.current
}))

vi.mock('../native-chat/NativeChatMessageList', () => ({
  NativeChatMessageList: () => <div data-testid="native-chat-message-list" />
}))

import { CodexResumeBlockedTranscript } from './CodexResumeBlockedTranscript'

const PROVIDER_SESSION = {
  key: 'session_id' as const,
  id: '019f9c89-244d-7232-b6e6-0874d3557f76',
  transcriptPath: '/home/sessions/2026/07/26/rollout-2026-07-26T00-17-55-019f9c89.jsonl'
}

const USER_MESSAGE: NativeChatMessage = {
  id: 'm1',
  role: 'user',
  blocks: [{ type: 'text', text: 'hello' }],
  timestamp: 1,
  source: 'transcript'
}

function liveSession(overrides: Partial<NativeChatLiveSession>): NativeChatLiveSession {
  return {
    agent: 'codex',
    sessionId: PROVIDER_SESSION.id,
    status: 'ready',
    messages: [],
    hasMore: false,
    loadingEarlier: false,
    loadEarlier: () => {},
    ...overrides
  }
}

const mountedRoots: Root[] = []

async function renderFallback(): Promise<HTMLDivElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mountedRoots.push(root)
  await act(async () => {
    root.render(
      <CodexResumeBlockedTranscript paneKey="tab:leaf" providerSession={PROVIDER_SESSION} />
    )
  })
  return container
}

describe('CodexResumeBlockedTranscript', () => {
  afterEach(async () => {
    await act(async () => {
      for (const root of mountedRoots.splice(0)) {
        root.unmount()
      }
    })
    document.body.innerHTML = ''
  })

  it('shows the reassurance banner and the read-only transcript when it loads', async () => {
    mockSession.current = liveSession({ messages: [USER_MESSAGE] })
    const container = await renderFallback()

    expect(container.textContent).toContain('Your conversation is safe and shown below')
    expect(container.querySelector('[data-testid="native-chat-message-list"]')).not.toBeNull()
  })

  it('says specifically that the transcript could not be read instead of going blank', async () => {
    mockSession.current = liveSession({ status: 'error', error: 'ENOENT' })
    const container = await renderFallback()

    expect(container.textContent).toContain('could not read the saved session file')
    expect(container.textContent).toContain('Your conversation is safe and shown below')
  })

  it('never renders a composer or send affordance', async () => {
    mockSession.current = liveSession({ messages: [USER_MESSAGE] })
    const container = await renderFallback()

    expect(container.querySelector('textarea')).toBeNull()
    expect(container.querySelector('input')).toBeNull()
    expect(container.querySelector('button')).toBeNull()
  })
})
