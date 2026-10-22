import { GAME_ACTION_COMMAND } from './orchestrator-game-actions'
import { GAME_LINK_LABEL_MAX } from './orchestrator-game-integrations'
import { parseGithubWorkflowCommands, parseGitlabCiCommands } from './project-command-ci-parsers'
import {
  parseJustfileRecipes,
  parseMakefileTargets,
  parseRakefileTasks
} from './project-command-task-runner-parsers'
import type { ProjectDirEntry, ProjectFileReader } from './project-file-reader-contract'
import { isSetupScriptImportTextWithinLimit } from './setup-script-import-limits'
import {
  parsePackageJson,
  resolveNodePackageManager
} from './setup-script-package-manager-suggestion'

export type ProjectCommandSource =
  | 'package-json'
  | 'makefile'
  | 'justfile'
  | 'rakefile'
  | 'bin'
  | 'scripts'
  | 'github-actions'
  | 'gitlab-ci'

/** A command found in the repo. `run` is shell text shown as-is; `slashCommand` already fits the actions schema. */
export type ProjectCommandCandidate = {
  source: ProjectCommandSource
  file: string
  label: string
  run: string
  slashCommand: string
}

const MAX_CANDIDATES_PER_SOURCE = 20
const MAX_DIR_ENTRIES = 200
const MAX_RUN_LENGTH = 1000
// Why: GAME_ACTION_COMMAND accepts at most 24 characters.
const SLASH_COMMAND_MAX = 24
// Why: make and rake look these names up in this order; listing the root keeps case-insensitive disks from matching twice.
const MAKEFILE_NAMES = ['GNUmakefile', 'makefile', 'Makefile']
const JUSTFILE_NAMES = ['justfile', 'Justfile', 'JUSTFILE', '.justfile']
const RAKEFILE_NAMES = ['rakefile', 'Rakefile', 'rakefile.rb', 'Rakefile.rb']
// Why: npm runs these itself around install/publish/version; they are not buttons.
const NPM_LIFECYCLE_SCRIPTS: ReadonlySet<string> = new Set([
  'dependencies',
  'install',
  'postinstall',
  'postpack',
  'postprepare',
  'postpublish',
  'postversion',
  'preinstall',
  'prepack',
  'prepare',
  'preprepare',
  'prepublish',
  'prepublishOnly',
  'publish',
  'preversion',
  'version'
])
// Why: a long scripts list must not push these past the per-source cap.
const EVERYDAY_PACKAGE_SCRIPTS = [
  'dev',
  'start',
  'build',
  'test',
  'lint',
  'typecheck',
  'format',
  'check'
]
// Why: one busy release workflow must not crowd out the CI workflow people actually mirror.
const MAX_CANDIDATES_PER_WORKFLOW = 5
// Why: these characters survive both sh and cmd unquoted, so the name is never rewritten or escaped.
const SHELL_SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9:._/@+-]*$/
const SCRIPT_RUNNERS: Readonly<Record<string, string>> = {
  '': '',
  '.sh': 'bash ',
  '.bash': 'bash ',
  '.js': 'node ',
  '.mjs': 'node ',
  '.cjs': 'node ',
  '.py': 'python3 ',
  '.rb': 'ruby '
}

/** Reads the repo and proposes commands; never writes or runs anything. */
export async function detectProjectCommands(
  reader: ProjectFileReader
): Promise<ProjectCommandCandidate[]> {
  const readFile = async (path: string): Promise<string | null> => {
    const content = await reader.readFile(path)
    return content !== null && isSetupScriptImportTextWithinLimit(content) ? content : null
  }
  const rootEntries = (await reader.readDir('')) ?? []
  const rootFileNames = new Set(
    rootEntries.filter((entry) => !entry.isDirectory).map((entry) => entry.name)
  )
  const firstPresent = (names: string[]): string | null =>
    names.find((name) => rootFileNames.has(name)) ?? null

  const groups = await Promise.all([
    detectPackageScripts(readFile, reader),
    detectFromFile(readFile, firstPresent(MAKEFILE_NAMES), 'makefile', (content) =>
      parseMakefileTargets(content).map((target) => ({ name: target, run: `make ${target}` }))
    ),
    detectFromFile(readFile, firstPresent(JUSTFILE_NAMES), 'justfile', (content) =>
      parseJustfileRecipes(content).map((recipe) => ({ name: recipe, run: `just ${recipe}` }))
    ),
    detectFromFile(readFile, firstPresent(RAKEFILE_NAMES), 'rakefile', (content) => {
      const rake = rootFileNames.has('Gemfile') ? 'bundle exec rake' : 'rake'
      return parseRakefileTasks(content).map((task) => ({ name: task, run: `${rake} ${task}` }))
    }),
    detectDirectoryScripts(reader, 'bin'),
    detectDirectoryScripts(reader, 'scripts'),
    detectGithubWorkflows(readFile, reader),
    detectFromFile(readFile, firstPresent(['.gitlab-ci.yml']), 'gitlab-ci', parseGitlabCiCommands)
  ])
  return withUniqueSlashCommands(groups.flat())
}

const SLASH_COMMAND_SOURCE_PREFIX: Readonly<Record<ProjectCommandSource, string>> = {
  'package-json': 'package',
  makefile: 'make',
  justfile: 'just',
  rakefile: 'rake',
  bin: 'bin',
  scripts: 'scripts',
  'github-actions': 'github',
  'gitlab-ci': 'gitlab'
}

// Why: one slash command must name one candidate; the first in source order keeps the plain name.
function withUniqueSlashCommands(candidates: ProjectCommandCandidate[]): ProjectCommandCandidate[] {
  const taken = new Set<string>()
  return candidates.map((candidate) => {
    let command = candidate.slashCommand
    if (taken.has(command)) {
      const prefixed = `${SLASH_COMMAND_SOURCE_PREFIX[candidate.source]}-${command}`
      command = fitSlashCommand(prefixed, '')
      for (let n = 2; taken.has(command); n++) {
        command = fitSlashCommand(prefixed, `-${n}`)
      }
    }
    taken.add(command)
    return command === candidate.slashCommand ? candidate : { ...candidate, slashCommand: command }
  })
}

function fitSlashCommand(base: string, suffix: string): string {
  return `${base.slice(0, SLASH_COMMAND_MAX - suffix.length).replace(/-+$/, '')}${suffix}`
}

type NamedRun = { name: string; run: string }

async function detectFromFile(
  readFile: (path: string) => Promise<string | null>,
  file: string | null,
  source: ProjectCommandSource,
  parse: (content: string) => NamedRun[]
): Promise<ProjectCommandCandidate[]> {
  const content = file ? await readFile(file) : null
  if (!file || content === null) {
    return []
  }
  return toCandidates(
    source,
    parse(content).map((entry) => ({ ...entry, file }))
  )
}

async function detectPackageScripts(
  readFile: (path: string) => Promise<string | null>,
  reader: ProjectFileReader
): Promise<ProjectCommandCandidate[]> {
  const packageJson = parsePackageJson(await readFile('package.json'))
  const scripts = packageJson?.scripts
  if (!packageJson || typeof scripts !== 'object' || scripts === null || Array.isArray(scripts)) {
    return []
  }
  const names = Object.keys(scripts)
  const scriptNames = new Set(names)
  // Why: with conflicting lockfiles no manager is certain, and `npm run` runs any package's scripts.
  const manager =
    (await resolveNodePackageManager(packageJson, reader.fileExists))?.manager ?? 'npm'
  const runnable = names.filter(
    (name) =>
      SHELL_SAFE_NAME.test(name) &&
      !NPM_LIFECYCLE_SCRIPTS.has(name) &&
      !isPrePostHook(name, scriptNames)
  )
  const rank = (name: string): number => {
    const index = EVERYDAY_PACKAGE_SCRIPTS.indexOf(name)
    return index === -1 ? EVERYDAY_PACKAGE_SCRIPTS.length : index
  }
  return toCandidates(
    'package-json',
    runnable
      .toSorted((a, b) => rank(a) - rank(b))
      .map((name) => ({ name, run: `${manager} run ${name}`, file: 'package.json' }))
  )
}

function isPrePostHook(name: string, scriptNames: ReadonlySet<string>): boolean {
  const match = /^(pre|post)(.+)$/.exec(name)
  return match !== null && scriptNames.has(match[2])
}

async function detectDirectoryScripts(
  reader: ProjectFileReader,
  dir: 'bin' | 'scripts'
): Promise<ProjectCommandCandidate[]> {
  const entries: ProjectDirEntry[] = (await reader.readDir(dir)) ?? []
  const files = entries
    .slice(0, MAX_DIR_ENTRIES)
    .filter((entry) => !entry.isDirectory && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .filter((name) => SHELL_SAFE_NAME.test(name))
    .toSorted()
  const runs: (NamedRun & { file: string })[] = []
  for (const name of files) {
    const extension = /\.[^.]+$/.exec(name)?.[0] ?? ''
    const runner = SCRIPT_RUNNERS[extension]
    if (runner === undefined) {
      continue
    }
    const file = `${dir}/${name}`
    runs.push({
      name: name.slice(0, name.length - extension.length),
      run: `${runner}${file}`,
      file
    })
  }
  return toCandidates(dir, runs)
}

async function detectGithubWorkflows(
  readFile: (path: string) => Promise<string | null>,
  reader: ProjectFileReader
): Promise<ProjectCommandCandidate[]> {
  const workflowDir = '.github/workflows'
  const entries = (await reader.readDir(workflowDir)) ?? []
  const workflowFiles = entries
    .slice(0, MAX_DIR_ENTRIES)
    .filter((entry) => !entry.isDirectory && /\.ya?ml$/.test(entry.name))
    .map((entry) => `${workflowDir}/${entry.name}`)
    .toSorted()
  const runs: (NamedRun & { file: string })[] = []
  for (const file of workflowFiles) {
    const content = await readFile(file)
    if (content !== null) {
      const commands = parseGithubWorkflowCommands(content).slice(0, MAX_CANDIDATES_PER_WORKFLOW)
      runs.push(...commands.map((command) => ({ ...command, file })))
    }
  }
  return toCandidates('github-actions', runs)
}

function toCandidates(
  source: ProjectCommandSource,
  runs: (NamedRun & { file: string })[]
): ProjectCommandCandidate[] {
  const seen = new Set<string>()
  const candidates: ProjectCommandCandidate[] = []
  for (const { name, run, file } of runs) {
    if (candidates.length >= MAX_CANDIDATES_PER_SOURCE) {
      break
    }
    if (run.length > MAX_RUN_LENGTH || seen.has(run)) {
      continue
    }
    seen.add(run)
    candidates.push({ source, file, label: toLabel(name), run, slashCommand: toSlashCommand(name) })
  }
  return candidates
}

function toLabel(name: string): string {
  const words = name
    .split(/[\s:._/-]+/)
    .filter(Boolean)
    .join(' ')
  const label = words.charAt(0).toUpperCase() + words.slice(1)
  return label.length > GAME_LINK_LABEL_MAX
    ? `${label.slice(0, GAME_LINK_LABEL_MAX - 1)}…`
    : label || 'Run'
}

function toSlashCommand(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const prefixed = /^[a-z]/.test(slug) ? slug : `run-${slug}`
  const command = fitSlashCommand(prefixed, '')
  return GAME_ACTION_COMMAND.test(command) ? command : 'run'
}
