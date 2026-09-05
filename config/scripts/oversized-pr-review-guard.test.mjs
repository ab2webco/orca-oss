import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const projectDir = resolve(import.meta.dirname, '../..')
const hookScript = join(projectDir, '.claude/hooks/oversized-pr-review-guard.py')
const settingsPath = join(projectDir, '.claude/settings.json')
const tempDirs = []

// Why un `gh` falso y no la red: la guarda mide el diff con `gh pr view --json files`, y el
// tamaño es justo lo que cada caso necesita fijar.
function makeFakeGhBin({ number = '1', files = null } = {}) {
  const bin = mkdtempSync(join(tmpdir(), 'orca-oversized-pr-guard-bin-'))
  tempDirs.push(bin)
  const script = join(bin, 'gh')
  const filesJson = files === null ? null : JSON.stringify(files)
  const body =
    filesJson === null
      ? `#!/bin/sh\ncase "$*" in *number*) echo "${number}";; *) exit 1;; esac\n`
      : `#!/bin/sh\ncase "$*" in\n  *number*) echo "${number}";;\n  *files*) cat <<'JSON'\n${filesJson}\nJSON\n  ;;\n  *) exit 1;;\nesac\n`
  writeFileSync(script, body)
  chmodSync(script, 0o755)
  return bin
}

function runGuard(command, ghOptions) {
  const cwd = mkdtempSync(join(tmpdir(), 'orca-oversized-pr-guard-'))
  tempDirs.push(cwd)
  const env = { ...process.env }
  if (ghOptions !== undefined) {
    env.PATH = `${makeFakeGhBin(ghOptions)}:${env.PATH}`
  }
  const result = spawnSync('python3', [hookScript], {
    cwd,
    env,
    encoding: 'utf8',
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd })
  })
  expect(result.status, result.stderr).toBe(0)
  const stdout = result.stdout.trim()
  if (!stdout) {
    return { denied: false, reason: '', note: '' }
  }
  const payload = JSON.parse(stdout)
  return {
    denied: payload.hookSpecificOutput?.permissionDecision === 'deny',
    reason: payload.hookSpecificOutput?.permissionDecisionReason ?? '',
    note: payload.systemMessage ?? ''
  }
}

const bigProd = [{ path: 'src/main/feature.ts', additions: 401 }]
const bigTests = [
  { path: 'src/main/feature.ts', additions: 10 },
  { path: 'src/main/feature.test.ts', additions: 900 },
  // Why sin `.test.`/`.spec.` en el nombre: es la única entrada que clasifica por directorio,
  // así que es la que muere si alguien recorta el predicado a la extensión.
  { path: 'tests/tools/probe.mjs', additions: 900 }
]

describe('oversized-pr-review-guard', () => {
  afterAll(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('is wired as a PreToolUse Bash hook', () => {
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
    const wired = (settings.hooks?.PreToolUse ?? []).some(
      ({ matcher, hooks }) =>
        matcher === 'Bash' &&
        hooks?.some(({ command }) => command.endsWith('/oversized-pr-review-guard.py'))
    )
    expect(wired).toBe(true)
  })

  it('ignores commands that are not a pr merge', () => {
    expect(runGuard('gh pr create --fill').denied).toBe(false)
    expect(runGuard('git push origin main').denied).toBe(false)
  })

  it('allows a merge under the threshold', () => {
    const result = runGuard('gh pr merge 12 --squash', {
      number: '12',
      files: [{ path: 'src/main/small.ts', additions: 400 }]
    })
    expect(result.denied).toBe(false)
  })

  // Why este caso primero: es el que se rompe si alguien afloja el predicado.
  it('denies a merge over the threshold with no acknowledgement', () => {
    const result = runGuard('gh pr merge 12 --squash', { number: '12', files: bigProd })
    expect(result.denied).toBe(true)
    expect(result.reason).toContain('401')
    expect(result.reason).toContain('Cortar la tajada')
  })

  it('denies when the body only claims a review instead of naming a lineage', () => {
    const result = runGuard('gh pr merge 12 --squash  # corrí las 4 lentes, todo verde', {
      number: '12',
      files: bigProd
    })
    expect(result.denied).toBe(true)
  })

  it('allows an oversized merge that names a review lineage', () => {
    const result = runGuard('gh pr merge 12 --squash  # reviewed-4r: review-1622724fc457c868', {
      number: '12',
      files: bigProd
    })
    expect(result.denied).toBe(false)
    expect(result.note).toContain('review-1622724fc457c868')
  })

  // Why: el umbral cuenta líneas propias. 1800 líneas de test no piden el set 4R.
  it('does not count test files toward the threshold', () => {
    const result = runGuard('gh pr merge 12 --squash', { number: '12', files: bigTests })
    expect(result.denied).toBe(false)
  })

  it('denies when the diff cannot be read', () => {
    const result = runGuard('gh pr merge 12 --squash', { number: '12', files: null })
    expect(result.denied).toBe(true)
    expect(result.reason).toContain('no se pudo leer el diff')
  })

  it('denies when the pr number cannot be resolved', () => {
    const result = runGuard('gh pr merge --squash')
    expect(result.denied).toBe(true)
    expect(result.reason).toContain('no se pudo resolver el número')
  })
})
