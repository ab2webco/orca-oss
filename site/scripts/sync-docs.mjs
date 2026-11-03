// Copies the repo's user docs into Starlight's content folder and the brand assets into
// public/. The sources stay where README and AGENTS link to them; everything written
// here is gitignored and regenerated on every build.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BASE, REPO_URL } from '../site.config.mjs'
import { RECORDINGS } from '../src/data/recordings.mjs'
import { transformDoc } from './docs-transform.mjs'
import {
  isTranslationPath,
  LOCALES,
  parseTranslation,
  translationPath
} from './docs-translations.mjs'

const SITE_DIR = fileURLToPath(new URL('../', import.meta.url))
const REPO_DIR = path.resolve(SITE_DIR, '..')
const CONTENT_ROOT = path.join(SITE_DIR, 'src/content/docs')

// Reference docs that are written for users; the rest of docs/reference is for contributors.
const REFERENCE_ROUTES = {
  'docs/reference/orchestrator-game.md': 'docs/orchestrator/orca-game',
  'docs/reference/headless-linux-server.md': 'docs/remote/headless-linux-server',
  'docs/reference/plugin-development.md': 'docs/extend/plugins',
  'docs/reference/orca-sonar.md': 'docs/extend/orca-sonar'
}

function listMarkdown(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) {
      return listMarkdown(full)
    }
    return name.endsWith('.md') ? [full] : []
  })
}

function userDocRoute(repoPath) {
  const rel = repoPath.replace(/^docs\/user\//, '').replace(/\.md$/, '')
  return rel === 'README' ? 'docs' : `docs/${rel}`
}

export function buildRoutes() {
  const routes = new Map()
  for (const file of listMarkdown(path.join(REPO_DIR, 'docs/user'))) {
    const repoPath = path.relative(REPO_DIR, file).split(path.sep).join('/')
    if (!isTranslationPath(repoPath)) {
      routes.set(repoPath, userDocRoute(repoPath))
    }
  }
  for (const [repoPath, route] of Object.entries(REFERENCE_ROUTES)) {
    routes.set(repoPath, route)
  }
  return routes
}

function copyInto(fromRepoPath, toSitePath) {
  const target = path.join(SITE_DIR, toSitePath)
  mkdirSync(path.dirname(target), { recursive: true })
  copyFileSync(path.join(REPO_DIR, fromRepoPath), target)
}

// A localized page links to the localized copy of a doc, whichever file the link names, and
// to the English page until that copy exists.
export function localeRoutes(routes, locale, hasTranslation) {
  const localized = new Map()
  for (const [repoPath, route] of routes) {
    const target = hasTranslation(repoPath) ? `${locale}/${route}` : route
    localized.set(repoPath, target)
    localized.set(translationPath(repoPath, locale), target)
  }
  return localized
}

function writePage(repoPath, source, route, routes) {
  const { markdown, images } = transformDoc(source, repoPath, {
    base: BASE,
    repoUrl: REPO_URL,
    routes
  })
  const target = path.join(
    CONTENT_ROOT,
    /(^|\/)docs$/.test(route) ? `${route}/index.md` : `${route}.md`
  )
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, markdown)
  for (const image of images) {
    copyInto(image, `public/media/${image}`)
  }
}

function syncDocs() {
  rmSync(path.join(CONTENT_ROOT, 'docs'), { recursive: true, force: true })
  const routes = buildRoutes()
  for (const [repoPath, route] of routes) {
    writePage(repoPath, readFileSync(path.join(REPO_DIR, repoPath), 'utf8'), route, routes)
  }
  let translated = 0
  for (const locale of LOCALES) {
    rmSync(path.join(CONTENT_ROOT, locale), { recursive: true, force: true })
    const hasTranslation = (repoPath) =>
      existsSync(path.join(REPO_DIR, translationPath(repoPath, locale)))
    const localized = localeRoutes(routes, locale, hasTranslation)
    for (const [repoPath, route] of routes) {
      if (!hasTranslation(repoPath)) {
        continue
      }
      const target = translationPath(repoPath, locale)
      const { body } = parseTranslation(readFileSync(path.join(REPO_DIR, target), 'utf8'))
      // Starlight pairs locales by slug, so the Spanish page is es/<the English slug>.
      writePage(target, body, `${locale}/${route}`, localized)
      translated += 1
    }
  }
  return { pages: routes.size, translated }
}

function syncAssets() {
  rmSync(path.join(SITE_DIR, 'public/media'), { recursive: true, force: true })
  copyInto('resources/build/icon.png', 'src/assets/icon.png')
  copyInto('resources/build/icon.png', 'public/icon.png')
  copyInto(
    'src/renderer/src/assets/fonts/Geist-Variable.woff2',
    'src/assets/fonts/Geist-Variable.woff2'
  )
  // Copied rather than imported so Vite never reaches outside site/.
  for (const gif of Object.keys(RECORDINGS)) {
    copyInto(`docs/assets/readme/${gif}`, `public/media/readme/${gif}`)
  }
}

if (process.argv[1] === import.meta.filename) {
  syncAssets()
  const { pages, translated } = syncDocs()
  process.stdout.write(`sync-docs: ${pages} pages, ${translated} translated\n`)
}
