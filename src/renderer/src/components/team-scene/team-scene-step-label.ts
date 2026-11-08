// Why: V28's bubble names the step (`gh pr view 923`); a raw shell line carries flags, ids and paths.

const SHELL_TOOLS = new Set(['Bash', 'Shell', 'shell', 'exec_command', 'run_shell_command'])
const MAX_WORDS = 4
const SEPARATORS = new Set(['|', '||', '&&', '&', ';'])
const ORCA_CLI_VARIABLE = /^\$\{?ORCA\w*CLI\}?$/
const ID = /^(msg|task|ctx|dcap|term|run|toolu|wf)_[\w-]+$|^[0-9a-f]{12,}$/i
const REDIRECT = /^\d*[<>]|^<</

/** Shell words, quotes removed; a separator outside quotes is its own word. */
function wordsOf(line: string): string[] {
  const words: string[] = []
  let word = ''
  let quote: string | null = null
  let quoted = false
  const flush = (): void => {
    if (word || quoted) {
      words.push(word)
    }
    word = ''
    quoted = false
  }
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!
    if (quote) {
      if (c === quote) {
        quote = null
      } else {
        word += c
      }
    } else if (c === '"' || c === "'") {
      quote = c
      quoted = true
    } else if (/\s/.test(c)) {
      flush()
    } else if (c === ';' || c === '|' || c === '&') {
      flush()
      const pair = line[i + 1] === c && c !== ';'
      words.push(pair ? c + c : c)
      i += pair ? 1 : 0
    } else {
      word += c
    }
  }
  flush()
  return words
}

const baseName = (word: string): string => word.replace(/\/+$/, '').split('/').pop() ?? word

/** The command a line runs, as a few words: no flags, values, ids, variables or paths. */
function commandOf(line: string): string {
  const segments: string[][] = [[]]
  for (const word of wordsOf(line)) {
    if (SEPARATORS.has(word)) {
      segments.push([])
    } else {
      segments.at(-1)!.push(word)
    }
  }
  const command = segments.find((one) => one.length > 0 && one[0] !== 'cd') ?? []
  const kept: string[] = []
  for (let i = 0; i < command.length && kept.length < MAX_WORDS; i++) {
    const word = command[i]!
    if (word === '--' || REDIRECT.test(word)) {
      break
    }
    if (word.startsWith('-')) {
      // Why: a flag's value is never the step's name; a following flag is not its value.
      const next = command[i + 1]
      if (
        !word.includes('=') &&
        next !== undefined &&
        !next.startsWith('-') &&
        !REDIRECT.test(next)
      ) {
        i += 1
      }
      continue
    }
    if (kept.length === 0 && /^\w+=/.test(word)) {
      continue
    }
    if (ORCA_CLI_VARIABLE.test(word)) {
      kept.push('orca')
    } else if (!word.startsWith('$') && !ID.test(word)) {
      kept.push(word.includes('/') ? baseName(word) : word)
    }
  }
  return kept.join(' ')
}

/** A tool step as the scene's bubble words it: the command for a shell, else tool and file. */
export function teamSceneStepLabel(tool: string, detail: string | null): string {
  if (!detail) {
    return tool
  }
  if (SHELL_TOOLS.has(tool)) {
    return commandOf(detail) || tool
  }
  return `${tool} ${detail.includes('/') ? baseName(detail) : detail}`
}
