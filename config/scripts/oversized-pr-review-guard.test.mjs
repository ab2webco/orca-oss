import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const projectDir = resolve(import.meta.dirname, '../..')
const hookScript = join(projectDir, '.claude/hooks/oversized-pr-review-guard.py')
const settingsPath = join(projectDir, '.claude/settings.json')
const DEFAULT_REPO = 'ab2webco/orca-oss'
const SONAR_REPO = 'ab2webco/orca-sonar'
const tempDirs = []

// Why a marker file: the fake gh answers `gh repo view` for the checkout it runs in,
// the way gh does for a real one, so a `cd` into another checkout changes the answer.
function makeDir(repo) {
  const dir = mkdtempSync(join(tmpdir(), 'orca-oversized-pr-guard-'))
  tempDirs.push(dir)
  if (repo !== undefined) {
    writeFileSync(join(dir, 'fake-gh-repo'), repo)
  }
  return dir
}

// Why un `gh` falso y no la red: el tamaño es justo lo que cada caso fija. `repos` mapea
// owner/repo a los archivos de su PR; un repo fuera del mapa es un diff ilegible.
function makeFakeGhBin({ number = '1', files = null, repos = {} } = {}) {
  const bin = mkdtempSync(join(tmpdir(), 'orca-oversized-pr-guard-bin-'))
  tempDirs.push(bin)
  const pulls = { [DEFAULT_REPO]: files, ...repos }
  const toTsv = (entries) =>
    entries.map(({ path, additions }) => `${path}\t${additions}`).join('\n')
  const pullCases = Object.entries(pulls).map(([repo, entries], index) => {
    if (entries === null) {
      return `  *"repos/${repo}/pulls/"*) exit 1 ;;`
    }
    const all = join(bin, `pulls-${index}-all.tsv`)
    const firstPage = join(bin, `pulls-${index}-first.tsv`)
    writeFileSync(all, toTsv(entries))
    writeFileSync(firstPage, toTsv(entries.slice(0, 100)))
    // Why two pages: a fake that serves everything with or without --paginate stays green
    // when the flag is dropped (#296).
    return `  *"repos/${repo}/pulls/"*) case "$*" in *--paginate*) cat '${all}' ;; *) cat '${firstPage}' ;; esac ;;`
  })
  const numberCase = number === null ? '  *number*) exit 1 ;;' : `  *number*) echo "${number}" ;;`
  const body = [
    '#!/bin/sh',
    'case "$*" in',
    ...pullCases,
    '  *nameWithOwner*)',
    '    marker="$(pwd -P)/fake-gh-repo"',
    `    if [ ! -f "$marker" ]; then echo '${DEFAULT_REPO}'; elif [ -s "$marker" ]; then cat "$marker"; else exit 1; fi ;;`,
    numberCase,
    '  *) exit 1 ;;',
    'esac',
    ''
  ].join('\n')
  const script = join(bin, 'gh')
  writeFileSync(script, body)
  chmodSync(script, 0o755)
  return bin
}

// Why every python3 and not only the first: the shebang runs whichever one the hook's PATH
// finds, and macOS ships 3.9 at /usr/bin. A crash there exits 1 and Claude Code lets the
// merge through (ORCA-803).
function python3Interpreters() {
  const candidates = [
    ...(process.env.PATH ?? '').split(delimiter).map((dir) => join(dir, 'python3')),
    '/usr/bin/python3'
  ]
  const byRealPath = new Map()
  for (const candidate of candidates) {
    if (existsSync(candidate) && !byRealPath.has(realpathSync(candidate))) {
      byRealPath.set(realpathSync(candidate), candidate)
    }
  }
  return [...byRealPath.values()]
}

function runGuard(command, ghOptions, cwd = makeDir(), python = 'python3') {
  const env = { ...process.env }
  // Why: a GH_REPO exported in the developer's shell would silently retarget these cases.
  delete env.GH_REPO
  if (ghOptions !== undefined) {
    env.PATH = `${makeFakeGhBin(ghOptions)}:${env.PATH}`
  }
  const result = spawnSync(python, [hookScript], {
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
// The orca-sonar PR from ORCA-781: 1595 lines, 1376 of them in the lockfile, 219 authored.
const sonarPr = [
  { path: 'package-lock.json', additions: 1376 },
  { path: 'plugin/src/index.ts', additions: 150 },
  { path: 'plugin/src/manifest.ts', additions: 69 }
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
    const result = runGuard('gh pr merge 12 --squash', {
      number: '12',
      files: bigProd
    })
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
  // Why estos dos juntos: la condición de aceptación de ORCA-397 es control de
  // mutación en las dos direcciones. Sacá el reconocimiento de datos y el primero
  // vuelve a bloquear; bajá el umbral o contá datos y el segundo deja de bloquear.
  // Why este caso: la fuente vieja corta en 100 entradas, asi que el archivo 101
  // con el peso queda invisible. Es el defecto que hacia que #293 (1021 archivos)
  // se reportara en 432 lineas en vez de 1847. ORCA-411.
  it('counts past the first page of pull files', () => {
    const files = [
      ...Array.from({ length: 100 }, (_, i) => ({
        path: `src/main/page-one-${i}.ts`,
        additions: 1
      })),
      { path: 'src/main/page-two.ts', additions: 400 }
    ]

    // 100 + 400 = 500 sobre el techo; leyendo solo la primera pagina son 100 y pasa.
    expect(runGuard('gh pr merge 9 --squash', { number: '9', files }).denied).toBe(true)
  })

  it('does not count data files toward the threshold', () => {
    const bigData = [
      { path: 'src/main/feature.ts', additions: 10 },
      { path: 'src/renderer/src/i18n/locales/en.json', additions: 3093 },
      { path: 'src/renderer/src/i18n/locales/es.json', additions: 592 },
      // El caso original del ticket: andamiaje de test que no lleva `.test.`.
      { path: 'mobile/test-doubles/plane-tasks-harness.tsx', additions: 313 }
    ]

    expect(runGuard('gh pr merge 7 --squash', { number: '7', files: bigData }).denied).toBe(false)
  })

  it('still denies 401 lines of real code next to a large data diff', () => {
    const dataPlusProd = [
      { path: 'src/main/feature.ts', additions: 401 },
      { path: 'src/renderer/src/i18n/locales/en.json', additions: 3093 },
      { path: 'mobile/test-doubles/plane-tasks-harness.tsx', additions: 313 }
    ]

    expect(runGuard('gh pr merge 8 --squash', { number: '8', files: dataPlusProd }).denied).toBe(
      true
    )
  })

  it('does not count test files toward the threshold', () => {
    const result = runGuard('gh pr merge 12 --squash', {
      number: '12',
      files: bigTests
    })
    expect(result.denied).toBe(false)
  })

  // Why: los lockfiles son salida de un gestor de paquetes, no código escrito a mano. ORCA-781.
  it('does not count lockfiles toward the threshold', () => {
    const files = [
      { path: 'plugin/src/index.ts', additions: 10 },
      { path: 'package-lock.json', additions: 1376 },
      { path: 'packages/app/pnpm-lock.yaml', additions: 900 },
      { path: 'native/Cargo.lock', additions: 500 }
    ]

    expect(runGuard('gh pr merge 1 --squash', { number: '1', files }).denied).toBe(false)
  })

  it('denies when the diff cannot be read', () => {
    const result = runGuard('gh pr merge 12 --squash', {
      number: '12',
      files: null
    })
    expect(result.denied).toBe(true)
    expect(result.reason).toContain('no se pudo leer el diff')
  })

  it('denies when the pr number cannot be resolved', () => {
    const result = runGuard('gh pr merge --squash', { number: null })
    expect(result.denied).toBe(true)
    expect(result.reason).toContain('no se pudo resolver el número')
  })

  it('denies a branch selector it cannot map to a pr number', () => {
    const result = runGuard('gh pr merge feature-x --squash', {
      number: '1',
      files: bigProd
    })
    expect(result.denied).toBe(true)
    expect(result.reason).toContain('no se pudo resolver el número')
  })

  // ORCA-781: la guarda medía el PR del repo de la sesión, ignorando -R y el cd.
  it('measures the repo named by -R, not the session repo', () => {
    const result = runGuard(`gh pr merge 1 -R ${SONAR_REPO} --squash`, {
      files: bigProd,
      repos: { [SONAR_REPO]: sonarPr }
    })
    expect(result.denied).toBe(false)
  })

  it('denies an oversized pr of the repo named by -R', () => {
    const result = runGuard(`gh pr merge 1 --repo=${SONAR_REPO} --squash`, {
      files: sonarPr,
      repos: { [SONAR_REPO]: bigProd }
    })
    expect(result.denied).toBe(true)
  })

  it('measures the repo of a leading cd, not the session repo', () => {
    const sonarDir = makeDir(SONAR_REPO)
    const result = runGuard(`cd ${sonarDir} && gh pr merge 1 --squash`, {
      files: bigProd,
      repos: { [SONAR_REPO]: sonarPr }
    })
    expect(result.denied).toBe(false)
  })

  it('measures the repo of a GH_REPO assignment', () => {
    const result = runGuard(`GH_REPO=${SONAR_REPO} gh pr merge 1 --squash`, {
      files: bigProd,
      repos: { [SONAR_REPO]: sonarPr }
    })
    expect(result.denied).toBe(false)
  })

  it('measures the repo of a pr URL', () => {
    const result = runGuard(`gh pr merge https://github.com/${SONAR_REPO}/pull/1 --squash`, {
      files: bigProd,
      repos: { [SONAR_REPO]: sonarPr }
    })
    expect(result.denied).toBe(false)
  })

  it('reads the -R option placed before pr merge', () => {
    const result = runGuard(`gh -R ${SONAR_REPO} pr merge 1 --squash`, {
      files: bigProd,
      repos: { [SONAR_REPO]: sonarPr }
    })
    expect(result.denied).toBe(false)
  })

  it('denies an oversized merge when -R comes before pr merge', () => {
    const result = runGuard(`gh -R ${DEFAULT_REPO} pr merge 1 --squash`, {
      number: '1',
      files: bigProd
    })
    expect(result.denied).toBe(true)
  })

  // ORCA-803: un merge sin repo conocido no se mide, así que se niega igual que un diff ilegible.
  it('denies when the repo cannot be resolved and says how to name it', () => {
    const result = runGuard('gh pr merge 1 --squash', { files: bigProd }, makeDir(''))
    expect(result.denied).toBe(true)
    expect(result.reason).toContain('no se pudo resolver el repositorio')
    expect(result.reason).toContain('-R owner/repo')
  })

  it('denies when a cd target cannot be known statically', () => {
    const result = runGuard('cd "$HOME/orca" && gh pr merge 1 --squash', {
      files: bigProd
    })
    expect(result.denied).toBe(true)
    expect(result.reason).toContain('no se pudo resolver el repositorio')
  })

  it('measures the -R repo even when a cd target cannot be known statically', () => {
    const result = runGuard(`cd "$HOME/orca" && gh pr merge 1 -R ${SONAR_REPO} --squash`, {
      files: bigProd,
      repos: { [SONAR_REPO]: sonarPr }
    })
    expect(result.denied).toBe(false)
  })

  it.each(python3Interpreters())('still denies an oversized merge under %s', (python) => {
    const result = runGuard(
      'gh pr merge 12 --squash',
      { number: '12', files: bigProd },
      makeDir(),
      python
    )
    expect(result.denied).toBe(true)
    expect(result.reason).toContain('suma 401 líneas propias')
  })

  // ORCA-803: un body escrito por heredoc que nombra el merge se leía como el merge.
  it('does not read a merge named inside a heredoc body as a merge', () => {
    const command = [
      "gh pr create --title t --body \"$(cat <<'EOF'",
      'gh pr merge feature-x -R ab2webco/orca-sonar',
      'EOF',
      ')"'
    ].join('\n')
    const result = runGuard(command, { number: '1', files: bigProd })
    expect(result.denied).toBe(false)
  })

  it('does not read a heredoc body as a command when its opener has trailing spaces', () => {
    const command = ["cat > body.md <<'EOF'  ", 'gh pr merge feature-x --squash', 'EOF'].join('\n')
    const result = runGuard(command, { number: '1', files: bigProd })
    expect(result.denied).toBe(false)
  })

  // ORCA-781: la guarda buscaba el texto del comando, así que una mención entre comillas
  // en otro comando pasaba por un merge.
  it('does not read a quoted merge mention in another command as a merge', () => {
    const result = runGuard(
      'orca plane comment add --id ORCA-781 --body "run gh pr merge 12 --squash after review"',
      { number: '12', files: bigProd }
    )
    expect(result.denied).toBe(false)
    expect(result.note).toBe('')
  })

  it('does not read a quoted merge mention in git commit as a merge', () => {
    const result = runGuard('git commit -m "gh pr merge 12 --squash is not run here"', {
      number: '12',
      files: bigProd
    })
    expect(result.denied).toBe(false)
  })
})
