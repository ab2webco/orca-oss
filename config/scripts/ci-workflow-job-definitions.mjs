/**
 * Maps a GitHub Actions API job name back to the workflow job that produced it,
 * so the classifier knows that job's `timeout-minutes` and which jobs are its
 * matrix siblings. Both facts are absent from the jobs API.
 *
 * The API reports a job as its rendered `name`, prefixed with `<caller job> / `
 * when it came from a reusable workflow. Matrix expressions are unknowable here,
 * so each declared name becomes a pattern with `${{ … }}` widened to a wildcard.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'

const EXPRESSION = /\$\{\{[^}]*\}\}/g
const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g

export function buildJobNamePattern(declaredName) {
  const source = declaredName
    .split(EXPRESSION)
    .map((literal) => literal.replace(REGEX_SPECIALS, '\\$&'))
    .join('(?:.+?)')
  return new RegExp(`^${source}$`)
}

export function collectWorkflowJobDefinitions(workflowDirectory) {
  const definitions = []
  const files = readdirSync(workflowDirectory)
    .filter((file) => /\.ya?ml$/.test(file))
    .sort()
  for (const file of files) {
    const workflow = parse(readFileSync(join(workflowDirectory, file), 'utf8'))
    for (const [jobKey, job] of Object.entries(workflow?.jobs ?? {})) {
      if (!job || typeof job !== 'object') {
        continue
      }
      const declaredName = typeof job.name === 'string' ? job.name : jobKey
      const timeout = job['timeout-minutes']
      definitions.push({
        workflowFile: file,
        jobKey,
        declaredName,
        namePattern: buildJobNamePattern(declaredName),
        timeoutMinutes: typeof timeout === 'number' ? timeout : null
      })
    }
  }
  return definitions
}

/**
 * Resolves an API job name against the collected definitions. Returns null unless
 * exactly one definition matches — an ambiguous name must degrade to "unknown
 * budget, unknown siblings", never to a guessed one.
 */
export function createJobDefinitionResolver(definitions) {
  const cache = new Map()
  return (jobName) => {
    if (typeof jobName !== 'string') {
      return null
    }
    if (cache.has(jobName)) {
      return cache.get(jobName)
    }
    // Why the suffix first: a caller prefix makes the full name still match a
    // wildcard pattern from the called workflow — `e2e ${{ matrix.shard_name }}`
    // swallows `e2e (full) / changed e2e specs`. The reusable-workflow job name
    // is the part after the last separator, so try it before the full name.
    const separator = jobName.lastIndexOf(' / ')
    const candidates = separator === -1 ? [jobName] : [jobName.slice(separator + 3), jobName]
    let resolved = null
    for (const candidate of candidates) {
      const matches = definitions.filter((definition) => definition.namePattern.test(candidate))
      if (matches.length === 0) {
        continue
      }
      resolved = matches.length === 1 ? matches[0] : null
      break
    }
    cache.set(jobName, resolved)
    return resolved
  }
}
