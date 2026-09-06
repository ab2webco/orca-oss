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
  // Why dos formas y no una: `gh pr view --json files` corta en 100 entradas y usa
  // `path`; `gh api .../pulls/N/files` pagina y usa `filename`. Un fake que sirve
  // las dos igual no puede distinguir una guarda que pagina de una que no.
  const truncatedJson = files === null ? null : JSON.stringify(files.slice(0, 100))
  // `gh api --jq` aplica el filtro y emite lineas, no JSON: el fake tiene que
  // servir lo mismo o el hook parsea algo que gh nunca le daria.
  // Why dos paginas y no una lista entera: sin esto, el fake sirve todo con o sin
  // --paginate, y sacar la bandera deja el suite en verde. Es lo que paso en #296.
  const page = (entries) => entries.map(({ path, additions }) => `${path}\t${additions}`).join('\n')
  const firstPageTsv = files === null ? null : page(files.slice(0, 100))
  const allPagesTsv = files === null ? null : page(files)
  const body =
    files === null
      ? `#!/bin/sh\ncase "$*" in *number*) echo "${number}";; *) exit 1;; esac\n`
      : [
          '#!/bin/sh',
          'case "$*" in',
          `  *number*) echo "${number}";;`,
          // `gh api` sin --paginate devuelve solo la primera pagina, como el real.
          `  *--paginate*) cat <<'PAGES'`,
          allPagesTsv,
          'PAGES',
          '  ;;',
          `  *api*files*) cat <<'PAGE1'`,
          firstPageTsv,
          'PAGE1',
          '  ;;',
          `  *files*) cat <<'JSON'`,
          truncatedJson,
          'JSON',
          '  ;;',
          '  *) exit 1;;',
          'esac',
          ''
        ].join('\n')
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
      { path: 'src/renderer/src/i18n/locales/ko.json', additions: 592 },
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
