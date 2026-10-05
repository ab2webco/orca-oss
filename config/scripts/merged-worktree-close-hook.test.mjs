import { execFileSync, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const projectDir = resolve(import.meta.dirname, '../..')
const hookScript = join(projectDir, '.claude/hooks/merged-worktree-close-hook.mjs')
const settingsPath = join(projectDir, '.claude/settings.json')
const hookCommand = 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/merged-worktree-close-hook.mjs"'
const tempDirs = []

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

function git(cwd, ...args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@example.com',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@example.com'
    }
  }).trim()
}

/** A clone of a bare origin; `addFeature` pushes a branch checked out in its own worktree. */
function makeRepo() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orca-wt-close-hook-')))
  tempDirs.push(root)
  const origin = join(root, 'origin.git')
  const repo = join(root, 'repo')
  git(root, 'init', '--bare', '-q', '-b', 'main', origin)
  git(root, 'clone', '-q', origin, repo)
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'base')
  git(repo, 'push', '-q', 'origin', 'HEAD:main')
  const addFeature = (branch) => {
    const path = join(root, branch.replaceAll('/', '-'))
    git(repo, 'worktree', 'add', '-q', '-b', branch, path)
    writeFileSync(join(path, 'work.txt'), branch)
    git(path, 'add', 'work.txt')
    git(path, 'commit', '-q', '-m', branch)
    git(path, 'push', '-q', '-u', 'origin', branch)
    return { path, head: git(path, 'rev-parse', 'HEAD') }
  }
  return { root, origin, repo, addFeature }
}

function writeJson(dir, value) {
  const file = join(dir, `data-${Math.random().toString(36).slice(2)}.json`)
  writeFileSync(file, JSON.stringify(value))
  return file
}

/** `prs` null leaves the PR lookup to the real remote; `extraEnv` adds hook environment. */
function runHook(root, payload, prs, { extraEnv = {}, script = hookScript } = {}) {
  const env = { ...process.env, ...extraEnv }
  if (prs) {
    env.ORCA_WORKTREE_CLOSE_PRS_FILE = writeJson(root, prs)
  }
  // Why: inside an Orca terminal the closer would remove through the Orca app, not this temp repo's git.
  delete env.ORCA_TERMINAL_HANDLE
  delete env.ORCA_CLI_COMMAND
  if (!('CLAUDE_PROJECT_DIR' in extraEnv)) {
    delete env.CLAUDE_PROJECT_DIR
  }
  const result = spawnSync('node', [script], {
    cwd: payload.cwd,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env
  })
  return { ...result, json: result.stdout.trim() ? JSON.parse(result.stdout) : null }
}

describe('release gate trigger', () => {
  let shared = null
  // Why one repo: a gated command is denied and leaves the dirty merged worktree as it was.
  function dirtyMergedRepo() {
    if (!shared) {
      const made = makeRepo()
      const feature = made.addFeature('fix/a')
      writeFileSync(join(feature.path, 'draft.txt'), 'unsaved')
      shared = { ...made, prs: { 'fix/a': [{ number: 12, headRefOid: feature.head }] } }
    }
    return shared
  }
  function preToolUse(command) {
    const { root, repo, prs } = dirtyMergedRepo()
    const payload = { hook_event_name: 'PreToolUse', cwd: repo }
    return runHook(
      root,
      { ...payload, tool_input: { command: command.replace('REPO', repo) } },
      prs
    )
  }

  it.each([
    'cd REPO && \\\n gh workflow run lab-release.yml',
    'if true; then gh workflow run "Lab Release"; fi',
    '{ gh workflow run lab-release.yml; }',
    '! gh workflow run x',
    'gh -R ab2webco/orca-oss workflow run lab-release.yml',
    'gh -R x release create mobile-ios-v1',
    'gh release new mobile-android-v1',
    "bash -euo pipefail -c 'gh workflow run lab-release.yml'",
    "bash <<'EOF'\ngh workflow run lab-release.yml\nEOF",
    "git push origin '*'",
    // Why gated: a false positive only runs the gate, which denies while a merged worktree is open.
    'grep "workflow run" docs'
  ])('gates %j', (command) => {
    const result = preToolUse(command)

    expect(result.status, result.stderr).toBe(0)
    const output = result.json?.hookSpecificOutput
    expect(output?.permissionDecision).toBe('deny')
    expect(output?.permissionDecisionReason).toMatch(
      /^Comando bloqueado: parece un release y hay worktrees de PRs mergeados abiertos:/
    )
    expect(output?.permissionDecisionReason).toContain('- fix/a (#12): tiene cambios sin confirmar')
  })

  it.each(['ls', 'npm test', 'git status', 'git push origin feat/x', 'gh pr list'])(
    'leaves %j alone without running the gate',
    (command) => {
      const result = preToolUse(command)

      expect(result.status, result.stderr).toBe(0)
      expect(result.stdout).toBe('')
    }
  )

  it('lets a false positive run when no merged worktree is open', () => {
    const { root, repo } = makeRepo()

    const result = runHook(
      root,
      {
        hook_event_name: 'PreToolUse',
        cwd: repo,
        tool_input: { command: 'grep "workflow run" docs' }
      },
      {}
    )

    expect(result.status, result.stderr).toBe(0)
    expect(result.json?.hookSpecificOutput?.permissionDecision).toBeUndefined()
  })
})

describe('merged-worktree-close hook', () => {
  it('denies a release while a merged worktree keeps uncommitted work, naming it', () => {
    const { root, repo, addFeature } = makeRepo()
    const feature = addFeature('fix/a')
    writeFileSync(join(feature.path, 'draft.txt'), 'unsaved')

    const result = runHook(
      root,
      {
        hook_event_name: 'PreToolUse',
        cwd: repo,
        tool_input: { command: 'gh workflow run "Lab Release" --ref main' }
      },
      { 'fix/a': [{ number: 12, headRefOid: feature.head }] }
    )

    expect(result.status, result.stderr).toBe(0)
    const output = result.json?.hookSpecificOutput
    expect(output?.hookEventName).toBe('PreToolUse')
    expect(output?.permissionDecision).toBe('deny')
    expect(output?.permissionDecisionReason).toContain('fix/a')
    expect(output?.permissionDecisionReason).toContain('#12')
    expect(output?.permissionDecisionReason).toContain(feature.path)
    expect(output?.permissionDecisionReason).toContain('cambios sin confirmar')
    expect(output?.permissionDecisionReason).not.toMatch(
      /\b(tenés|podés|cerralo|confirmá|descartá)\b/
    )
    expect(existsSync(join(feature.path, 'draft.txt'))).toBe(true)
  })

  it('closes a clean merged worktree before a release and lets it run', () => {
    const { root, repo, origin, addFeature } = makeRepo()
    const feature = addFeature('fix/a')

    const result = runHook(
      root,
      {
        hook_event_name: 'PreToolUse',
        cwd: repo,
        tool_input: { command: 'git push origin mobile-ios-v1.2.3' }
      },
      { 'fix/a': [{ number: 12, headRefOid: feature.head }] }
    )

    expect(result.status, result.stderr).toBe(0)
    expect(result.json?.hookSpecificOutput?.permissionDecision).toBeUndefined()
    expect(result.json?.systemMessage).toContain(`closed fix/a (#12) ${feature.path}`)
    expect(existsSync(feature.path)).toBe(false)
    expect(git(origin, 'branch', '--list', 'fix/a')).toBe('')
  })

  it('does nothing for a command that is not a release', () => {
    const { root, repo, addFeature } = makeRepo()
    const feature = addFeature('fix/a')

    const result = runHook(
      root,
      {
        hook_event_name: 'PreToolUse',
        cwd: repo,
        tool_input: { command: 'git push origin fix/a' }
      },
      { 'fix/a': [{ number: 12, headRefOid: feature.head }] }
    )

    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toBe('')
    expect(existsSync(feature.path)).toBe(true)
  })

  it('after a merge closes only the merged branch worktree', () => {
    const { root, repo, addFeature } = makeRepo()
    const merged = addFeature('fix/a')
    const other = addFeature('fix/b')

    const result = runHook(
      root,
      {
        hook_event_name: 'PostToolUse',
        cwd: repo,
        tool_input: { command: 'gh pr merge 12 --squash' }
      },
      {
        'fix/a': [{ number: 12, headRefOid: merged.head }],
        'fix/b': [{ number: 13, headRefOid: other.head }]
      }
    )

    expect(result.status, result.stderr).toBe(0)
    expect(result.json?.systemMessage).toContain(`closed fix/a (#12) ${merged.path}`)
    expect(existsSync(merged.path)).toBe(false)
    expect(existsSync(other.path)).toBe(true)
  })

  it('after a merge split by a line continuation closes only the merged branch worktree', () => {
    const { root, repo, addFeature } = makeRepo()
    const merged = addFeature('fix/a')
    const other = addFeature('fix/b')

    const result = runHook(
      root,
      { hook_event_name: 'PostToolUse', cwd: repo, tool_input: { command: 'gh pr \\\n merge 12' } },
      {
        'fix/a': [{ number: 12, headRefOid: merged.head }],
        'fix/b': [{ number: 13, headRefOid: other.head }]
      }
    )

    expect(result.status, result.stderr).toBe(0)
    expect(result.json?.systemMessage).toContain(`closed fix/a (#12) ${merged.path}`)
    expect(existsSync(merged.path)).toBe(false)
    expect(existsSync(other.path)).toBe(true)
  })

  it('after a merge it cannot parse closes every merged worktree', () => {
    const { root, repo, addFeature } = makeRepo()
    const a = addFeature('fix/a')
    const b = addFeature('fix/b')

    const result = runHook(
      root,
      {
        hook_event_name: 'PostToolUse',
        cwd: repo,
        tool_input: { command: "bash <<'EOF'\ngh pr merge 12\nEOF" }
      },
      {
        'fix/a': [{ number: 12, headRefOid: a.head }],
        'fix/b': [{ number: 13, headRefOid: b.head }]
      }
    )

    expect(result.status, result.stderr).toBe(0)
    expect(result.json?.systemMessage).toContain(`closed fix/a (#12) ${a.path}`)
    expect(result.json?.systemMessage).toContain(`closed fix/b (#13) ${b.path}`)
  })

  it('stops closing once the merge event has used its time budget', () => {
    const { root, repo, addFeature } = makeRepo()
    const feature = addFeature('fix/a')

    const result = runHook(
      root,
      {
        hook_event_name: 'PostToolUse',
        cwd: repo,
        tool_input: { command: "bash <<'EOF'\ngh pr merge 12\nEOF" }
      },
      { 'fix/a': [{ number: 12, headRefOid: feature.head }] },
      { extraEnv: { ORCA_WORKTREE_CLOSE_EVENT_BUDGET_MS: '1' } }
    )

    expect(result.status, result.stderr).toBe(0)
    expect(existsSync(feature.path)).toBe(true)
  })

  it('ignores a merge command whose PR is not merged', () => {
    const { root, repo, addFeature } = makeRepo()
    const feature = addFeature('fix/a')

    const result = runHook(
      root,
      { hook_event_name: 'PostToolUse', cwd: repo, tool_input: { command: 'gh pr merge 99' } },
      { 'fix/a': [{ number: 12, headRefOid: feature.head }] }
    )

    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toBe('')
    expect(existsSync(feature.path)).toBe(true)
  })

  it('keeps the merged worktree the session runs inside', () => {
    const { root, addFeature } = makeRepo()
    const feature = addFeature('fix/a')
    const sessionDir = join(feature.path, 'src')
    mkdirSync(sessionDir)

    const result = runHook(
      root,
      {
        hook_event_name: 'PostToolUse',
        cwd: sessionDir,
        tool_input: { command: 'gh pr merge 12' }
      },
      { 'fix/a': [{ number: 12, headRefOid: feature.head }] }
    )

    expect(result.status, result.stderr).toBe(0)
    expect(result.json?.systemMessage).toContain(
      `kept fix/a (#12): this session runs inside it ${feature.path}`
    )
    expect(existsSync(feature.path)).toBe(true)
  })

  it('at session start closes every merged worktree and tells the agent', () => {
    const { root, repo, addFeature } = makeRepo()
    const a = addFeature('fix/a')
    const b = addFeature('fix/b')

    const result = runHook(
      root,
      { hook_event_name: 'SessionStart', cwd: repo },
      {
        'fix/a': [{ number: 12, headRefOid: a.head }],
        'fix/b': [{ number: 13, headRefOid: b.head }]
      }
    )

    expect(result.status, result.stderr).toBe(0)
    const output = result.json?.hookSpecificOutput
    expect(output?.hookEventName).toBe('SessionStart')
    expect(output?.additionalContext).toMatch(/^Worktrees de PRs mergeados:/)
    expect(output?.additionalContext).toContain(`closed fix/a (#12) ${a.path}`)
    expect(output?.additionalContext).toContain(`closed fix/b (#13) ${b.path}`)
    expect(existsSync(a.path)).toBe(false)
    expect(existsSync(b.path)).toBe(false)
  })

  it.each([
    'gh pr merge --squash 12',
    'gh pr merge -s -d 12',
    'gh pr merge fix/a --squash',
    'gh pr merge https://github.com/o/r/pull/12'
  ])('after %j closes the merged worktree', (command) => {
    const { root, repo, addFeature } = makeRepo()
    const feature = addFeature('fix/a')

    const result = runHook(
      root,
      { hook_event_name: 'PostToolUse', cwd: repo, tool_input: { command } },
      { 'fix/a': [{ number: 12, headRefOid: feature.head }] }
    )

    expect(result.status, result.stderr).toBe(0)
    expect(result.json?.systemMessage).toContain(`closed fix/a (#12) ${feature.path}`)
    expect(existsSync(feature.path)).toBe(false)
  })

  it('never closes the worktree CLAUDE_PROJECT_DIR points at', () => {
    const { root, repo, addFeature } = makeRepo()
    const feature = addFeature('fix/a')

    const result = runHook(
      root,
      { hook_event_name: 'SessionStart', cwd: repo },
      { 'fix/a': [{ number: 12, headRefOid: feature.head }] },
      { extraEnv: { CLAUDE_PROJECT_DIR: feature.path } }
    )

    expect(result.status, result.stderr).toBe(0)
    expect(result.json?.hookSpecificOutput?.additionalContext).toContain(
      `kept fix/a (#12): this session runs inside it ${feature.path}`
    )
    expect(existsSync(feature.path)).toBe(true)
  })

  it('keeps a merged worktree with an active terminal from the terminals seam', () => {
    const { root, repo, addFeature } = makeRepo()
    const feature = addFeature('fix/a')
    const terminals = writeJson(root, [
      { worktreePath: feature.path, liveness: 'running', lastOutputAt: Date.now() }
    ])

    const result = runHook(
      root,
      { hook_event_name: 'SessionStart', cwd: repo },
      { 'fix/a': [{ number: 12, headRefOid: feature.head }] },
      { extraEnv: { ORCA_WORKTREE_CLOSE_TERMINALS_FILE: terminals } }
    )

    expect(result.json?.hookSpecificOutput?.additionalContext).toContain(
      'kept fix/a (#12): a terminal in it was active 0 min ago'
    )
    expect(existsSync(feature.path)).toBe(true)
  })

  it('denies a release naming a locked merged worktree it could not remove', () => {
    const { root, repo, addFeature } = makeRepo()
    const feature = addFeature('fix/a')
    git(repo, 'worktree', 'lock', '--reason', 'in use', feature.path)

    const result = runHook(
      root,
      {
        hook_event_name: 'PreToolUse',
        cwd: repo,
        tool_input: { command: 'gh workflow run "Lab Release"' }
      },
      { 'fix/a': [{ number: 12, headRefOid: feature.head }] }
    )

    const output = result.json?.hookSpecificOutput
    expect(output?.permissionDecision).toBe('deny')
    expect(output?.permissionDecisionReason).toContain('Comando bloqueado')
    expect(output?.permissionDecisionReason).toContain(
      `- fix/a (#12): no se pudo quitar (${feature.path}): `
    )
    expect(output?.permissionDecisionReason).toContain('locked')
    expect(output?.permissionDecisionReason).not.toContain('kept fix/a')
    expect(existsSync(feature.path)).toBe(true)
  })

  it('denies a release when it cannot read the PRs of a worktree branch, saying why', () => {
    const { root, repo, addFeature } = makeRepo()
    const feature = addFeature('fix/a')

    const result = runHook(
      root,
      {
        hook_event_name: 'PreToolUse',
        cwd: repo,
        tool_input: { command: 'gh workflow run "Lab Release"' }
      },
      null
    )

    const output = result.json?.hookSpecificOutput
    expect(output?.permissionDecision).toBe('deny')
    expect(output?.permissionDecisionReason).toContain('no se pudo verificar')
    expect(output?.permissionDecisionReason).toContain('fix/a')
    expect(output?.permissionDecisionReason).toContain('not a GitHub URL')
    expect(output?.permissionDecisionReason).not.toContain('tienen su PR mergeado')
    expect(existsSync(feature.path)).toBe(true)
  })

  function notARepo() {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'orca-wt-close-norepo-')))
    tempDirs.push(dir)
    return dir
  }

  const releasePayload = (cwd, command = 'gh workflow run "Lab Release"') => ({
    hook_event_name: 'PreToolUse',
    cwd,
    tool_input: { command }
  })

  it('gates the CLAUDE_PROJECT_DIR repo when the session cwd is not a repository', () => {
    const { root, addFeature, repo } = makeRepo()
    const feature = addFeature('fix/a')
    writeFileSync(join(feature.path, 'draft.txt'), 'unsaved')

    const result = runHook(
      root,
      releasePayload(notARepo()),
      { 'fix/a': [{ number: 12, headRefOid: feature.head }] },
      { extraEnv: { CLAUDE_PROJECT_DIR: repo } }
    )

    const output = result.json?.hookSpecificOutput
    expect(output?.permissionDecision).toBe('deny')
    expect(output?.permissionDecisionReason).toContain('- fix/a (#12): tiene cambios sin confirmar')
  })

  it('denies a release when the repository it targets is not a git repository', () => {
    const { root } = makeRepo()
    const cwd = notARepo()

    const result = runHook(root, releasePayload(cwd), {})

    const output = result.json?.hookSpecificOutput
    expect(output?.permissionDecision).toBe('deny')
    expect(output?.permissionDecisionReason).toContain('Comando bloqueado')
    expect(output?.permissionDecisionReason).toContain(`- ${cwd} no es un repositorio git`)
  })

  it.each([
    (repo) => `git -C ${repo} push origin mobile-ios-v1`,
    (repo) => `cd ${repo} && gh workflow run "Lab Release"`
  ])('gates the repository a release command names: %#', (command) => {
    const { root, repo, addFeature } = makeRepo()
    const feature = addFeature('fix/a')
    writeFileSync(join(feature.path, 'draft.txt'), 'unsaved')

    const result = runHook(
      root,
      releasePayload(notARepo(), command(repo)),
      { 'fix/a': [{ number: 12, headRefOid: feature.head }] },
      { extraEnv: { CLAUDE_PROJECT_DIR: notARepo() } }
    )

    expect(result.json?.hookSpecificOutput?.permissionDecisionReason).toContain(
      '- fix/a (#12): tiene cambios sin confirmar'
    )
  })

  it('denies a release, translated, when the Orca terminals cannot be read', () => {
    const { root, repo, addFeature } = makeRepo()
    const feature = addFeature('fix/a')
    const terminals = join(root, 'terminals.json')
    writeFileSync(terminals, 'not json')

    const result = runHook(
      root,
      releasePayload(repo),
      { 'fix/a': [{ number: 12, headRefOid: feature.head }] },
      { extraEnv: { ORCA_WORKTREE_CLOSE_TERMINALS_FILE: terminals } }
    )

    const reason = result.json?.hookSpecificOutput?.permissionDecisionReason
    expect(reason).toContain('- fix/a (#12): no se pudieron leer las terminales de Orca (')
    expect(reason).not.toContain('kept fix/a')
    expect(existsSync(feature.path)).toBe(true)
  })

  it('denies a release, translated, when the merged head is not available', () => {
    const { root, repo, addFeature } = makeRepo()
    const feature = addFeature('fix/a')

    const result = runHook(root, releasePayload(repo), {
      'fix/a': [{ number: 12, headRefOid: 'e'.repeat(40) }]
    })

    const reason = result.json?.hookSpecificOutput?.permissionDecisionReason
    expect(reason).toContain('- fix/a: el head mergeado de #12 no está disponible localmente')
    expect(reason).not.toContain('unverified')
    expect(existsSync(feature.path)).toBe(true)
  })

  it('denies a release when the closer itself fails', () => {
    const { root, repo, addFeature } = makeRepo()
    addFeature('fix/a')
    const prs = join(root, 'prs.json')
    writeFileSync(prs, 'not json')

    const result = runHook(root, releasePayload(repo), null, {
      extraEnv: { ORCA_WORKTREE_CLOSE_PRS_FILE: prs }
    })

    expect(result.status, result.stderr).toBe(0)
    expect(result.json?.hookSpecificOutput?.permissionDecision).toBe('deny')
    expect(result.json?.hookSpecificOutput?.permissionDecisionReason).toContain('Comando bloqueado')
  })

  it('never blocks a non-release event, even when the closer fails', () => {
    const { root, repo, addFeature } = makeRepo()
    addFeature('fix/a')
    const prs = join(root, 'prs.json')
    writeFileSync(prs, 'not json')

    const result = runHook(root, { hook_event_name: 'SessionStart', cwd: repo }, null, {
      extraEnv: { ORCA_WORKTREE_CLOSE_PRS_FILE: prs }
    })

    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toBe('')
  })

  it('acts when started through a symlinked hooks directory', () => {
    const { root, repo, addFeature } = makeRepo()
    const feature = addFeature('fix/a')
    const link = join(root, 'hooks-link')
    symlinkSync(join(projectDir, '.claude/hooks'), link, 'junction')

    const result = runHook(
      root,
      { hook_event_name: 'SessionStart', cwd: repo },
      { 'fix/a': [{ number: 12, headRefOid: feature.head }] },
      { script: join(link, 'merged-worktree-close-hook.mjs') }
    )

    expect(result.status, result.stderr).toBe(0)
    expect(result.json?.hookSpecificOutput?.additionalContext).toContain(
      `closed fix/a (#12) ${feature.path}`
    )
    expect(existsSync(feature.path)).toBe(false)
  })

  it('exits 0 silently on input that is not JSON', () => {
    const result = spawnSync('node', [hookScript], { input: 'not json', encoding: 'utf8' })
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
  })
})

describe('merged-worktree-close hook wiring', () => {
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
  const entries = (event) =>
    (settings.hooks?.[event] ?? []).flatMap((group) =>
      (group.hooks ?? []).map((hook) => ({ ...hook, matcher: group.matcher }))
    )
  const wired = (event) => entries(event).filter((hook) => hook.command === hookCommand)

  it('runs at session start after the coordinator sweep', () => {
    const all = entries('SessionStart')
    const sweep = all.findIndex((hook) => hook.command.includes('coordinator-sweep.sh'))
    const closer = all.findIndex((hook) => hook.command === hookCommand)
    expect(sweep).toBeGreaterThanOrEqual(0)
    expect(closer).toBeGreaterThan(sweep)
    expect(all[closer]).toMatchObject({
      timeout: 90,
      statusMessage: 'Cerrando worktrees de PRs mergeados...'
    })
  })

  // Why no `if`: a prefix filter misses `env X=1 gh ...`, `command gh ...` and `git -C <dir> push`.
  it('sees every Bash command after it runs, to catch merges', () => {
    const hooks = wired('PostToolUse')
    expect(hooks).toEqual([expect.objectContaining({ matcher: 'Bash', timeout: 90 })])
    expect(hooks[0].if).toBeUndefined()
  })

  it('sees every Bash command before it runs, to gate releases', () => {
    const hooks = wired('PreToolUse')
    expect(hooks).toEqual([expect.objectContaining({ matcher: 'Bash', timeout: 90 })])
    expect(hooks[0].if).toBeUndefined()
  })
})
