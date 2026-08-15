import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const projectDir = resolve(import.meta.dirname, '../..')
const hookScript = join(projectDir, '.claude/hooks/main-merge-guard.py')
const settingsPath = join(projectDir, '.claude/settings.json')
const workingProcessPath = join(projectDir, 'docs/reference/working-process.md')
const tempDirs = []

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function hasConfiguredMainMergeGuard(settings) {
  return (settings.hooks?.PreToolUse ?? []).some(
    ({ matcher, hooks }) =>
      matcher === 'Bash' && hooks?.some(({ command }) => command.endsWith('/main-merge-guard.py'))
  )
}

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'orca-main-merge-guard-'))
  tempDirs.push(root)
  // Why: `git init --initial-branch` es de git 2.28 y el piso del repo es 2.25.
  git(root, ['init', '--quiet'])
  git(root, ['config', 'user.email', 'main-merge-guard-test@example.com'])
  git(root, ['config', 'user.name', 'Main Merge Guard Test'])
  git(root, ['checkout', '--quiet', '-b', 'main'])
  git(root, ['remote', 'add', 'origin', 'git@example.com:owner/repo.git'])
  git(root, ['remote', 'add', 'upstream', 'git@example.com:someone-else/repo.git'])
  writeFileSync(join(root, 'base.txt'), 'base\n')
  git(root, ['add', '-A'])
  git(root, ['commit', '--quiet', '-m', 'base'])
  git(root, ['branch', 'feature'])
  return root
}

// Why: `gh pr merge` resolve la base con una llamada de red. El guard se prueba
// contra un `gh` falso en el PATH para fijar la base sin depender de GitHub.
function makeFakeGhBin(baseRefName) {
  const bin = mkdtempSync(join(tmpdir(), 'orca-main-merge-guard-bin-'))
  tempDirs.push(bin)
  const script = join(bin, 'gh')
  const body =
    baseRefName === null
      ? '#!/bin/sh\nexit 1\n'
      : `#!/bin/sh\ncase "$*" in *baseRefName*) echo "${baseRefName}";; *) exit 1;; esac\n`
  writeFileSync(script, body)
  chmodSync(script, 0o755)
  return bin
}

function runGuard(command, { cwd, ghBase } = {}) {
  const repo = cwd ?? makeRepo()
  const env = { ...process.env }
  if (ghBase !== undefined) {
    env.PATH = `${makeFakeGhBin(ghBase)}:${env.PATH}`
  }
  const result = spawnSync('python3', [hookScript], {
    cwd: repo,
    env,
    encoding: 'utf8',
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: repo })
  })
  expect(result.status, result.stderr).toBe(0)
  const stdout = result.stdout.trim()
  if (!stdout) {
    return { denied: false, reason: '' }
  }
  const payload = JSON.parse(stdout)
  const decision = payload.hookSpecificOutput?.permissionDecision
  return {
    denied: decision === 'deny',
    reason: payload.hookSpecificOutput?.permissionDecisionReason ?? ''
  }
}

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('main merge guard static contract', () => {
  it('pins the update floor without claiming it blocks old installations at startup', () => {
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
    const workingProcess = readFileSync(workingProcessPath, 'utf8')

    expect(settings.minimumVersion).toBe('2.1.229')
    expect(workingProcess).toContain('piso de actualizaciones, no un requisito de arranque')
    expect(workingProcess).toMatch(/sesión nueva|reinici/i)
  })

  it('detects an absent PreToolUse registration', () => {
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'))

    expect(hasConfiguredMainMergeGuard(settings)).toBe(true)
    delete settings.hooks.PreToolUse
    expect(hasConfiguredMainMergeGuard(settings)).toBe(false)
  })
})

// Why: el `gh` falso es un script `#!/bin/sh` y el PATH se arma con `:`.
describe.skipIf(process.platform === 'win32')('main merge guard', () => {
  describe('refuses merges that land on main', () => {
    it('refuses `gh pr merge` on a PR based on main', () => {
      expect(runGuard('gh pr merge 73 --squash --delete-branch', { ghBase: 'main' }).denied).toBe(
        true
      )
    })

    it('refuses `gh pr merge` with no selector when the current PR targets main', () => {
      expect(runGuard('gh pr merge --admin', { ghBase: 'main' }).denied).toBe(true)
    })

    it('refuses when the base cannot be resolved, instead of assuming it is safe', () => {
      const { denied, reason } = runGuard('gh pr merge 73', { ghBase: null })
      expect(denied).toBe(true)
      expect(reason).toContain('No se pudo resolver la rama base')
    })

    it.each([
      ['git push origin main', 'explicit branch'],
      ['git push origin HEAD:main', 'HEAD refspec'],
      ['git push --force origin feature:refs/heads/main', 'fully qualified destination'],
      ['git push origin +feature:main', 'force refspec'],
      ['git push -o ci.skip origin main', 'push option consuming its value'],
      ['git push --mirror origin', 'mirror'],
      ['git push --all origin', 'all branches'],
      ['git -C . push origin main', 'global option before the subcommand'],
      ['gh api -X PATCH repos/ab2webco/orca-oss/git/refs/heads/main -f sha=deadbeef', 'ref write']
    ])('refuses `%s` (%s)', (command) => {
      expect(runGuard(command).denied).toBe(true)
    })

    it.each(['git push', 'git push origin HEAD', 'git push origin @'])(
      'refuses `%s` while standing on main, where the target is implicit',
      (command) => {
        const repo = makeRepo()
        git(repo, ['checkout', '--quiet', 'main'])
        expect(runGuard(command, { cwd: repo }).denied).toBe(true)
      }
    )

    it.each([
      'gh api -X PUT repos/ab2webco/orca-oss/pulls/73/merge',
      'gh api --method PUT repos/ab2webco/orca-oss/pulls/73/merge -f merge_method=squash',
      'gh api repos/ab2webco/orca-oss/merges -f base=main -f head=feature',
      `gh api graphql -f query='mutation { mergePullRequest(input: {pullRequestId: "x"}) { clientMutationId } }'`
    ])('refuses the REST/GraphQL route: %s', (command) => {
      expect(runGuard(command).denied).toBe(true)
    })

    it('refuses a merge hidden after another command in the same call', () => {
      expect(runGuard('npm test && gh pr merge 73', { ghBase: 'main' }).denied).toBe(true)
    })

    it('refuses a command it cannot parse rather than letting it through', () => {
      const { denied, reason } = runGuard(`gh pr merge 73 --body "unbalanced`)
      expect(denied).toBe(true)
      expect(reason).toContain('No se pudo parsear')
    })
  })

  describe('leaves ordinary work alone', () => {
    it('allows a chained PR whose base is a feature branch', () => {
      expect(runGuard('gh pr merge 80 --squash', { ghBase: 'fabolivark/orca-182' }).denied).toBe(
        false
      )
    })

    it.each([
      'git push origin fabolivark/orca-182-merge-guard',
      'git push --force-with-lease origin HEAD:fabolivark/orca-182-merge-guard',
      'git push -u origin feature',
      'git push -u origin HEAD',
      'gh api repos/ab2webco/orca-oss/git/refs/heads/main',
      'git push upstream main',
      'git push --mirror upstream',
      'gh pr view 73 --json state',
      'gh pr create --base main --title x --body y',
      'git merge --no-ff feature',
      'echo "gh pr merge 73 is the coordinator\'s job"'
    ])('allows `%s`', (command) => {
      const repo = makeRepo()
      git(repo, ['checkout', '--quiet', 'feature'])
      expect(runGuard(command, { cwd: repo }).denied).toBe(false)
    })
  })

  describe('the refusal explains itself', () => {
    it('names the guard, the reason and the coordinator path, and offers no bypass', () => {
      const { reason } = runGuard('git push origin main')
      expect(reason).toContain('main-merge-guard')
      expect(reason).toContain('.claude/hooks/main-merge-guard.py')
      expect(reason).toContain('ORCA-196')
      expect(reason).toContain('coordinador')
      // Why: el brief lo pide explícito — un mensaje que enseñe cómo saltear la guarda
      // convierte la guarda en un trámite. No hay flag, ni variable, ni archivo de bypass.
      expect(reason).not.toMatch(/bypass|override|--no-verify|export |touch /i)
    })
  })
})
