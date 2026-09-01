#!/usr/bin/env node
// Static analysis never parses the shell inside a workflow `run:` block, so a syntax
// error there ships with every check green and only fails when the step executes.
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const workflowsDirectory = fileURLToPath(new URL('../../.github/workflows', import.meta.url))

// GitHub expands these before bash sees them; left in place they are a bash syntax error.
function withoutGithubExpressions(script) {
  return script.replace(/\$\{\{[^}]*\}\}/g, 'GITHUB_EXPRESSION')
}

function isBashStep(step, jobDefaults, workflowDefaults) {
  const shell = step.shell ?? jobDefaults?.run?.shell ?? workflowDefaults?.run?.shell
  return shell === undefined || shell === 'bash' || shell === 'sh'
}

function runScripts(workflow) {
  const scripts = []
  for (const [jobName, job] of Object.entries(workflow?.jobs ?? {})) {
    for (const [index, step] of (job?.steps ?? []).entries()) {
      if (typeof step?.run !== 'string' || !isBashStep(step, job.defaults, workflow.defaults)) {
        continue
      }
      scripts.push({ jobName, label: step.name ?? `step ${index + 1}`, script: step.run })
    }
  }
  return scripts
}

const failures = []
for (const fileName of readdirSync(workflowsDirectory).filter((name) => /\.ya?ml$/.test(name))) {
  const workflow = parse(readFileSync(join(workflowsDirectory, fileName), 'utf8'))
  for (const { jobName, label, script } of runScripts(workflow)) {
    try {
      execFileSync('bash', ['-n'], { input: withoutGithubExpressions(script), stdio: 'pipe' })
    } catch (error) {
      const detail = String(error.stderr ?? error.message)
        .trim()
        .split('\n')[0]
      failures.push(`${fileName} › ${jobName} › ${label}: ${detail}`)
    }
  }
}

if (failures.length > 0) {
  console.error(`Workflow run-block shell syntax check failed (${failures.length}):`)
  for (const failure of failures) {
    console.error(`  ${failure}`)
  }
  process.exit(1)
}

console.log('Workflow run-block shell syntax OK.')
