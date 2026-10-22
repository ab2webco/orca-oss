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
  for (const [jobId, job] of Object.entries(workflow.jobs)) {
    if (!isRecord(job) || !Array.isArray(job.steps)) {
      continue
    }
    for (const step of job.steps) {
      if (!isRecord(step) || typeof step.run !== 'string') {
        continue
      }
      const run = step.run.trim()
      // Why: `${{ }}` only resolves inside Actions; locally it is a shell syntax error.
      if (run.length === 0 || run.includes('${{')) {
        continue
      }
      commands.push({ name: typeof step.name === 'string' ? step.name : jobId, run })
    }
  }
  return commands
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

/** One command per job: its `script` lines in order. Hidden `.template` jobs are skipped. */
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
    if (lines.length > 0) {
      commands.push({ name: jobName, run: lines.map((line) => line.trim()).join('\n') })
    }
  }
  return commands
}
