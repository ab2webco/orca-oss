#!/usr/bin/env node
// Closes worktrees whose PR merged: removes the worktree, then its local and remote branch.
// Why the head comparison: PRs here squash-merge, so a merged branch is never an
// ancestor of main and `git branch --merged` reports every one of them as open.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'

const RUN_TIMEOUT_MS = 20_000
const ACTIVE_TERMINAL_MS = 10 * 60_000
// Why these budgets: they leave room under the hooks' 90 s timeout, past which the harness kills the gate.
const GATE_BUDGET_MS = 60_000
const DEFAULT_BUDGET_MS = 75_000
const BUDGET_EXHAUSTED = 'time budget exhausted'

// Why module state: a closer run is synchronous and every git/gh/orca call in it shares one deadline.
let deadline = Infinity

function budgetSpent() {
  return deadline - Date.now() <= 0
}

/** Entries of `git worktree list --porcelain`; the first is the primary checkout. */
export function parseWorktreeList(porcelain) {
  const worktrees = []
  for (const block of porcelain.split(/\n\s*\n/)) {
    const fields = new Map()
    for (const line of block.split('\n')) {
      const space = line.indexOf(' ')
      fields.set(
        space === -1 ? line : line.slice(0, space),
        space === -1 ? '' : line.slice(space + 1)
      )
    }
    if (!fields.has('worktree') || fields.has('bare')) {
      continue
    }
    const ref = fields.get('branch')
    worktrees.push({
      path: fields.get('worktree'),
      head: fields.get('HEAD') ?? null,
      branch: ref ? ref.replace(/^refs\/heads\//, '') : null,
      isPrimary: worktrees.length === 0,
      prunable: fields.has('prunable')
    })
  }
  return worktrees
}

function isInside(dir, root) {
  const rel = relative(resolve(root), resolve(dir))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * One entry per non-primary worktree whose branch has a merged PR: `close` only
 * when the worktree is clean, its head is exactly what the PR shipped, no
 * `skipPaths` entry lies inside it and no terminal in it is active. A head that
 * matches no merged head counts as shipped when `behindMerged` names the merged PR it is
 * an ancestor of, and as open when `aheadOfMerged` says it descends from one; otherwise
 * the branch name was reused for unrelated work.
 */
export function planWorktreeClose({
  worktrees,
  mergedPrs,
  dirtyPaths,
  onlyBranch,
  skipPaths = [],
  aheadOfMerged = new Map(),
  behindMerged = new Map(),
  activeTerminals = new Map(),
  terminalsError = null
}) {
  const plan = []
  for (const wt of worktrees) {
    if (wt.isPrimary || !wt.branch || (onlyBranch && wt.branch !== onlyBranch)) {
      continue
    }
    const prs = mergedPrs[wt.branch] ?? []
    if (prs.length === 0) {
      continue
    }
    const shipped = prs.find((pr) => pr.headRefOid === wt.head) ?? behindMerged.get(wt.path)
    if (!shipped && !aheadOfMerged.has(wt.path)) {
      continue
    }
    const base = {
      path: wt.path,
      branch: wt.branch,
      head: wt.head,
      pr: shipped ? shipped.number : aheadOfMerged.get(wt.path)
    }
    if (!shipped) {
      plan.push({ ...base, action: 'keep', reason: `commits after the merged head of #${base.pr}` })
    } else if (dirtyPaths.has(wt.path)) {
      plan.push({ ...base, action: 'keep', reason: 'uncommitted changes' })
    } else if (skipPaths.some((dir) => isInside(dir, wt.path))) {
      // Why: removing the worktree an agent session lives in breaks that session.
      plan.push({ ...base, action: 'keep', reason: 'this session runs inside it' })
    } else if (terminalsError) {
      plan.push({
        ...base,
        action: 'keep',
        reason: `could not read Orca terminals (${terminalsError})`
      })
    } else if (activeTerminals.has(wt.path)) {
      plan.push({
        ...base,
        action: 'keep',
        reason: `a terminal in it was active ${activeTerminals.get(wt.path)} min ago`
      })
    } else {
      plan.push({ ...base, action: 'close' })
    }
  }
  return plan
}

/** One cmd.exe-safe argument: MSVCRT quoting, so embedded quotes and trailing backslashes survive. */
export function windowsShellArg(value) {
  const escaped = value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1')
  return `"${escaped}"`
}

export function windowsShellCommand(command) {
  return /\s/.test(command) ? windowsShellArg(command) : command
}

function failureReason(error, timeout) {
  if (error.code === 'ETIMEDOUT' || error.signal === 'SIGTERM') {
    return `timed out after ${timeout / 1000}s`
  }
  return String(error.stderr || error.message).trim()
}

/** `budget: false` exempts a call from the deadline, never from the per-call timeout. */
function run(cmd, args, cwd, { shell = false, budget = true } = {}) {
  const timeout = budget ? Math.min(RUN_TIMEOUT_MS, deadline - Date.now()) : RUN_TIMEOUT_MS
  if (timeout <= 0) {
    return { ok: false, stdout: '', stderr: BUDGET_EXHAUSTED }
  }
  try {
    const stdout = execFileSync(cmd, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout,
      shell
    })
    return { ok: true, stdout: stdout.trim() }
  } catch (error) {
    // Why keep stdout: `orca ... --json` prints its error there, not on stderr.
    return {
      ok: false,
      stdout: String(error.stdout ?? '').trim(),
      stderr: failureReason(error, timeout)
    }
  }
}

function runOrca(orca, args, cwd) {
  // Why: the Orca CLI is a .cmd shim on Windows, which execFile cannot start without a shell.
  if (process.platform === 'win32') {
    return run(windowsShellCommand(orca), args.map(windowsShellArg), cwd, { shell: true })
  }
  return run(orca, args, cwd)
}

function oneLine(text) {
  return text.replace(/\s+/g, ' ').trim()
}

/** The error of a failed Orca CLI call: with --json it is a JSON envelope on stdout. */
function orcaError(result) {
  try {
    const error = JSON.parse(result.stdout).error
    if (typeof error?.code === 'string') {
      return { code: error.code, message: oneLine(String(error.message ?? error.code)) }
    }
  } catch {
    // Not JSON: the failure is in stderr (timeout, missing binary, plain-text CLI output).
  }
  const message = oneLine(result.stderr ?? '')
  return { code: message === 'selector_not_found' ? message : null, message }
}

/**
 * What to do after `orca worktree rm`. Only Orca saying it does not know the worktree
 * (`selector_not_found`, src/main/runtime/orca-runtime.ts resolveWorktreeSelector) hands
 * the removal to git; any other refusal stands, since Orca refuses for reasons git cannot see.
 */
export function orcaRemovalDecision(result) {
  if (result.ok) {
    return { action: 'removed' }
  }
  const error = orcaError(result)
  return error.code === 'selector_not_found'
    ? { action: 'git' }
    : { action: 'fail', error: error.message }
}

export function githubSlug(remoteUrl) {
  return remoteUrl.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/)?.[1] ?? null
}

function branchRemote(repo, branch) {
  const configured = run('git', ['config', '--get', `branch.${branch}.remote`], repo)
  return configured.ok && configured.stdout ? configured.stdout : 'origin'
}

function readMergedPrs(repo, branch) {
  const remote = branchRemote(repo, branch)
  const url = run('git', ['remote', 'get-url', remote], repo)
  if (!url.ok) {
    return { error: `remote ${remote}: ${oneLine(url.stderr)}` }
  }
  const slug = githubSlug(url.stdout)
  if (!slug) {
    return { error: `remote ${remote} is not a GitHub URL` }
  }
  const listed = run(
    'gh',
    [
      'pr',
      'list',
      '-R',
      slug,
      '--state',
      'merged',
      '--head',
      branch,
      '--json',
      'number,headRefOid'
    ],
    repo
  )
  if (!listed.ok) {
    return { error: `gh: ${oneLine(listed.stderr).slice(0, 200)}` }
  }
  try {
    const prs = JSON.parse(listed.stdout)
    return Array.isArray(prs) ? { prs } : { error: 'gh returned no PR list' }
  } catch {
    return { error: 'gh returned unparseable JSON' }
  }
}

/** Merged PRs per branch from GitHub, plus the branches it could not verify and why. */
function fetchMergedPrs(repo, branches) {
  const merged = {}
  const unverified = new Map()
  for (const branch of branches) {
    if (budgetSpent()) {
      unverified.set(branch, BUDGET_EXHAUSTED)
      continue
    }
    const { prs, error } = readMergedPrs(repo, branch)
    if (error) {
      unverified.set(branch, budgetSpent() ? BUDGET_EXHAUSTED : `could not read its PRs (${error})`)
    } else if (prs.length > 0) {
      merged[branch] = prs
    }
  }
  return { merged, unverified }
}

/** The Orca CLI to call, or null: outside Orca's terminals bare `orca` on Linux is the GNOME screen reader. */
export function orcaCliCommand(env) {
  if (env.ORCA_CLI_COMMAND) {
    return env.ORCA_CLI_COMMAND
  }
  return env.ORCA_TERMINAL_HANDLE ? 'orca' : null
}

function parseTerminals(text, pick) {
  try {
    const terminals = pick(JSON.parse(text))
    return Array.isArray(terminals) ? { terminals } : { error: 'no terminal list' }
  } catch {
    return { error: 'unparseable JSON' }
  }
}

/** `{ terminals }`, or `{ error }` when an Orca CLI is configured but its terminals cannot be read. */
function readTerminals(repo, terminalsFile) {
  if (terminalsFile) {
    let text
    try {
      text = readFileSync(terminalsFile, 'utf8')
    } catch (error) {
      return { error: oneLine(error.message) }
    }
    return parseTerminals(text, (list) => list)
  }
  const orca = orcaCliCommand(process.env)
  if (!orca) {
    return { terminals: [] }
  }
  const listed = runOrca(orca, ['terminal', 'list', '--json'], repo)
  if (!listed.ok) {
    return { error: orcaError(listed).message.slice(0, 200) }
  }
  return parseTerminals(listed.stdout, (output) => output.result?.terminals)
}

/** Worktree path -> minutes since its most recent output, for terminals still producing output. */
function activeTerminalsByWorktree(worktrees, terminals, now) {
  const active = new Map()
  for (const terminal of terminals) {
    const idleMs = now - Number(terminal.lastOutputAt)
    if (
      terminal.liveness !== 'running' ||
      !terminal.worktreePath ||
      !(idleMs <= ACTIVE_TERMINAL_MS)
    ) {
      continue
    }
    const dir = realPath(terminal.worktreePath)
    const minutes = Math.max(0, Math.floor(idleMs / 60_000))
    for (const wt of worktrees) {
      if (isInside(dir, wt.path) && (!active.has(wt.path) || minutes < active.get(wt.path))) {
        active.set(wt.path, minutes)
      }
    }
  }
  return active
}

function removeWorktree(repo, path, remover) {
  const orca = remover === 'git' ? null : orcaCliCommand(process.env)
  if (orca) {
    // Why Orca first: `git worktree remove` alone leaves the card in Orca's sidebar.
    const decision = orcaRemovalDecision(
      runOrca(orca, ['worktree', 'rm', '--worktree', `path:${path}`, '--json'], repo)
    )
    if (decision.action === 'removed') {
      return { ok: true }
    }
    if (decision.action === 'fail') {
      return { ok: false, stderr: decision.error }
    }
  }
  // No --force: git refuses a dirty tree, a second check after the plan's.
  return run('git', ['worktree', 'remove', path], repo)
}

/** Deletes the remote branch only while it still points at `expectedHead`. */
export function deleteRemoteBranch(repo, remote, branch, expectedHead) {
  return run(
    'git',
    [
      'push',
      '--quiet',
      `--force-with-lease=refs/heads/${branch}:${expectedHead}`,
      remote,
      '--delete',
      branch
    ],
    repo
  )
}

/** `mergedHead` is the head the PR shipped: a worktree behind it leaves the remote there. */
function closeEntry(repo, entry, mergedHead, remover, log) {
  const remote = branchRemote(repo, entry.branch)
  const removed = removeWorktree(repo, entry.path, remover)
  if (!removed.ok) {
    log(
      `kept ${entry.branch} (#${entry.pr}): worktree removal failed (${entry.path}): ${removed.stderr}`
    )
    return false
  }
  const notes = []
  const local = run('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${entry.branch}`], repo)
  if (local.ok && local.stdout === entry.head) {
    const deleted = run('git', ['branch', '-D', entry.branch], repo)
    if (!deleted.ok) {
      notes.push(`local branch not deleted: ${oneLine(deleted.stderr)}`)
    }
  }
  const remoteRef = run('git', ['ls-remote', '--heads', remote, `refs/heads/${entry.branch}`], repo)
  const remoteHead = remoteRef.ok ? remoteRef.stdout.split(/\s/)[0] : ''
  if (!remoteRef.ok) {
    notes.push(`remote branch not deleted: ${oneLine(remoteRef.stderr)}`)
  } else if (remoteHead && (remoteHead === entry.head || remoteHead === mergedHead)) {
    const deleted = deleteRemoteBranch(repo, remote, entry.branch, remoteHead)
    if (!deleted.ok) {
      notes.push(`remote branch not deleted: ${oneLine(deleted.stderr)}`)
    }
  } else if (remoteHead) {
    log(`remote ${entry.branch} moved after the merge; left on ${remote}`)
  }
  log([`closed ${entry.branch} (#${entry.pr}) ${entry.path}`, ...notes].join('; '))
  return true
}

// Why: git reports resolved paths (macOS /var is /private/var), so a symlinked cwd would never match.
function realPath(path) {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

function parseArgs(argv) {
  const options = {
    dryRun: false,
    gate: false,
    remover: 'auto',
    branch: null,
    prsFile: null,
    terminalsFile: null,
    budgetMs: null,
    skipPaths: []
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--dry-run') {
      options.dryRun = true
    } else if (arg === '--gate') {
      options.gate = true
    } else if (arg === '--remover') {
      options.remover = argv[++i]
    } else if (arg === '--branch') {
      options.branch = argv[++i]
    } else if (arg === '--merged-prs-file') {
      options.prsFile = argv[++i]
    } else if (arg === '--terminals-file') {
      options.terminalsFile = argv[++i]
    } else if (arg === '--budget-ms') {
      options.budgetMs = Number(argv[++i])
      if (!Number.isInteger(options.budgetMs) || options.budgetMs <= 0) {
        throw new Error(`--budget-ms needs a positive integer, got ${argv[i]}`)
      }
    } else if (arg === '--skip-path') {
      options.skipPaths.push(realPath(argv[++i]))
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }
  return options
}

function hasCommit(repo, oid) {
  return run('git', ['cat-file', '-e', `${oid}^{commit}`], repo).ok
}

/** Whether the PR's merged head is here, fetching it once into FETCH_HEAD only: GitHub keeps refs/pull/<N>/head. */
function ensureMergedHead(repo, branch, pr) {
  if (hasCommit(repo, pr.headRefOid)) {
    return true
  }
  run('git', ['fetch', '--quiet', branchRemote(repo, branch), `refs/pull/${pr.number}/head`], repo)
  return hasCommit(repo, pr.headRefOid)
}

/**
 * How the worktree head relates to its branch's merged heads: `behind` one (all it has
 * shipped), `ahead` of one (commits after the merge), `missing` (a merged head git cannot
 * get, so nothing can be told) or `unrelated` (a reused branch name).
 */
function relateToMergedHeads(repo, wt, prs) {
  let ahead = null
  let missing = null
  for (const pr of prs) {
    if (!ensureMergedHead(repo, wt.branch, pr)) {
      missing ??= pr
    } else if (run('git', ['merge-base', '--is-ancestor', wt.head, pr.headRefOid], repo).ok) {
      return { kind: 'behind', pr }
    } else if (
      !ahead &&
      run('git', ['merge-base', '--is-ancestor', pr.headRefOid, wt.head], repo).ok
    ) {
      ahead = pr
    }
  }
  if (ahead) {
    return { kind: 'ahead', pr: ahead }
  }
  return missing ? { kind: 'missing', pr: missing } : { kind: 'unrelated' }
}

function isDirty(wt) {
  // Why --untracked-files=all: status.showUntrackedFiles=no would hide new files.
  const status = run('git', ['status', '--porcelain', '--untracked-files=all'], wt.path)
  return !status.ok || status.stdout !== ''
}

/** Returns the exit code: 1 under --gate when a merged worktree stays open or a branch is unverified. */
export function closeMergedWorktrees({ cwd, argv, log }) {
  const options = parseArgs(argv)
  deadline = Date.now() + (options.budgetMs ?? (options.gate ? GATE_BUDGET_MS : DEFAULT_BUDGET_MS))
  try {
    return closeWithinBudget(cwd, options, log)
  } finally {
    deadline = Infinity
  }
}

function closeWithinBudget(cwd, options, log) {
  // Why outside the budget: without the list there are no branches to report as unverified.
  const listed = run('git', ['worktree', 'list', '--porcelain'], cwd, { budget: false })
  if (!listed.ok) {
    if (options.gate) {
      log(`unverified: ${cwd} is not a git repository`)
      return 1
    }
    return 0
  }
  const worktrees = parseWorktreeList(listed.stdout)
  const repo = worktrees[0]?.path ?? cwd
  const candidates = []
  for (const wt of worktrees) {
    if (wt.isPrimary || !wt.branch || (options.branch && wt.branch !== options.branch)) {
      continue
    }
    // Why: Git < 2.31 has no prunable flag, so a deleted directory still lists as a worktree.
    if (wt.prunable || !existsSync(wt.path)) {
      log(`skipped ${wt.branch}: directory missing; run git worktree prune`)
    } else {
      candidates.push(wt)
    }
  }
  const { merged: mergedPrs, unverified } = options.prsFile
    ? { merged: JSON.parse(readFileSync(options.prsFile, 'utf8')), unverified: new Map() }
    : fetchMergedPrs(
        repo,
        candidates.map((wt) => wt.branch)
      )
  let checked = []
  const dirtyPaths = new Set()
  const aheadOfMerged = new Map()
  const behindMerged = new Map()
  for (const wt of candidates.filter((c) => mergedPrs[c.branch]?.length)) {
    const prs = mergedPrs[wt.branch]
    const relation = prs.some((pr) => pr.headRefOid === wt.head)
      ? { kind: 'shipped' }
      : budgetSpent()
        ? null
        : relateToMergedHeads(repo, wt, prs)
    const dirty = relation && relation.kind !== 'unrelated' && !budgetSpent() && isDirty(wt)
    // Why re-check after the calls: one cut short by the deadline reads as a false answer.
    if (!relation || budgetSpent()) {
      unverified.set(wt.branch, BUDGET_EXHAUSTED)
      continue
    }
    if (relation.kind === 'missing') {
      unverified.set(wt.branch, `merged head of #${relation.pr.number} not available locally`)
      continue
    }
    if (relation.kind === 'ahead') {
      aheadOfMerged.set(wt.path, relation.pr.number)
    } else if (relation.kind === 'behind') {
      behindMerged.set(wt.path, relation.pr)
    }
    if (dirty) {
      dirtyPaths.add(wt.path)
    }
    checked.push(wt)
  }
  const { terminals = [], error: terminalsError = null } = checked.length
    ? readTerminals(repo, options.terminalsFile)
    : {}
  if (budgetSpent()) {
    for (const wt of checked) {
      unverified.set(wt.branch, BUDGET_EXHAUSTED)
    }
    checked = []
  }
  let stillOpen = 0
  for (const entry of planWorktreeClose({
    worktrees: checked,
    mergedPrs,
    dirtyPaths,
    onlyBranch: options.branch,
    skipPaths: [...options.skipPaths, realPath(cwd)],
    aheadOfMerged,
    behindMerged,
    activeTerminals: activeTerminalsByWorktree(checked, terminals, Date.now()),
    terminalsError
  })) {
    if (entry.action === 'keep') {
      log(`kept ${entry.branch} (#${entry.pr}): ${entry.reason} ${entry.path}`)
      stillOpen++
    } else if (options.dryRun) {
      log(`would close ${entry.branch} (#${entry.pr}) ${entry.path}`)
    } else if (budgetSpent()) {
      unverified.set(entry.branch, BUDGET_EXHAUSTED)
    } else {
      const mergedHead = (behindMerged.get(entry.path) ?? { headRefOid: entry.head }).headRefOid
      if (!closeEntry(repo, entry, mergedHead, options.remover, log)) {
        stillOpen++
      }
    }
  }
  if (options.gate) {
    for (const [branch, reason] of unverified) {
      log(`unverified ${branch}: ${reason}`)
    }
  }
  return options.gate && (stillOpen > 0 || unverified.size > 0) ? 1 : 0
}

// Why realpath: Node resolves the main module's symlinks, but argv[1] keeps the path as typed.
export function isMainModule(argv1, filename) {
  return Boolean(argv1) && realPath(argv1) === realPath(filename)
}

if (isMainModule(process.argv[1], import.meta.filename)) {
  process.exitCode = closeMergedWorktrees({
    cwd: process.cwd(),
    argv: process.argv.slice(2),
    log: (line) => process.stdout.write(`${line}\n`)
  })
}
