// Spanish (and future) translations of the synced docs. A translation lives next to its
// source under an `es/` folder and records the hash of the English text it was made from,
// so a test can tell a missing or stale translation from a current one.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import GithubSlugger from 'github-slugger'

export const LOCALES = ['es']

const REPO_DIR = fileURLToPath(new URL('../../', import.meta.url))
const DOC_ROOTS = ['docs/user/', 'docs/reference/']
const FRONTMATTER = /^---\n([\s\S]*?)\n---\n/

function normalize(text) {
  return text.replace(/\r\n/g, '\n')
}

export function translationPath(repoPath, locale) {
  const root = DOC_ROOTS.find((prefix) => repoPath.startsWith(prefix))
  if (!root) {
    throw new Error(`${repoPath} is not under ${DOC_ROOTS.join(' or ')}`)
  }
  return `${root}${locale}/${repoPath.slice(root.length)}`
}

export function isTranslationPath(repoPath) {
  return DOC_ROOTS.some((root) =>
    LOCALES.some((locale) => repoPath.startsWith(`${root}${locale}/`))
  )
}

export function sourceHash(text) {
  return createHash('sha256').update(normalize(text)).digest('hex').slice(0, 16)
}

export function parseTranslation(text) {
  const normalized = normalize(text)
  const match = FRONTMATTER.exec(normalized)
  const fields = {}
  for (const line of match ? match[1].split('\n') : []) {
    const pair = /^(\w+):\s*(.*)$/.exec(line)
    if (pair) {
      fields[pair[1]] = pair[2].trim()
    }
  }
  return {
    sourceHash: fields.sourceHash ?? null,
    body: match ? normalized.slice(match[0].length) : normalized
  }
}

function withHash(translation, hash) {
  const { body } = parseTranslation(translation)
  return `---\nsourceHash: ${hash}\n---\n${body}`
}

// Headings and fenced blocks outside fences, in order; the translation must keep both.
export function docOutline(markdown) {
  const headings = []
  const fences = []
  let fence = null
  let block = []
  for (const line of normalize(markdown).split('\n')) {
    const marker = /^\s*(```+|~~~+)/.exec(line)
    if (fence) {
      block.push(line)
      if (marker && marker[1].startsWith(fence)) {
        fences.push(block.join('\n'))
        fence = null
      }
      continue
    }
    if (marker) {
      fence = marker[1]
      block = [line]
      continue
    }
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (heading) {
      headings.push({ level: heading[1].length, text: heading[2] })
    }
  }
  return { headings, fences }
}

function headingText(markdown) {
  return markdown
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/[`*_]/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

// The anchor ids Starlight gives a page's headings (h1 is the title, so not an anchor).
export function headingSlugs(markdown) {
  const slugger = new GithubSlugger()
  return docOutline(markdown)
    .headings.filter((heading) => heading.level > 1)
    .map((heading) => slugger.slug(headingText(heading.text)))
}

export function translationStatus(repoPath, locale, repoDir = REPO_DIR) {
  const target = translationPath(repoPath, locale)
  const file = path.join(repoDir, target)
  if (!existsSync(file)) {
    return { repoPath, target, state: 'missing' }
  }
  const source = readFileSync(path.join(repoDir, repoPath), 'utf8')
  const translation = parseTranslation(readFileSync(file, 'utf8'))
  if (translation.sourceHash !== sourceHash(source)) {
    return { repoPath, target, state: 'stale', recorded: translation.sourceHash }
  }
  const want = docOutline(source)
  const got = docOutline(translation.body)
  const levels = (outline) => outline.headings.map((heading) => heading.level).join(',')
  if (levels(want) !== levels(got)) {
    return { repoPath, target, state: 'misshapen', reason: 'headings differ in count or level' }
  }
  const changed = want.fences.findIndex((block, index) => block !== got.fences[index])
  if (changed !== -1 || want.fences.length !== got.fences.length) {
    return { repoPath, target, state: 'misshapen', reason: `code block ${changed + 1} differs` }
  }
  return { repoPath, target, state: 'current' }
}

export function stampTranslation(target, repoDir = REPO_DIR) {
  const rel = path.relative(repoDir, path.resolve(target)).split(path.sep).join('/')
  const locale = LOCALES.find((code) => DOC_ROOTS.some((root) => rel.startsWith(`${root}${code}/`)))
  if (!locale) {
    throw new Error(
      `${rel} is not a translation (expected docs/user/<locale>/ or docs/reference/<locale>/)`
    )
  }
  const source = rel.replace(`/${locale}/`, '/')
  const hash = sourceHash(readFileSync(path.join(repoDir, source), 'utf8'))
  const file = path.join(repoDir, rel)
  writeFileSync(file, withHash(readFileSync(file, 'utf8'), hash))
  return { target: rel, source, hash }
}
