import { describe, expect, it } from 'vitest'
import { _parseHostLoginTranscriptForTest } from './host-login-session'

// Real output captured from the CLIs on a headless Linux host, escapes and all.
const CODEX_TRANSCRIPT =
  'Follow these steps to sign in with ChatGPT using device code authorization:\n\n' +
  '1. Open this link in your browser and sign in to your account\n' +
  '   [94mhttps://auth.openai.com/codex/device[0m\n\n' +
  '2. Enter this one-time code [90m(expires in 15 minutes)[0m\n' +
  '   [94m3N8Q-BJOB8[0m\n'

const CLAUDE_TRANSCRIPT =
  'Opening browser to sign in…\n' +
  "If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a\n" +
  'Paste code here if prompted > '

const GH_TRANSCRIPT =
  '! First copy your one-time code: 8D5F-2C1A\n' +
  'Press Enter to open https://github.com/login/device in your browser...\n'

describe('host login transcript parsing', () => {
  // Why this is the whole bug: `[0m` right after a URL is neither
  // whitespace nor a quote, so it was captured as part of the link. The dialog
  // then opened `https://auth.openai.com/codex/device%1B%5B0m`, which loads a
  // signed-out page no amount of logging in can fix.
  it('keeps the trailing colour reset out of the URL', () => {
    const parsed = _parseHostLoginTranscriptForTest(CODEX_TRANSCRIPT)

    expect(parsed.url).toBe('https://auth.openai.com/codex/device')
  })

  // Why 4-5 and not 4-4: Codex prints `3N8Q-BJOB8`. A code that failed to parse
  // came through as null, and the dialog read null as "ask the user to type
  // one" — demanding a code it had just failed to show them.
  it('reads a code whose halves are different lengths, through the escapes', () => {
    expect(_parseHostLoginTranscriptForTest(CODEX_TRANSCRIPT).deviceCode).toBe('3N8Q-BJOB8')
  })

  it('does not ask for a code back when the flow only shows one', () => {
    expect(_parseHostLoginTranscriptForTest(CODEX_TRANSCRIPT).awaitingCode).toBe(false)
  })

  // Claude is the opposite case and must keep working: it prints no code of its
  // own and waits for one to be pasted in.
  it('asks for a code back when the flow prompts for one', () => {
    const parsed = _parseHostLoginTranscriptForTest(CLAUDE_TRANSCRIPT)

    expect(parsed.awaitingCode).toBe(true)
    expect(parsed.deviceCode).toBeNull()
    expect(parsed.url).toContain('https://claude.com/cai/oauth/authorize')
  })

  it('reads the gh device flow, which shows a code and needs only a go-ahead', () => {
    const parsed = _parseHostLoginTranscriptForTest(GH_TRANSCRIPT)

    expect(parsed.deviceCode).toBe('8D5F-2C1A')
    expect(parsed.url).toBe('https://github.com/login/device')
    expect(parsed.awaitingCode).toBe(false)
  })
})
