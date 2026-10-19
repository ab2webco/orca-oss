#!/usr/bin/env node
// Why this gate exists: lab.102 handed Claude Code a plugin dir inside the signed app, Claude wrote
// .claude-plugin/types/ into it, and macOS then reported Orca as damaged (ORCA-662). Every source
// check passed; only the packaged app, launched the way a user launches it, shows the break.
//
// Usage: verify-packaged-claude-plugin-seal.mjs --app <Orca.app | *-unpacked dir> [--executable <path>]
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// Must match ORCA_CLAUDE_PLUGIN_DIR_PROBE_OUT in src/main/claude/claude-plugin-dir-probe.ts.
const PROBE_OUT_ENV = 'ORCA_CLAUDE_PLUGIN_DIR_PROBE_OUT'
// Why a cap and not a budget: it only turns a hung launch into a named failure.
const PROBE_HANG_GUARD_MS = 180_000

function realpathOrResolved(value) {
  try {
    return realpathSync.native(value)
  } catch {
    return path.resolve(value)
  }
}

/** Plugin dirs that resolve inside the packaged app, symlinks followed. */
export function pluginDirsInsideApp({
  pluginDirs,
  appRoot,
  platform,
  realpath = realpathOrResolved
}) {
  const fold = platform === 'darwin' || platform === 'win32' ? (v) => v.toLowerCase() : (v) => v
  const pathApi = platform === 'win32' ? path.win32 : path.posix
  const root = fold(realpath(appRoot))
  return pluginDirs.filter((dir) => {
    const relative = pathApi.relative(root, fold(realpath(dir)))
    return relative === '' || (!relative.startsWith('..') && !pathApi.isAbsolute(relative))
  })
}

/** Every entry under root, keyed by its /-separated relative path; symlinks are not followed. */
export function snapshotTree(root) {
  const entries = new Map()
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const absolute = path.join(dir, name)
      const relative = path.relative(root, absolute).split(path.sep).join('/')
      const stat = lstatSync(absolute)
      if (stat.isSymbolicLink()) {
        entries.set(relative, `link:${readlinkSync(absolute)}`)
      } else if (stat.isDirectory()) {
        entries.set(relative, 'dir')
        walk(absolute)
      } else {
        entries.set(
          relative,
          `file:${createHash('sha256').update(readFileSync(absolute)).digest('hex')}`
        )
      }
    }
  }
  walk(root)
  return entries
}

export function diffTreeSnapshots(before, after) {
  const changes = []
  for (const [relative, value] of after) {
    if (!before.has(relative)) {
      changes.push(`added ${relative}`)
    } else if (before.get(relative) !== value) {
      changes.push(`changed ${relative}`)
    }
  }
  for (const relative of before.keys()) {
    if (!after.has(relative)) {
      changes.push(`removed ${relative}`)
    }
  }
  return changes.sort((a, b) => {
    const pathA = a.slice(a.indexOf(' ') + 1)
    const pathB = b.slice(b.indexOf(' ') + 1)
    return pathA < pathB ? -1 : pathA > pathB ? 1 : 0
  })
}

/** What Claude Code 2.1.302+ does to every --plugin-dir it loads. */
export function simulateClaudePluginWrite(pluginDir) {
  const typesDir = path.join(pluginDir, '.claude-plugin', 'types')
  mkdirSync(typesDir, { recursive: true })
  writeFileSync(path.join(typesDir, 'orca-663-probe.d.ts'), 'export {}\n')
}

const MAX_LISTED_CHANGES = 20

export function sealVerdict({ appRoot, pluginDirs, insideApp, treeChanges, codesign }) {
  const failures = []
  if (pluginDirs.length === 0) {
    failures.push(
      'ORCA-663 no-plugin-dir: the packaged app handed Claude no plugin dir, so this check cannot ' +
        'attest the seal. The bundled orca-game plugin is missing or the launch path stopped passing it.'
    )
  }
  if (insideApp.length > 0) {
    failures.push(
      `ORCA-663 plugin-dir-inside-app: Orca hands Claude ${insideApp.join(', ')}, inside ${appRoot}. ` +
        'Claude Code writes .claude-plugin/types/ into every plugin dir it loads, which breaks the ' +
        'signed app (ORCA-662). Hand it a copy under userData instead.'
    )
  }
  if (treeChanges.length > 0) {
    const listed = treeChanges.slice(0, MAX_LISTED_CHANGES).join('; ')
    const more =
      treeChanges.length > MAX_LISTED_CHANGES
        ? ` (+${treeChanges.length - MAX_LISTED_CHANGES} more)`
        : ''
    failures.push(
      `ORCA-663 app-tree-changed: ${treeChanges.length} path(s) under ${appRoot} changed after the ` +
        `Claude plugin load path ran: ${listed}${more}`
    )
  }
  if (codesign && !codesign.ok) {
    failures.push(
      `ORCA-663 codesign-seal-broken: codesign --verify --deep --strict rejects ${appRoot} after the ` +
        `Claude plugin load path ran, so macOS would report the app as damaged: ${codesign.output.trim()}`
    )
  }
  return { ok: failures.length === 0, failures }
}

function verifyCodesign(appRoot) {
  const result = spawnSync('codesign', ['--verify', '--deep', '--strict', appRoot], {
    encoding: 'utf8'
  })
  return { ok: result.status === 0, output: `${result.stderr ?? ''}${result.stdout ?? ''}` }
}

function macExecutableOf(appRoot) {
  const result = spawnSync(
    'plutil',
    [
      '-extract',
      'CFBundleExecutable',
      'raw',
      '-o',
      '-',
      path.join(appRoot, 'Contents', 'Info.plist')
    ],
    { encoding: 'utf8' }
  )
  if (result.status !== 0) {
    throw new Error(`cannot read CFBundleExecutable from ${appRoot}: ${result.stderr}`)
  }
  return path.join(appRoot, 'Contents', 'MacOS', result.stdout.trim())
}

function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    if (key !== '--app' && key !== '--executable') {
      throw new Error(`unknown argument ${key}`)
    }
    options[key.slice(2)] = argv[index + 1]
  }
  if (!options.app) {
    throw new Error('--app is required')
  }
  return options
}

/** Launches the packaged app with the probe env and returns the plugin dirs it would hand Claude. */
function runProbe({ executable, platform, workDir }) {
  const home = path.join(workDir, 'home')
  const out = path.join(workDir, 'probe.json')
  mkdirSync(home, { recursive: true })
  const env = {
    ...process.env,
    [PROBE_OUT_ENV]: out,
    // Why the E2E profile: it is the one packaged builds already honour, so the probe never takes
    // the single-instance lock or the userData of an Orca the operator is running.
    ORCA_E2E_USER_DATA_DIR: path.join(workDir, 'user-data'),
    ORCA_E2E_HOME_DIR: home,
    HOME: home,
    USERPROFILE: home
  }
  delete env.ELECTRON_RUN_AS_NODE
  // Why: a --dir build leaves chrome-sandbox without the setuid bit Chromium requires.
  const args = platform === 'linux' ? ['--no-sandbox'] : []
  const result = spawnSync(executable, args, {
    env,
    encoding: 'utf8',
    timeout: PROBE_HANG_GUARD_MS
  })
  if (!existsSync(out)) {
    const tail = `${result.stderr ?? ''}`.split('\n').slice(-40).join('\n')
    throw new Error(
      `ORCA-663 probe-failed: ${executable} exited (status ${result.status}, signal ${result.signal}` +
        `${result.error ? `, ${result.error.message}` : ''}) without reporting its plugin dirs.\n${tail}`
    )
  }
  const report = JSON.parse(readFileSync(out, 'utf8'))
  if (typeof report.error === 'string') {
    throw new Error(
      `ORCA-663 probe-failed: the packaged app could not resolve its plugin dirs: ${report.error}`
    )
  }
  return report.pluginDirs
}

function reportFailure(message) {
  if (process.env.GITHUB_ACTIONS === 'true') {
    process.stdout.write(
      `::error title=ORCA-663 packaged plugin seal::${message.replaceAll('\n', '%0A')}\n`
    )
  }
  process.stderr.write(`${message}\n`)
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const platform = process.platform
  const appRoot = path.resolve(options.app)
  const executable = options.executable
    ? path.resolve(options.executable)
    : platform === 'darwin'
      ? macExecutableOf(appRoot)
      : null
  if (!executable) {
    throw new Error('--executable is required outside macOS')
  }
  if (platform === 'darwin') {
    const baseline = verifyCodesign(appRoot)
    if (!baseline.ok) {
      reportFailure(
        `ORCA-663 codesign-baseline-invalid: ${appRoot} fails codesign before the probe ran, so a ` +
          `failure after it would prove nothing. Sign it first (ad-hoc is enough): ${baseline.output.trim()}`
      )
      process.exitCode = 1
      return
    }
  }
  const before = snapshotTree(appRoot)
  const workDir = mkdtempSync(path.join(tmpdir(), 'orca-663-probe-'))
  const pluginDirs = runProbe({ executable, platform, workDir })
  const insideApp = pluginDirsInsideApp({ pluginDirs, appRoot, platform })
  for (const dir of pluginDirs) {
    simulateClaudePluginWrite(dir)
  }
  const verdict = sealVerdict({
    appRoot,
    pluginDirs,
    insideApp,
    treeChanges: diffTreeSnapshots(before, snapshotTree(appRoot)),
    codesign: platform === 'darwin' ? verifyCodesign(appRoot) : null
  })
  if (!verdict.ok) {
    verdict.failures.forEach(reportFailure)
    process.exitCode = 1
    return
  }
  process.stdout.write(
    `[verify-packaged-claude-plugin-seal] OK — ${appRoot} stays intact after Claude loads ${pluginDirs.join(', ')}\n`
  )
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main()
  } catch (error) {
    reportFailure(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
