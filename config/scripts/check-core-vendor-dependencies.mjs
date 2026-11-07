import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

// Owner rule 2026-11-04 (ORCA-1005): Orca works in full with no plugin, so core never needs Jev,
// Sonar or Engram. Code that names one is confined to the adapters in ALLOWLIST_PATH, each of
// which must keep working when its vendor is absent; nothing in core may link a vendor's code.

export const ALLOWLIST_PATH = 'config/core-vendor-adapters.txt'
const CORE_ROOTS = ['src', 'resources/claude-plugins/orca-game/hooks']
const SOURCE = /\.(?:[cm]?[jt]sx?)$/
const NOT_CORE = /(?:\.test\.|\.spec\.|test-fixtures|__tests__|__fixtures__|\/tests?\/)/

export const VENDORS = {
  jev: /jev/i,
  sonar: /sonar/i,
  engram: /engram/i
}

/** Source text with comments blanked, so a mention in prose never counts as a dependency. */
export function stripComments(text) {
  let out = ''
  let quote = null
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    const next = text[i + 1]
    if (quote) {
      out += char
      if (char === '\\') {
        out += next ?? ''
        i++
      } else if (char === quote) {
        quote = null
      }
      continue
    }
    if (char === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') {
        i++
      }
      out += '\n'
      continue
    }
    if (char === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2)
      const body = text.slice(i, end === -1 ? text.length : end + 2)
      out += body.replace(/[^\n]/g, ' ')
      i = end === -1 ? text.length : end + 1
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char
    }
    out += char
  }
  return out
}

/** Module specifiers a file imports or requires. */
export function importSpecifiers(code) {
  const found = []
  const pattern = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)(['"])([^'"\n]+)\1/g
  for (const match of code.matchAll(pattern)) {
    found.push(match[2])
  }
  return found
}

const isRelative = (specifier) => specifier.startsWith('.') || specifier.startsWith('/')

/** Which vendors a core file's code (not its comments) names, and which it links as a package. */
export function vendorUseOf(text) {
  const code = stripComments(text)
  const named = Object.keys(VENDORS).filter((vendor) => VENDORS[vendor].test(code))
  const linked = importSpecifiers(code)
    .filter((specifier) => !isRelative(specifier))
    .flatMap((specifier) =>
      Object.keys(VENDORS)
        .filter((vendor) => VENDORS[vendor].test(specifier))
        .map((vendor) => ({ vendor, specifier }))
    )
  return { named, linked }
}

export function parseAllowlist(text) {
  const entries = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) {
      continue
    }
    const match = /^(\S+)\s+(\S+)\s+--\s+(.+)$/.exec(line)
    if (!match || !(match[1] in VENDORS)) {
      throw new Error(`Malformed ${ALLOWLIST_PATH} line (want "<vendor> <path> -- <why>"): ${raw}`)
    }
    entries.push({ vendor: match[1], file: match[2], why: match[3] })
  }
  return entries
}

/** Vendor packages in a package.json's dependency maps. */
export function vendorPackagesOf(manifest) {
  const found = []
  for (const field of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies'
  ]) {
    for (const name of Object.keys(manifest[field] ?? {})) {
      for (const vendor of Object.keys(VENDORS)) {
        if (VENDORS[vendor].test(name)) {
          found.push({ vendor, field, name })
        }
      }
    }
  }
  return found
}

/**
 * Problems for core `files` ({ path, text }) against the allowlist and package manifest.
 * An allowlisted file that stopped naming its vendor is a problem too, so the list only shrinks.
 */
export function findVendorProblems({ files, allowlist, manifest }) {
  const problems = []
  const allowed = new Set(allowlist.map((entry) => `${entry.vendor} ${entry.file}`))
  const seen = new Set()
  for (const { path: file, text } of files) {
    const { named, linked } = vendorUseOf(text)
    for (const vendor of named) {
      seen.add(`${vendor} ${file}`)
      if (!allowed.has(`${vendor} ${file}`)) {
        problems.push(
          `${file} names ${vendor} in code. Core must work without it: move that code into an adapter that degrades when ${vendor} is absent, and list it in ${ALLOWLIST_PATH} with why.`
        )
      }
    }
    for (const { vendor, specifier } of linked) {
      problems.push(
        `${file} imports '${specifier}': core never links ${vendor}'s code, only reaches it over its CLI, HTTP or a plugin.`
      )
    }
  }
  for (const entry of allowlist) {
    if (!seen.has(`${entry.vendor} ${entry.file}`)) {
      problems.push(
        `${ALLOWLIST_PATH} lists ${entry.file} for ${entry.vendor}, which it no longer names: drop the line.`
      )
    }
  }
  for (const { vendor, field, name } of vendorPackagesOf(manifest)) {
    problems.push(`package.json ${field} has ${name}: core must not depend on ${vendor}.`)
  }
  return problems
}

export function coreFilesOf(cwd = process.cwd()) {
  const listed = execFileSync('git', ['ls-files', '-z', '--', ...CORE_ROOTS], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024
  })
  return listed
    .split('\0')
    .filter((file) => file && SOURCE.test(file) && !NOT_CORE.test(file))
    .filter((file) => !file.endsWith('.d.ts') || file.startsWith('resources/'))
    .map((file) => ({ path: file, text: fs.readFileSync(path.join(cwd, file), 'utf8') }))
}

export function main(cwd = process.cwd()) {
  const problems = findVendorProblems({
    files: coreFilesOf(cwd),
    allowlist: parseAllowlist(fs.readFileSync(path.join(cwd, ALLOWLIST_PATH), 'utf8')),
    manifest: JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'))
  })
  for (const problem of problems) {
    console.error(`core vendor dependency: ${problem}`)
  }
  if (problems.length === 0) {
    console.log('core vendor dependencies: none outside the listed adapters')
  }
  return problems.length === 0 ? 0 : 1
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit(main())
}
