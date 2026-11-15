/** What a Claude pane is blocked on: a tool permission, or an AskUserQuestion. */
export type GamePanePrompt = 'permission' | 'question'

export type ClaudePaneScreen =
  | { kind: 'dialog'; prompt: GamePanePrompt }
  /** Its input box is back; `turnEnded` once the last turn printed its end line. */
  | { kind: 'input'; turnEnded: boolean }
  | { kind: 'unknown' }

const RULE = /^\s*─{20,}\s*$/
const DIALOG_FOOTER = /\bEsc to cancel\b/
const QUESTION_FOOTER = /\bEnter to select\b/
const OPTION = /^\s*(?:❯\s*)?\d\.\s+\S/
const SUBMITTED_PROMPT = /^❯\s+\S/
// Why both: Esc and "No" leave "Interrupted"; a finished turn prints `✻ Crunched for 7s · done 12:43 PM`.
const TURN_END = /\bInterrupted · What should Claude do instead\?|\bfor (?:\d+[hms]\s*)+·\s*done\b/
// Why a window: a dialog's footer is its last line, but the person's status line may follow it.
const FOOTER_WINDOW = 4
const DIALOG_WINDOW = 24

/** The last input box: a `❯` line between two rules; -1 when none shows. */
function inputBoxAt(lines: readonly string[]): number {
  for (let at = lines.length - 1; at > 0; at -= 1) {
    if (!lines[at]!.startsWith('❯') || !RULE.test(lines[at - 1]!)) {
      continue
    }
    if (lines.slice(at + 1, at + 6).some((line) => RULE.test(line))) {
      return at - 1
    }
  }
  return -1
}

/** Read what the bottom of a Claude pane shows, from Orca's terminal tail. */
export function claudePaneScreenOf(tail: string): ClaudePaneScreen {
  const lines = tail.split('\n').filter((line) => line.trim() !== '')
  const box = inputBoxAt(lines)
  const footerAt = lines.findLastIndex(
    (line, at) => at >= lines.length - FOOTER_WINDOW && DIALOG_FOOTER.test(line)
  )
  // Why after the box: a dialog replaces the input box, so one quoted above it is scrollback.
  if (footerAt > box && lines.slice(-DIALOG_WINDOW).some((line) => OPTION.test(line))) {
    return {
      kind: 'dialog',
      prompt: QUESTION_FOOTER.test(lines[footerAt]!) ? 'question' : 'permission'
    }
  }
  if (box < 0) {
    return { kind: 'unknown' }
  }
  const above = lines.slice(0, box)
  const promptAt = above.findLastIndex((line) => SUBMITTED_PROMPT.test(line))
  return { kind: 'input', turnEnded: above.slice(promptAt + 1).some((line) => TURN_END.test(line)) }
}

/**
 * A waiting member's state as its own screen proves it. Why: Claude fires no hook when a permission
 * prompt is denied, cancelled or auto-blocked, so the hook row stays waiting (ORCA-1231).
 */
export function gameWaitingStateOnScreen<S extends string>(args: {
  state: S
  agentType: string | null
  terminalTail: string | null
}): S | 'waiting' | 'working' | 'done' {
  if (args.state !== 'waiting' || args.agentType !== 'claude' || args.terminalTail === null) {
    return args.state
  }
  const screen = claudePaneScreenOf(args.terminalTail)
  if (screen.kind !== 'input') {
    return 'waiting'
  }
  return screen.turnEnded ? 'done' : 'working'
}
