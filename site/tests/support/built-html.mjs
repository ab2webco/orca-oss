import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const SITE_DIR = fileURLToPath(new URL('../../', import.meta.url))
export const REPO_DIR = path.resolve(SITE_DIR, '..')
export const DIST_DIR = path.join(SITE_DIR, 'dist')

export function readBuilt(relativePath) {
  const file = path.join(DIST_DIR, relativePath)
  if (!existsSync(file)) {
    throw new Error(`${relativePath} is missing from dist/; run the site build first`)
  }
  return readFileSync(file, 'utf8')
}

export function listBuiltFiles(dir = DIST_DIR) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) {
      out.push(...listBuiltFiles(full))
    } else {
      out.push(full)
    }
  }
  return out
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' }

// Visible text only: what a reader (or a crawler) sees, not what a script might draw later.
export function visibleText(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#?\w+);/g, (match, name) => ENTITIES[name] ?? match)
    .replace(/\s+/g, ' ')
}
