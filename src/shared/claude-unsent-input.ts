// Why: a plain-text tail cannot tell Claude's dim ghost suggestion from a typed draft; both are unsent (ORCA-859).
export const CLAUDE_UNSENT_INPUT_MARK = '(unsent: typed or a Claude suggestion)'

const RULE_RE = /^─{8,}$/
const PROMPT_RE = /^❯[\s ]*(.*)$/

/** Marks the text in Claude's input box, the `❯` line between the last two rules of a pane's tail. */
export function markClaudeUnsentInput(lines: readonly string[]): {
  lines: string[]
  unsent: string | null
} {
  const close = lines.findLastIndex((line) => RULE_RE.test(line.trim()))
  const open = close > 0 ? lines.slice(0, close).findLastIndex((l) => RULE_RE.test(l.trim())) : -1
  const prompt = open >= 0 ? lines.slice(open + 1, close).findIndex((l) => PROMPT_RE.test(l)) : -1
  if (prompt < 0) {
    return { lines: [...lines], unsent: null }
  }
  const at = open + 1 + prompt
  const first = lines[at].match(PROMPT_RE)?.[1] ?? ''
  const text = [first, ...lines.slice(at + 1, close)]
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
  if (text === '') {
    return { lines: [...lines], unsent: null }
  }
  return {
    lines: lines.map((line, index) =>
      index === at ? `❯ ${CLAUDE_UNSENT_INPUT_MARK} ${first}` : line
    ),
    unsent: text
  }
}
