#!/usr/bin/env node
// Runs the merged-worktree closer from the harness: at session start, after `gh pr merge`,
// and as a gate before a release. Never fails the tool: every error exits 0 silently.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, resolve } from 'node:path'
import {
  closeMergedWorktrees,
  githubSlug,
  isMainModule
} from '../../config/scripts/merged-worktree-close.mjs'

// Why raw text: the gate must not depend on parsing shell correctly; a false positive only runs it.
// Words may be split by flags (`gh workflow -R o/r run`), but not across another command.
const GATE_TRIGGERS = [
  /\bworkflow\b[^\n;|&]*\brun\b/i,
  /\/dispatches\b/i,
  /\brelease\b[^\n;|&]*\b(create|new)\b/i,
  /mobile-(ios|android)-(v|release)/i,
  /lab[-\s]release/i
]
const PUSH = /\bpush\b/i
const PUSHES_TAGS = /--tags\b|--follow-tags\b|--mirror\b|refs\/tags|refs\/\*|'\*'|"\*"|\s\*(\s|$)/i
const MERGE_TRIGGER = /\bpr\b[^\n;|&]*\bmerge\b/i
// `gh pr merge` flags that consume the next word, so it is not the PR selector.
const MERGE_VALUE_FLAGS = new Set([
  '-R',
  '--repo',
  '-t',
  '--subject',
  '-b',
  '--body',
  '-F',
  '--body-file',
  '-A',
  '--author-email',
  '--match-head-commit'
])
const ENV_VALUE_FLAGS = new Set(['-u', '--unset', '-C', '--chdir', '-S', '--split-string'])
// Wrapper programs that run the rest of the line, with the flags of each that consume the next word.
const WRAPPER_VALUE_FLAGS = new Map([
  ['time', new Set()],
  ['nohup', new Set()],
  ['nice', new Set(['-n', '--adjustment'])],
  ['timeout', new Set(['-s', '--signal', '-k', '--kill-after'])],
  [
    'sudo',
    new Set([
      '-u',
      '--user',
      '-g',
      '--group',
      '-h',
      '--host',
      '-p',
      '--prompt',
      '-C',
      '--close-from',
      '-D',
      '--chdir',
      '-r',
      '--role',
      '-t',
      '--type',
      '-T',
      '--command-timeout',
      '-U',
      '--other-user'
    ])
  ]
])
const SHELLS = ['bash', 'sh', 'zsh']
const RUN_TIMEOUT_MS = 20_000
// Why 65 s for the whole merge event: a closer run can still spend 20 s on its deadline-exempt
// `git worktree list`, and both must fit under the hooks' 90 s timeout.
const POST_MERGE_BUDGET_MS = 65_000

// Why: a heredoc body is data, not the command (command_text.py, ORCA-362); the rest of the opener line stays.
const HEREDOC = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1([^\n]*)\n[\s\S]*?^\s*\2\s*$/gm

/** The simple commands of a shell line as word lists, quotes removed; only unquoted ; & | ( ) and newlines split. */
export function simpleCommands(command) {
  const text = command.replace(HEREDOC, '<<HEREDOC$3')
  const commands = []
  let words = []
  let word = null
  let quote = null
  const endWord = () => {
    if (word !== null) {
      words.push(word)
    }
    word = null
  }
  const endCommand = () => {
    endWord()
    if (words.length > 0) {
      commands.push(words)
    }
    words = []
  }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      if (ch === quote) {
        quote = null
      } else if (ch === '\\' && quote === '"' && i + 1 < text.length) {
        word += text[++i]
      } else {
        word += ch
      }
    } else if (ch === "'" || ch === '"') {
      quote = ch
      word ??= ''
    } else if (ch === '\\' && text[i + 1] === '\n') {
      i++
    } else if (ch === '\\' && i + 1 < text.length) {
      word = (word ?? '') + text[++i]
    } else if (';&|()\n'.includes(ch)) {
      endCommand()
    } else if (/\s/.test(ch)) {
      endWord()
    } else {
      word = (word ?? '') + ch
    }
  }
  endCommand()
  return commands
    .map(programWords)
    .flatMap(shellStringCommands)
    .filter((words) => words.length > 0)
}

/** `bash -c '<script>'` (also -lc, sh, zsh) as the commands of its script; any other command as itself. */
function shellStringCommands(words) {
  if (!SHELLS.some((shell) => isProgram(words[0], shell))) {
    return [words]
  }
  for (let i = 1; i < words.length && /^[-+]/.test(words[i]); i++) {
    if (/^-[A-Za-z]*c[A-Za-z]*$/.test(words[i])) {
      return words[i + 1] === undefined ? [] : simpleCommands(words[i + 1])
    }
    if (words[i] === '-o' || words[i] === '+o') {
      i++
    }
  }
  return [words]
}

/** The index of the first word from `from` on that is not a flag or a flag's value. */
function skipFlags(words, from, valueFlags) {
  let i = from
  while (i < words.length && words[i].startsWith('-')) {
    if (words[i] === '--') {
      return i + 1
    }
    i += valueFlags.has(words[i]) ? 2 : 1
  }
  return i
}

function isProgram(word, name) {
  return word !== undefined && (word === name || basename(word) === name)
}

/** The words from the program on: drops `X=1` assignments, `env`/`command` prefixes and wrappers like `timeout 30`. */
function programWords(cmd) {
  let words = cmd
  for (;;) {
    let start = 0
    while (start < words.length && /^\w+=/.test(words[start])) {
      start++
    }
    words = words.slice(start)
    if (isProgram(words[0], 'env')) {
      let i = 1
      while (i < words.length && (words[i].startsWith('-') || /^\w+=/.test(words[i]))) {
        i += ENV_VALUE_FLAGS.has(words[i]) ? 2 : 1
      }
      words = words.slice(i)
    } else if (words[0] === 'command') {
      // Why: `command -v gh` only looks the program up.
      if (words[1] === '-v' || words[1] === '-V') {
        return []
      }
      words = words.slice(words[1] === '-p' ? 2 : 1)
    } else if (words[0] !== undefined && WRAPPER_VALUE_FLAGS.has(basename(words[0]))) {
      const name = basename(words[0])
      const i = skipFlags(words, 1, WRAPPER_VALUE_FLAGS.get(name))
      // Why +1: `timeout` takes its duration before the program.
      words = words.slice(name === 'timeout' ? i + 1 : i)
    } else {
      return words
    }
  }
}

function exec(cmd, args, cwd, timeout) {
  return execFileSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout
  }).trim()
}

/** The first non-flag word from `from` on, skipping the values of `valueFlags`. */
function firstPositional(words, from, valueFlags) {
  for (let i = from; i < words.length; i++) {
    const word = words[i]
    if (word === '--') {
      return words[i + 1] ?? null
    }
    if (!word.startsWith('-')) {
      return word
    }
    if (!word.includes('=') && valueFlags.has(word)) {
      i++
    }
  }
  return null
}

/** PR selectors (number, URL or branch) that `gh pr merge` merges in command position. */
export function mergedPrSelectors(command) {
  return simpleCommands(command)
    .filter((w) => isProgram(w[0], 'gh') && w[1] === 'pr')
    .map((w) => {
      const at = mergeWordIndex(w)
      return at === -1 ? null : firstPositional(w, at + 1, MERGE_VALUE_FLAGS)
    })
    .filter(Boolean)
}

/** Index of `merge` in `gh pr [-R o/r] merge`, or -1. */
function mergeWordIndex(words) {
  let i = 2
  while (words[i]?.startsWith('-')) {
    i += words[i] === '-R' || words[i] === '--repo' ? 2 : 1
  }
  return words[i] === 'merge' ? i : -1
}

/** Whether a raw command line may dispatch a release, matched on its whole text. */
export function isGateTrigger(command) {
  const text = joinContinuations(command)
  return (
    GATE_TRIGGERS.some((pattern) => pattern.test(text)) ||
    (PUSH.test(text) && PUSHES_TAGS.test(text))
  )
}

export function isMergeTrigger(command) {
  return MERGE_TRIGGER.test(joinContinuations(command))
}

// Why: the shell drops a backslash-newline before anything else, so `gh workflow \<newline> run` still runs.
function joinContinuations(command) {
  return command.replace(/\\\r?\n/g, ' ')
}

function expandHome(dir) {
  return dir === '~' || dir.startsWith('~/') ? homedir() + dir.slice(1) : dir
}

/** `git -C` dirs before the subcommand, resolved from `dir`; `dir` itself when there are none. */
function gitDir(words, dir) {
  const dirs = []
  for (let i = 1; i < words.length && words[i].startsWith('-'); i++) {
    if (words[i] === '-C') {
      dirs.push(words[++i] ?? '.')
    } else if (words[i] === '-c') {
      i++
    }
  }
  return { dir: resolve(dir, ...dirs), named: dirs.length > 0 }
}

/**
 * The repo a gated command names (a `cd <dir>` before the triggering command, or `git -C <dir>`),
 * or null when it names none. Best effort: when no single command triggers, the last `cd` wins.
 */
export function gateTargetDir(command, cwd = process.cwd()) {
  let dir = cwd
  let named = false
  for (const words of simpleCommands(command)) {
    if (words[0] === 'cd') {
      const target = words[1] === '--' ? words[2] : words[1]
      if (target !== '-') {
        dir = resolve(dir, expandHome(target ?? '~'))
        named = true
      }
    } else if (isGateTrigger(words.join(' '))) {
      const git = isProgram(words[0], 'git') ? gitDir(words, dir) : { dir, named: false }
      return named || git.named ? git.dir : null
    }
  }
  return named ? dir : null
}

/** One time budget shared by every call a hook event makes. */
export function eventDeadline(budgetMs, now = Date.now) {
  const end = now() + budgetMs
  const remainingMs = () => Math.max(0, end - now())
  return { remainingMs, timeoutMs: (capMs) => Math.min(capMs, remainingMs()) }
}

/** The closer's argv: `args`, the session paths it must never close, its test seams and the time left. */
export function closerArgv(args, sessionCwd, env, deadline = null) {
  return [
    ...args,
    '--skip-path',
    sessionCwd,
    ...(env.ORCA_WORKTREE_CLOSE_PRS_FILE
      ? ['--merged-prs-file', env.ORCA_WORKTREE_CLOSE_PRS_FILE]
      : []),
    ...(env.ORCA_WORKTREE_CLOSE_TERMINALS_FILE
      ? ['--terminals-file', env.ORCA_WORKTREE_CLOSE_TERMINALS_FILE]
      : []),
    // Why: the session may run from a subdirectory while its project is a merged worktree.
    ...(env.CLAUDE_PROJECT_DIR ? ['--skip-path', env.CLAUDE_PROJECT_DIR] : []),
    ...(deadline ? ['--budget-ms', String(Math.max(1, deadline.remainingMs()))] : [])
  ]
}

/** `sessionCwd` is never closed: the session lives there even when the closer runs elsewhere. */
function runCloser(cwd, args, { sessionCwd = cwd, deadline = null } = {}) {
  const lines = []
  const code = closeMergedWorktrees({
    cwd,
    argv: closerArgv(args, sessionCwd, process.env, deadline),
    log: (line) => lines.push(line)
  })
  return { code, lines }
}

/** The head branch of the PR `selector` names, only when it is merged. */
function mergedBranch(cwd, selector, deadline) {
  const url = selector.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/)
  const number = url ? url[2] : /^\d+$/.test(selector) ? selector : null
  const prsFile = process.env.ORCA_WORKTREE_CLOSE_PRS_FILE
  if (prsFile) {
    const prs = JSON.parse(readFileSync(prsFile, 'utf8'))
    if (!number) {
      return prs[selector]?.length ? selector : null
    }
    return (
      Object.entries(prs).find(([, list]) =>
        list.some((pr) => String(pr.number) === number)
      )?.[0] ?? null
    )
  }
  const timeout = () => {
    const ms = deadline.timeoutMs(RUN_TIMEOUT_MS)
    // Why throw: execFileSync reads a 0 timeout as none at all.
    if (ms <= 0) {
      throw new Error('time budget exhausted')
    }
    return ms
  }
  try {
    const slug = url
      ? url[1]
      : githubSlug(exec('git', ['remote', 'get-url', 'origin'], cwd, timeout()))
    if (!slug) {
      return null
    }
    // Why re-read: the merge may have failed, been denied, or only queued auto-merge.
    const pr = JSON.parse(
      exec(
        'gh',
        ['pr', 'view', number ?? selector, '-R', slug, '--json', 'state,headRefName'],
        cwd,
        timeout()
      )
    )
    return pr.state === 'MERGED' ? pr.headRefName : null
  } catch {
    return null
  }
}

// Why the s flag: a removal error from git can span several lines.
const KEPT = /^kept (.+?) \(#(\d+)\): (.+)$/s
const UNVERIFIED = /^unverified(?: (.+?))?: (.*)$/s
const KEPT_REASONS = [
  [/^uncommitted changes (.+)$/, (m) => `tiene cambios sin confirmar (${m[1]})`],
  [
    /^commits after the merged head of (#\d+) (.+)$/,
    (m) => `tiene commits posteriores al head mergeado de ${m[1]} (${m[2]})`
  ],
  [
    /^this session runs inside it (.+)$/,
    (m) => `esta sesión corre dentro de él; ciérralo desde otra sesión (${m[1]})`
  ],
  [
    /^a terminal in it was active (\d+) min ago (.+)$/,
    (m) => `una terminal en él tuvo actividad hace ${m[1]} min (${m[2]})`
  ],
  [
    /^could not read Orca terminals \((.*)\) (.+)$/s,
    (m) => `no se pudieron leer las terminales de Orca (${m[1]}) (${m[2]})`
  ],
  [/^worktree removal failed \((.+?)\): (.*)$/s, (m) => `no se pudo quitar (${m[1]}): ${m[2]}`]
]
const PR_READ_FAILED = /^could not read its PRs \((.*)\)$/s
const UNVERIFIED_REASONS = [
  [PR_READ_FAILED, (m) => `no se pudieron leer sus PRs (${m[1]})`],
  [
    /^merged head of (#\d+) not available locally$/,
    (m) => `el head mergeado de ${m[1]} no está disponible localmente`
  ],
  [/^time budget exhausted$/, () => 'se agotó el tiempo para verificarla'],
  [/^(.+) is not a git repository$/s, (m) => `${m[1]} no es un repositorio git`]
]

function describe(line, pattern, reasons) {
  const match = line.match(pattern)
  if (!match) {
    return null
  }
  const [, subject, reason] = match
  for (const [reasonPattern, describeReason] of reasons) {
    const parsed = reason.match(reasonPattern)
    if (parsed) {
      return `- ${subject ? `${subject}: ` : ''}${describeReason(parsed)}`
    }
  }
  return `- ${line}`
}

function describeKept(line) {
  const kept = line.match(KEPT)
  return kept
    ? describe(`${kept[1]} (#${kept[2]}): ${kept[3]}`, /^(.+?): (.+)$/s, KEPT_REASONS)
    : null
}

// Why neutral: the trigger is raw text, so a gated command may not be a release at all.
const DENIED = 'Comando bloqueado: parece un release y'

export function denyReason(lines) {
  const kept = lines.map(describeKept).filter(Boolean)
  const unverifiedLines = lines.filter((line) => UNVERIFIED.test(line))
  const unverified = unverifiedLines.map((line) => describe(line, UNVERIFIED, UNVERIFIED_REASONS))
  const parts = []
  if (kept.length > 0) {
    parts.push(
      `${DENIED} hay worktrees de PRs mergeados abiertos:`,
      ...kept,
      'Confirma o descarta sus cambios, o cierra esos worktrees, y vuelve a intentarlo.'
    )
  }
  if (unverified.length > 0) {
    const prReadFailed = unverifiedLines.some((line) =>
      PR_READ_FAILED.test(line.match(UNVERIFIED)[2])
    )
    parts.push(
      `${kept.length > 0 ? 'Además:' : DENIED} no se pudo verificar si quedan worktrees mergeadas abiertas:`,
      ...unverified,
      prReadFailed
        ? 'Revisa que `gh` esté autenticado y que el remoto apunte a GitHub, y vuelve a intentarlo.'
        : 'Resuelve cada motivo y vuelve a intentarlo.'
    )
  }
  return parts.length > 0
    ? parts.join('\n')
    : [`${DENIED} el cierre de worktrees lo rechazó:`, ...lines].join('\n')
}

function deny(reason) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason
    }
  }
}

function handle(payload) {
  const event = payload.hook_event_name
  const cwd = resolve(payload.cwd || process.cwd())
  const command = payload.tool_input?.command ?? ''
  if (event === 'SessionStart') {
    const { lines } = runCloser(cwd, [])
    return lines.length
      ? {
          hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext: ['Worktrees de PRs mergeados:', ...lines].join('\n')
          }
        }
      : null
  }
  if (event === 'PostToolUse') {
    return isMergeTrigger(command) ? afterMerge(cwd, command) : null
  }
  if (event !== 'PreToolUse' || !isGateTrigger(command)) {
    return null
  }
  // Why: the release ships the repo it targets, which need not be the session cwd.
  const projectDir = process.env.CLAUDE_PROJECT_DIR
  const target = gateTargetDir(command, cwd) ?? (projectDir ? resolve(projectDir) : cwd)
  let gate
  try {
    gate = runCloser(target, ['--gate'], { sessionCwd: cwd })
  } catch (error) {
    // Why: the gate fails closed; an error here must not let the command through.
    return deny(
      `${DENIED} no se pudo comprobar si quedan worktrees mergeadas abiertas (${String(error?.message ?? error)}).`
    )
  }
  if (gate.code === 1) {
    return deny(denyReason(gate.lines))
  }
  return gate.lines.length ? { systemMessage: gate.lines.join('\n') } : null
}

/** Closes what the merge shipped; with no PR selector it can parse, every merged worktree. */
function afterMerge(cwd, command) {
  // Why the env override: lets a test prove every closer run shares this one budget.
  const budget = Number(process.env.ORCA_WORKTREE_CLOSE_EVENT_BUDGET_MS) || POST_MERGE_BUDGET_MS
  const deadline = eventDeadline(budget)
  const selectors = mergedPrSelectors(command)
  const lines = []
  if (selectors.length === 0) {
    lines.push(...runCloser(cwd, [], { deadline }).lines)
  }
  for (const selector of selectors) {
    const branch = deadline.remainingMs() > 0 ? mergedBranch(cwd, selector, deadline) : null
    if (branch && deadline.remainingMs() > 0) {
      lines.push(...runCloser(cwd, ['--branch', branch], { deadline }).lines)
    }
  }
  return lines.length ? { systemMessage: lines.join('\n') } : null
}

function main() {
  try {
    const output = handle(JSON.parse(readFileSync(0, 'utf8')))
    if (output) {
      process.stdout.write(`${JSON.stringify(output)}\n`)
    }
  } catch {
    // Outside the release gate this is hygiene, and a failure must never cost the tool call.
  }
  process.exitCode = 0
}

if (isMainModule(process.argv[1], import.meta.filename)) {
  main()
}
