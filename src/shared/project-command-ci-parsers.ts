import { parse } from 'yaml'

export type CiCommand = { name: string; run: string }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function parseYamlRecord(content: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = parse(content)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** `run` steps, named by the step or else its job. */
export function parseGithubWorkflowCommands(content: string): CiCommand[] {
  const workflow = parseYamlRecord(content)
  if (!workflow || !isRecord(workflow.jobs)) {
    return []
  }
  const commands: CiCommand[] = []
  const workflowDefaults = runSettingsOf(defaultRunOf(workflow))
  for (const [jobId, job] of Object.entries(workflow.jobs)) {
    if (!isRecord(job) || !Array.isArray(job.steps)) {
      continue
    }
    // Why: Windows runners default `run` to pwsh unless a `shell` says otherwise.
    const runnerDefaults: RunSettings = isWindowsRunner(job['runs-on']) ? { shell: 'pwsh' } : {}
    const jobDefaults = {
      ...runnerDefaults,
      ...workflowDefaults,
      ...runSettingsOf(defaultRunOf(job))
    }
    for (const step of job.steps) {
      if (!isRecord(step) || typeof step.run !== 'string') {
        continue
      }
      if (!runsAsRootPosixShell({ ...jobDefaults, ...runSettingsOf(step) })) {
        continue
      }
      const run = step.run.trim()
      // Why: `${{ }}` only resolves inside Actions; multi-line and sudo steps are CI plumbing.
      if (run.length === 0 || run.includes('${{') || run.includes('\n') || /^sudo\s/.test(run)) {
        continue
      }
      commands.push({ name: typeof step.name === 'string' ? step.name : jobId, run })
    }
  }
  return commands
}

function isWindowsRunner(runsOn: unknown): boolean {
  const labels = Array.isArray(runsOn) ? runsOn : [runsOn]
  return labels.some((label) => typeof label === 'string' && /windows/i.test(label))
}

type RunSettings = { shell?: unknown; workingDirectory?: unknown }

function defaultRunOf(scope: Record<string, unknown>): Record<string, unknown> {
  return isRecord(scope.defaults) && isRecord(scope.defaults.run) ? scope.defaults.run : {}
}

/** Only the keys present, so a step without them keeps its job's and workflow's defaults. */
function runSettingsOf(run: Record<string, unknown>): RunSettings {
  const settings: RunSettings = {}
  if (run.shell !== undefined) {
    settings.shell = run.shell
  }
  if (run['working-directory'] !== undefined) {
    settings.workingDirectory = run['working-directory']
  }
  return settings
}

// Why: a step in a subfolder or under pwsh/cmd would be the wrong command typed at the repo root.
function runsAsRootPosixShell({ shell, workingDirectory }: RunSettings): boolean {
  const atRoot =
    workingDirectory === undefined ||
    (typeof workingDirectory === 'string' && /^\.?\/?$/.test(workingDirectory.trim()))
  const posixShell = shell === undefined || shell === 'bash' || shell === 'sh'
  return atRoot && posixShell
}

const GITLAB_RESERVED_KEYS: ReadonlySet<string> = new Set([
  'after_script',
  'before_script',
  'cache',
  'default',
  'image',
  'include',
  'services',
  'stages',
  'variables',
  'workflow'
])

/** Jobs whose `script` is one line that runs as typed at the repo root. Hidden `.template` jobs are skipped. */
export function parseGitlabCiCommands(content: string): CiCommand[] {
  const config = parseYamlRecord(content)
  if (!config) {
    return []
  }
  const commands: CiCommand[] = []
  for (const [jobName, job] of Object.entries(config)) {
    if (jobName.startsWith('.') || GITLAB_RESERVED_KEYS.has(jobName) || !isRecord(job)) {
      continue
    }
    const lines = (Array.isArray(job.script) ? job.script : [job.script]).filter(
      (line): line is string => typeof line === 'string' && line.trim().length > 0
    )
    const run = lines.length === 1 ? lines[0].trim() : ''
    // Why: same contract as GitHub steps; $CI_ variables only resolve inside GitLab, and multi-line and sudo jobs are CI plumbing.
    if (run.length === 0 || run.includes('\n') || /\$\{?CI_/.test(run) || /^sudo\s/.test(run)) {
      continue
    }
    commands.push({ name: jobName, run })
  }
  return commands
}
