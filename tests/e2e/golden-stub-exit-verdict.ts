// Why a verdict and not a bare boolean: "the terminal never contained
// GOLDEN_STUB_AGENT_EXITED" is the consequence, not the cause. The agent runs
// in raw mode inside the alt screen, so nothing on that terminal is xterm echo
// — every character comes from the stub. That makes its rendered composer a
// genuine acknowledgement that the process received the keystrokes, and it
// separates "the input never arrived" from "the agent did not exit".

export const GOLDEN_STUB_COMPOSER_PREFIX = '> '

export type GoldenStubExitVerdict =
  | { readonly kind: 'exited' }
  | { readonly kind: 'input-never-reached-agent'; readonly reason: string }
  | { readonly kind: 'agent-did-not-exit'; readonly reason: string }

export function composerLineFor(command: string): string {
  return `${GOLDEN_STUB_COMPOSER_PREFIX}${command}`
}

export function classifyGoldenStubExit(input: {
  readonly terminalText: string
  readonly command: string
  readonly exitMarker: string
}): GoldenStubExitVerdict {
  const { terminalText, command, exitMarker } = input
  if (terminalText.includes(exitMarker)) {
    return { kind: 'exited' }
  }
  if (!terminalText.includes(composerLineFor(command))) {
    return {
      kind: 'input-never-reached-agent',
      reason:
        `the stub never rendered "${composerLineFor(command)}", so it never received the ` +
        'keystrokes — the pane accepted focus before its input transport was connected'
    }
  }
  return {
    kind: 'agent-did-not-exit',
    reason: `the stub rendered "${composerLineFor(command)}" but never printed ${exitMarker}`
  }
}
