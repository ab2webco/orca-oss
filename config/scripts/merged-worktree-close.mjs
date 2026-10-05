#!/usr/bin/env node
// Closes worktrees whose PR merged: removes the worktree, then its local and remote branch.
// Why the head comparison: PRs here squash-merge, so a merged branch is never an
// ancestor of main and `git branch --merged` reports every one of them as open.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

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
    if (!fields.has('worktree') || fields.has('bare') || fields.has('prunable')) {
      continue
    }
    const ref = fields.get('branch')
    worktrees.push({
      path: fields.get('worktree'),
      head: fields.get('HEAD') ?? null,
      branch: ref ? ref.replace(/^refs\/heads\//, '') : null,
      isPrimary: worktrees.length === 0
    })
  }
  return worktrees
}

/**
 * One entry per non-primary worktree whose branch has a merged PR: `close` only
 * when the worktree is clean and its head is exactly what the PR shipped.
 */
export function planWorktreeClose({ worktrees, mergedPrs, dirtyPaths, onlyBranch }) {
  const plan = []
  for (const wt of worktrees) {
    if (wt.isPrimary || !wt.branch || (onlyBranch && wt.branch !== onlyBranch)) {
      continue
    }
    const prs = mergedPrs[wt.branch] ?? []
    if (prs.length === 0) {
      continue
    }
    const shipped = prs.find((pr) => pr.headRefOid === wt.head)
    const base = {
      path: wt.path,
      branch: wt.branch,
      head: wt.head,
      pr: (shipped ?? prs[0]).number
    }
    if (!shipped) {
      plan.push({
        ...base,
        action: 'keep',
        reason: `commits after the merged head of #${prs[0].number}`
      })
    } else if (dirtyPaths.has(wt.path)) {
      plan.push({ ...base, action: 'keep', reason: 'uncommitted changes' })
    } else {
      plan.push({ ...base, action: 'close' })
    }
  }
  return plan
}

function run(cmd, args, cwd) {
  try {
    const stdout = execFileSync(cmd, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      // Why: the Orca CLI is a .cmd shim on Windows, which execFile cannot start without a shell.
      shell: process.platform === 'win32' && cmd !== 'git'
    })
    return { ok: true, stdout: stdout.trim() }
  } catch (error) {
    return {
      ok: false,
      stdout: '',
      stderr: String(error.stderr ?? error.message).trim()
    }
  }
}

function githubSlug(remoteUrl) {
  return remoteUrl.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/)?.[1] ?? null
}

function branchRemote(repo, branch) {
  const configured = run('git', ['config', '--get', `branch.${branch}.remote`], repo)
  return configured.ok && configured.stdout ? configured.stdout : 'origin'
}

/** Merged PRs per branch, read from GitHub; other providers yield none, so nothing closes. */
function fetchMergedPrs(repo, branches) {
  const merged = {}
  for (const branch of branches) {
    const url = run('git', ['remote', 'get-url', branchRemote(repo, branch)], repo)
    const slug = url.ok ? githubSlug(url.stdout) : null
    if (!slug) {
      continue
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
    if (listed.ok && listed.stdout) {
      merged[branch] = JSON.parse(listed.stdout)
    }
  }
  return merged
}

/** The Orca CLI to call, or null: outside Orca's terminals bare `orca` on Linux is the GNOME screen reader. */
export function orcaCliCommand(env) {
  if (env.ORCA_CLI_COMMAND) {
    return env.ORCA_CLI_COMMAND
  }
  return env.ORCA_TERMINAL_HANDLE ? 'orca' : null
}

function removeWorktree(repo, path, remover) {
  const orca = remover === 'git' ? null : orcaCliCommand(process.env)
  if (orca) {
    // Why Orca first: `git worktree remove` alone leaves the card in Orca's sidebar.
    if (run(orca, ['worktree', 'rm', '--worktree', `path:${path}`, '--json'], repo).ok) {
      return { ok: true }
    }
  }
  // No --force: git refuses a dirty tree, a second check after the plan's.
  return run('git', ['worktree', 'remove', path], repo)
}

function closeEntry(repo, entry, remover, log) {
  const remote = branchRemote(repo, entry.branch)
  const removed = removeWorktree(repo, entry.path, remover)
  if (!removed.ok) {
    log(`kept ${entry.branch} (#${entry.pr}): worktree removal failed: ${removed.stderr}`)
    return false
  }
  const local = run('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${entry.branch}`], repo)
  if (local.ok && local.stdout === entry.head) {
    run('git', ['branch', '-D', entry.branch], repo)
  }
  const remoteRef = run('git', ['ls-remote', '--heads', remote, `refs/heads/${entry.branch}`], repo)
  const remoteHead = remoteRef.ok ? remoteRef.stdout.split(/\s/)[0] : ''
  if (remoteHead === entry.head) {
    run('git', ['push', '--quiet', remote, '--delete', entry.branch], repo)
  } else if (remoteHead) {
    log(`remote ${entry.branch} moved after the merge; left on ${remote}`)
  }
  log(`closed ${entry.branch} (#${entry.pr}) ${entry.path}`)
  return true
}

function parseArgs(argv) {
  const options = {
    dryRun: false,
    gate: false,
    remover: 'auto',
    branch: null,
    prsFile: null
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
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }
  return options
}

/** Returns the exit code: 1 under --gate when a merged worktree stays open. */
export function closeMergedWorktrees({ cwd, argv, log }) {
  const options = parseArgs(argv)
  const listed = run('git', ['worktree', 'list', '--porcelain'], cwd)
  if (!listed.ok) {
    return 0
  }
  const worktrees = parseWorktreeList(listed.stdout)
  const repo = worktrees[0]?.path ?? cwd
  const candidates = worktrees.filter(
    (wt) => !wt.isPrimary && wt.branch && (!options.branch || wt.branch === options.branch)
  )
  const mergedPrs = options.prsFile
    ? JSON.parse(readFileSync(options.prsFile, 'utf8'))
    : fetchMergedPrs(
        repo,
        candidates.map((wt) => wt.branch)
      )
  const dirtyPaths = new Set(
    candidates
      .filter((wt) => mergedPrs[wt.branch]?.length)
      .filter((wt) => {
        const status = run('git', ['status', '--porcelain'], wt.path)
        return !status.ok || status.stdout !== ''
      })
      .map((wt) => wt.path)
  )
  let stillOpen = 0
  for (const entry of planWorktreeClose({
    worktrees,
    mergedPrs,
    dirtyPaths,
    onlyBranch: options.branch
  })) {
    if (entry.action === 'keep') {
      log(`kept ${entry.branch} (#${entry.pr}): ${entry.reason} ${entry.path}`)
      stillOpen++
    } else if (options.dryRun) {
      log(`would close ${entry.branch} (#${entry.pr}) ${entry.path}`)
    } else if (!closeEntry(repo, entry, options.remover, log)) {
      stillOpen++
    }
  }
  return options.gate && stillOpen > 0 ? 1 : 0
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  process.exitCode = closeMergedWorktrees({
    cwd: process.cwd(),
    argv: process.argv.slice(2),
    log: (line) => process.stdout.write(`${line}\n`)
  })
}
