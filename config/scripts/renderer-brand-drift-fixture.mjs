import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Test fixture: a throwaway repo with a renderer tree, its en.json and an allowlist.

export const OLD_NAME = 'Or' + 'ca'
export const ALLOWLIST = 'config/renderer-brand-drift-allowlist.txt'

export const CATALOG = {
  greet: 'Hello',
  brand: `${OLD_NAME} Lab is ready`,
  first: 'First copy',
  second: 'Second copy'
}

// Two known stale fallbacks in different files, listed on adjacent lines.
export const BASE_FILES = {
  'components/First.tsx': "export const a = () => translate('first', 'Old first')\n",
  'components/Second.tsx': "export const b = () => translate('second', 'Old second')\n"
}
export const BASE_ALLOWLIST = [
  '# known stale fallbacks',
  'components/First.tsx first',
  'components/Second.tsx second',
  ''
].join('\n')

const roots = []

export function writeRenderer(root, files) {
  for (const [file, source] of Object.entries(files)) {
    const absolute = path.join(root, 'src/renderer/src', file)
    fs.mkdirSync(path.dirname(absolute), { recursive: true })
    fs.writeFileSync(absolute, source)
  }
}

export function writeAllowlist(root, text) {
  fs.mkdirSync(path.join(root, 'config'), { recursive: true })
  fs.writeFileSync(path.join(root, ALLOWLIST), text)
}

export function gitIn(root) {
  return (...args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

/** A repo whose `main` commit holds the base tree; HEAD is a `work` branch on top of it. */
export function fixtureRepo({ files = BASE_FILES, allowlist = BASE_ALLOWLIST } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-drift-allowlist-'))
  roots.push(root)
  const git = gitIn(root)
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'test')
  writeRenderer(root, { 'i18n/locales/en.json': JSON.stringify(CATALOG), ...files })
  if (allowlist !== null) {
    writeAllowlist(root, allowlist)
  }
  git('add', '-A')
  git('commit', '-qm', 'base')
  git('switch', '-qc', 'work')
  return root
}

export function commitAll(root, message) {
  const git = gitIn(root)
  git('add', '-A')
  git('commit', '-qm', message)
}

export function removeFixtureRepos() {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true })
  }
}
