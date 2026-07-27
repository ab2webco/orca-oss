#!/usr/bin/env node
// Reports skipIf(process.platform …) coverage to the job summary so the gap
// between the ubuntu and Windows gates is a visible datum, not silence. Run on
// both runners: each declares which platform-guarded class it executes and
// which it leaves to its sibling job. Counts source guards (a describe.skipIf
// hiding several cases counts as one) — the vitest run carries the live count.
import { appendFileSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const WIN32_ONLY = /skipIf\(process\.platform !== 'win32'\)/g
const POSIX_ONLY = /skipIf\(process\.platform === 'win32'\)/g
const TEST_EXT = /\.(test|spec)\.(ts|tsx|mjs)$/

function walkTestFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') {
      continue
    }
    const p = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...walkTestFiles(p))
    } else if (TEST_EXT.test(entry.name)) {
      out.push(p)
    }
  }
  return out
}

const root = process.cwd()
const files = [...walkTestFiles(join(root, 'src')), ...walkTestFiles(join(root, 'config/scripts'))]

let win32Guards = 0
let posixGuards = 0
const win32Files = []
for (const f of files) {
  const src = readFileSync(f, 'utf8')
  const w = src.match(WIN32_ONLY)?.length ?? 0
  if (w > 0) {
    win32Guards += w
    win32Files.push({ path: f.slice(root.length + 1), guards: w })
  }
  posixGuards += src.match(POSIX_ONLY)?.length ?? 0
}

const isWin = process.platform === 'win32'
const sibling = isWin ? 'verify (ubuntu-latest)' : 'verify-windows (windows-2022)'
const lines = [
  '### Platform test coverage',
  '',
  `Runner: **${process.platform}**`,
  '',
  '| Guard | Source guards | This runner |',
  '| --- | ---: | --- |',
  `| \`skipIf(platform !== 'win32')\` — Windows-only | ${win32Guards} | ${isWin ? 'executed here' : `skipped — see ${sibling}`} |`,
  `| \`skipIf(platform === 'win32')\` — POSIX-only | ${posixGuards} | ${isWin ? `skipped — see ${sibling}` : 'executed here'} |`,
  ''
]
if (!isWin && win32Guards > 0) {
  lines.push(
    `**${win32Guards}** Windows-only guard(s) in **${win32Files.length}** file(s) never execute on this runner — they need a Windows host.`,
    '',
    '<details><summary>Windows-only test files</summary>',
    '',
    ...win32Files.map((f) => `- \`${f.path}\` (${f.guards})`),
    '',
    '</details>',
    ''
  )
}

const block = `${lines.join('\n')}\n`
const target = process.env.GITHUB_STEP_SUMMARY
if (target) {
  appendFileSync(target, block)
} else {
  process.stdout.write(block)
}
