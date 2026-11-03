// Copies the repo's user docs into Starlight's content folder and the brand assets into
// public/. The sources stay where README and AGENTS link to them; everything written
// here is gitignored and regenerated on every build.
import {
  copyFileSync,
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
import { transformDoc } from './docs-transform.mjs'

const SITE_DIR = fileURLToPath(new URL('../', import.meta.url))
const REPO_DIR = path.resolve(SITE_DIR, '..')
const CONTENT_DIR = path.join(SITE_DIR, 'src/content/docs/docs')

// Reference docs that are written for users; the rest of docs/reference is for contributors.
const REFERENCE_ROUTES = {
  'docs/reference/orchestrator-game.md': 'docs/orchestrator/orca-game',
  'docs/reference/headless-linux-server.md': 'docs/remote/headless-linux-server',
  'docs/reference/plugin-development.md': 'docs/extend/plugins',
  'docs/reference/orca-sonar.md': 'docs/extend/orca-sonar'
}

// GIFs the landing shows; copied rather than imported so Vite never reaches outside site/.
export const LANDING_MEDIA = [
  'mobile-inbox-ios.gif',
  'mobile-team-ios.gif',
  'mobile-terminal-android.gif',
  'mobile-answer-android.gif',
  'agent-grid.gif',
  'plane-board.gif'
]

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
    routes.set(repoPath, userDocRoute(repoPath))
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

function syncDocs() {
  rmSync(CONTENT_DIR, { recursive: true, force: true })
  const routes = buildRoutes()
  const opts = { base: BASE, repoUrl: REPO_URL, routes }
  for (const [repoPath, route] of routes) {
    const { markdown, images } = transformDoc(
      readFileSync(path.join(REPO_DIR, repoPath), 'utf8'),
      repoPath,
      opts
    )
    const out = route === 'docs' ? 'index.md' : `${route.replace(/^docs\//, '')}.md`
    const target = path.join(CONTENT_DIR, out)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, markdown)
    for (const image of images) {
      copyInto(image, `public/media/${image}`)
    }
  }
  return routes.size
}

function syncAssets() {
  copyInto('resources/build/icon.png', 'src/assets/icon.png')
  copyInto('resources/build/icon.png', 'public/icon.png')
  copyInto(
    'src/renderer/src/assets/fonts/Geist-Variable.woff2',
    'public/fonts/Geist-Variable.woff2'
  )
  for (const gif of LANDING_MEDIA) {
    copyInto(`docs/assets/readme/${gif}`, `public/media/readme/${gif}`)
  }
}

if (process.argv[1] === import.meta.filename) {
  syncAssets()
  const count = syncDocs()
  process.stdout.write(`sync-docs: ${count} pages\n`)
}
