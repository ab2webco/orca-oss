#!/usr/bin/env node
/**
 * CLI wrapper: turns the measured state of a pushed upstream sync branch into an
 * open/withdraw verdict, writes the PR (or closing-comment) body to a file, and
 * publishes the verdict to GITHUB_OUTPUT and the job summary. Exits non-zero only
 * when the measurement itself is missing, which is a broken workflow, not a sync.
 *
 * Usage:
 *   node config/scripts/decide-upstream-sync-pr.mjs --base main \
 *     --sync-branch upstream-sync/main --behind 699 --dropped 676 \
 *     --conflicts true --body-file body.md [--workflow-commits n] \
 *     [--workflow-discard-file diffstat.txt]
 */

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'

import { decideSyncPr, renderSyncPrBody, SYNC_PR_REASON } from './upstream-sync-pr-gate.mjs'

const VALUE_FLAGS = {
  base: 'base',
  'sync-branch': 'syncBranch',
  behind: 'behind',
  dropped: 'dropped',
  conflicts: 'conflicts',
  'body-file': 'bodyFile',
  'workflow-commits': 'workflowCommits',
  'workflow-discard-file': 'workflowDiscardFile',
  summary: 'summary',
  output: 'output'
}
const REQUIRED = ['base', 'syncBranch', 'behind', 'bodyFile']

function parseArgs(argv) {
  const options = {
    conflicts: 'false',
    dropped: '',
    workflowCommits: '0',
    workflowDiscardFile: '',
    summary: process.env.GITHUB_STEP_SUMMARY,
    output: process.env.GITHUB_OUTPUT
  }
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]
    if (!flag.startsWith('--')) {
      throw new Error(`Unexpected argument: ${flag}`)
    }
    const key = flag.slice(2)
    if (!(key in VALUE_FLAGS)) {
      throw new Error(`Unknown flag: ${flag}`)
    }
    const value = argv[index + 1]
    if (value === undefined) {
      throw new Error(`Missing value for ${flag}`)
    }
    options[VALUE_FLAGS[key]] = value
  }
  for (const key of REQUIRED) {
    if (!options[key]) {
      throw new Error(`Missing required --${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`)
    }
  }
  return options
}

/** Missing is normal: the retention commit is empty when upstream touched no workflow. */
function readDiscard(path) {
  if (!path) {
    return ''
  }
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

function main(argv) {
  const options = parseArgs(argv)
  const context = {
    behind: options.behind,
    base: options.base,
    syncBranch: options.syncBranch,
    workflowCommits: options.workflowCommits,
    workflowDiscard: readDiscard(options.workflowDiscardFile)
  }
  const decision = decideSyncPr({
    behind: options.behind,
    dropped: options.dropped,
    conflicts: options.conflicts === 'true',
    base: options.base,
    syncBranch: options.syncBranch
  })
  const body = renderSyncPrBody(decision, context)
  writeFileSync(options.bodyFile, body, 'utf8')

  if (options.output) {
    appendFileSync(
      options.output,
      [
        `action=${decision.action}`,
        `reason=${decision.reason}`,
        `mergeable=${decision.mergeable}`,
        `dropped=${decision.dropped ?? ''}`,
        `title=${decision.title}`,
        ''
      ].join('\n')
    )
  }
  const summary = [
    '## Upstream sync PR gate',
    '',
    `**${decision.action === 'open' ? 'OPEN PR' : 'BRANCH ONLY'}** — ${decision.headline}`,
    '',
    '| Field | Value |',
    '| --- | --- |',
    `| Base | \`${options.base}\` |`,
    `| Sync branch | \`${options.syncBranch}\` |`,
    `| New upstream commits | ${options.behind} |`,
    `| Base commits the branch drops | ${decision.dropped ?? 'unmeasured'} |`,
    `| Reason | \`${decision.reason}\` |`,
    ''
  ].join('\n')
  if (options.summary) {
    appendFileSync(options.summary, `${summary}\n`)
  }
  process.stdout.write(`${summary}\n`)
  return decision.reason === SYNC_PR_REASON.UNMEASURED ? 1 : 0
}

process.exit(main(process.argv.slice(2)))
