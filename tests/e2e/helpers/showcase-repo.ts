import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

// The "Lumen" demo app the recorded clips open instead of the e2e fixture repo, so the sidebar
// and tabs read `lumen-app` on `main`. Use with `test.use({ seedTestRepo: false })`.
const FILES: Record<string, string> = {
  'package.json': `${JSON.stringify({ name: 'lumen-app', version: '2.3.0', private: true }, null, 2)}\n`,
  'README.md': '# Lumen\n\nA photo journal for iOS, Android and the web.\n',
  'src/feed/offline-cache.ts': [
    "import { openStore } from '../storage/store'",
    '',
    'const MAX_BYTES = 40 * 1024 * 1024',
    '',
    'export async function cacheFeed(posts: { id: string; body: string }[]) {',
    "  const store = await openStore('feed')",
    '  let used = 0',
    '  for (const post of posts) {',
    '    used += post.body.length',
    '    if (used > MAX_BYTES) break',
    '    await store.put(post.id, post.body)',
    '  }',
    '}',
    ''
  ].join('\n'),
  'src/feed/fetch-feed.ts': [
    'export async function fetchFeed(url: string): Promise<Response> {',
    '  const response = await fetch(url)',
    "  if (!response.ok) throw new Error('feed unavailable')",
    '  return response',
    '}',
    ''
  ].join('\n'),
  'src/settings/theme.ts': [
    "export type Theme = 'light' | 'dark' | 'system'",
    '',
    "export const defaultTheme: Theme = 'system'",
    ''
  ].join('\n'),
  'src/storage/store.ts': [
    'export async function openStore(name: string) {',
    '  const entries = new Map<string, string>()',
    '  return { name, put: async (key: string, value: string) => void entries.set(key, value) }',
    '}',
    ''
  ].join('\n')
}

// Why a fixed folder when recording: the diff header prints the absolute path, and a temp one
// reads as a test fixture.
const RECORDED_REPO = '/Users/Shared/code/lumen-app'
const MARKER = '.orca-showcase'

function freshRepoDir(): string {
  if (process.env.ORCA_SHOWCASE_CLIPS !== '1' || process.platform !== 'darwin') {
    return join(realpathSync(mkdtempSync(join(tmpdir(), 'orca-showcase-'))), 'lumen-app')
  }
  if (existsSync(RECORDED_REPO)) {
    if (!existsSync(join(RECORDED_REPO, '.git', MARKER))) {
      throw new Error(`${RECORDED_REPO} exists and is not a showcase repo; move it first`)
    }
    rmSync(RECORDED_REPO, { recursive: true, force: true })
  }
  return RECORDED_REPO
}

export function createShowcaseRepo(): string {
  const repo = freshRepoDir()
  mkdirSync(repo, { recursive: true })
  for (const [path, body] of Object.entries(FILES)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true })
    writeFileSync(join(repo, path), body)
  }
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', repo, ...args], {
      stdio: 'ignore',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Lumen',
        GIT_AUTHOR_EMAIL: 'team@example.com',
        GIT_COMMITTER_NAME: 'Lumen',
        GIT_COMMITTER_EMAIL: 'team@example.com'
      }
    })
  // Why symbolic-ref: `init -b` needs Git 2.28.
  git('init', '-q')
  git('symbolic-ref', 'HEAD', 'refs/heads/main')
  // Why inside .git: a marker in the tree would show in the file explorer.
  writeFileSync(join(repo, '.git', MARKER), '')
  git('add', '.')
  git('commit', '-q', '-m', 'Lumen 2.3 beta')
  return repo
}
