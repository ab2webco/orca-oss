import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import { BASE, REPO_URL } from '../site.config.mjs'
import {
  headingSlugs,
  LOCALES,
  sourceHash,
  stampTranslation,
  translationPath,
  translationStatus
} from '../scripts/docs-translations.mjs'
import { buildRoutes, localeRoutes } from '../scripts/sync-docs.mjs'
import { readBuilt, REPO_DIR } from './support/built-html.mjs'

const routes = buildRoutes()
// Voseo forms a docs page would plausibly use; \b is ASCII-only, so letters bound the word.
const VOSEO =
  /(?<!\p{L})(?:podés|tenés|querés|sabés|hacés|ponés|corrés|elegís|abrís|usá|abrí|hacé|poné|mirá|fijate|elegí|corré|creá|leé|tocá|probá|configurá|instalá|ejecutá|seleccioná|pegá|escribí|vos)(?!\p{L})/iu

function listMarkdown(dir) {
  return existsSync(dir)
    ? readdirSync(dir, { recursive: true }).filter((name) => name.endsWith('.md'))
    : []
}

describe('docs translations', () => {
  for (const locale of LOCALES) {
    const translated = [...routes.keys()].filter((repoPath) =>
      existsSync(path.join(REPO_DIR, translationPath(repoPath, locale)))
    )

    it(`every docs page has a current ${locale} translation`, () => {
      const problems = [...routes.keys()]
        .map((repoPath) => translationStatus(repoPath, locale))
        .filter((status) => status.state !== 'current')
        .map(
          (status) =>
            `${status.state}: ${status.target}${status.reason ? ` (${status.reason})` : ''}`
        )
      assert.deepEqual(
        problems,
        [],
        'Translate or update each file to match its English source, then run `pnpm translations stamp <file>` in site/.'
      )
    })

    it(`every ${locale} translation has an English source the site publishes`, () => {
      const expected = new Set(
        [...routes.keys()].map((repoPath) => translationPath(repoPath, locale))
      )
      const orphans = ['docs/user', 'docs/reference']
        .flatMap((root) =>
          listMarkdown(path.join(REPO_DIR, root, locale)).map((name) =>
            [root, locale, name.split(path.sep).join('/')].join('/')
          )
        )
        .filter((target) => !expected.has(target))
      assert.deepEqual(orphans, [])
    })

    it(`${locale} translations use tú, never voseo`, () => {
      const hits = translated.flatMap((repoPath) => {
        const target = translationPath(repoPath, locale)
        const lines = readFileSync(path.join(REPO_DIR, target), 'utf8').split('\n')
        return lines.flatMap((line, i) => (VOSEO.test(line) ? [`${target}:${i + 1}`] : []))
      })
      assert.deepEqual(hits, [])
    })
  }
})

describe('translationStatus', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'site-translations-'))
  after(() => rmSync(dir, { recursive: true, force: true }))
  const write = (rel, text) => {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    writeFileSync(path.join(dir, rel), text)
  }
  const source = '# Install\n\n## First run\n\n```sh\norca open\n```\n'
  write('docs/user/install.md', source)

  it('reports a page with no translation as missing', () => {
    assert.equal(translationStatus('docs/user/install.md', 'es', dir).state, 'missing')
  })

  it('reports a translation made from older English as stale, and current once stamped', () => {
    write(
      'docs/user/es/install.md',
      '# Instalación\n\n## Primer arranque\n\n```sh\norca open\n```\n'
    )
    assert.equal(translationStatus('docs/user/install.md', 'es', dir).state, 'stale')
    stampTranslation(path.join(dir, 'docs/user/es/install.md'), dir)
    assert.match(
      readFileSync(path.join(dir, 'docs/user/es/install.md'), 'utf8'),
      /^---\nsourceHash: [0-9a-f]{16}\n---\n# Instalación/
    )
    assert.equal(translationStatus('docs/user/install.md', 'es', dir).state, 'current')

    write('docs/user/install.md', `${source}\nOne more line.\n`)
    assert.equal(translationStatus('docs/user/install.md', 'es', dir).state, 'stale')
  })

  it('reports a translation that dropped a heading or changed a command as misshapen', () => {
    write('docs/user/install.md', source)
    const hash = sourceHash(source)
    write(
      'docs/user/es/install.md',
      `---\nsourceHash: ${hash}\n---\n# Instalación\n\n\`\`\`sh\norca open\n\`\`\`\n`
    )
    assert.equal(translationStatus('docs/user/install.md', 'es', dir).state, 'misshapen')
    write(
      'docs/user/es/install.md',
      `---\nsourceHash: ${hash}\n---\n# Instalación\n\n## Primer arranque\n\n\`\`\`sh\norca abrir\n\`\`\`\n`
    )
    assert.equal(translationStatus('docs/user/install.md', 'es', dir).state, 'misshapen')
  })

  it('links a translation to the English page until the page it names is translated', () => {
    const localized = localeRoutes(
      new Map([
        ['docs/user/ssh.md', 'docs/ssh'],
        ['docs/user/mobile.md', 'docs/mobile']
      ]),
      'es',
      (repoPath) => repoPath === 'docs/user/ssh.md'
    )
    assert.equal(localized.get('docs/user/es/ssh.md'), 'es/docs/ssh')
    assert.equal(localized.get('docs/user/es/mobile.md'), 'docs/mobile')
    assert.equal(localized.get('docs/user/mobile.md'), 'docs/mobile')
  })

  it('slugs headings the way the built page ids them', () => {
    assert.deepEqual(
      headingSlugs(
        '# T\n## Qué lee el juego: `orca game state --json`\n## Configuración\n## Configuración'
      ),
      ['qué-lee-el-juego-orca-game-state---json', 'configuración', 'configuración-1']
    )
  })
})

describe('built docs in every language', () => {
  const pages = [...routes.values()].map((route) => `${route}/index.html`)

  for (const locale of LOCALES) {
    it(`builds every ${locale} page as its own text, not the English fallback`, () => {
      const fallback = []
      for (const page of pages) {
        const html = readBuilt(`${locale}/${page}`)
        if (
          !html.includes(`<html lang="${locale}"`) ||
          /starlight-fallback|aún no está disponible/i.test(html)
        ) {
          fallback.push(`${locale}/${page}`)
        }
      }
      assert.deepEqual(fallback, [])
    })
  }

  it('the language picker on every docs page lands on the same page in the other language', () => {
    const wrong = []
    for (const page of pages) {
      const route = page.replace(/index\.html$/, '')
      for (const [file, other] of [
        [page, `${BASE}/es/${route}`],
        [`es/${page}`, `${BASE}/${route}`]
      ]) {
        if (!readBuilt(file).includes(`value="${other}"`)) {
          wrong.push(`${file} has no option for ${other}`)
        }
      }
    }
    assert.deepEqual(wrong, [])
  })

  it('GitHub links from the docs name a repo file that exists and is not on the site', () => {
    const published = new Set(
      [...routes.keys()].flatMap((repoPath) => [
        repoPath,
        ...LOCALES.map((locale) => translationPath(repoPath, locale))
      ])
    )
    const leaks = []
    for (const file of [
      ...pages,
      ...LOCALES.flatMap((locale) => pages.map((page) => `${locale}/${page}`))
    ]) {
      for (const match of readBuilt(file).matchAll(/href="([^"#]+)/g)) {
        const repoPath =
          match[1].startsWith(`${REPO_URL}/blob/main/`) &&
          match[1].slice(`${REPO_URL}/blob/main/`.length)
        if (repoPath && published.has(repoPath)) {
          leaks.push(`${file} → ${repoPath} (on the site)`)
        } else if (repoPath && !existsSync(path.join(REPO_DIR, decodeURIComponent(repoPath)))) {
          leaks.push(`${file} → ${repoPath} (no such file)`)
        }
      }
    }
    assert.deepEqual(leaks, [])
  })
})
