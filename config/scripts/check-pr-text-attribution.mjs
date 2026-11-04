#!/usr/bin/env node
// The commit gate never sees a PR's title or body, yet a squash merge can copy both into the
// commit that lands, and the lead had to strip the Claude Code signature from 11 PR bodies by
// hand (ORCA-1032). This judges the PR text with the commit gate's own rules.
import { readFileSync } from 'node:fs'
import process from 'node:process'
import { findAiAttribution } from './check-ai-attribution.mjs'

// The queue's branch is `gh-readonly-queue/<base>/pr-<number>-<head sha>`.
const QUEUE_REF = /\/pr-(\d+)-[0-9a-f]+$/

/** @param {{ title?: string | null, body?: string | null }} pr */
export function findPrTextAttribution(pr) {
  return [
    ...findAiAttribution(pr.title ?? '').map((finding) => ({ field: 'title', ...finding })),
    ...findAiAttribution(pr.body ?? '').map((finding) => ({ field: 'body', ...finding }))
  ]
}

/**
 * The text to judge. A pull_request payload already carries the text the triggering edit wrote;
 * a merge group carries none, so the live PR is read — that is what catches an edit made after
 * the last push.
 *
 * @param {{ eventName: string, event: any, fetchPr: (number: number) => Promise<{ title: string, body: string | null }> }} input
 */
export async function prTextForEvent({ eventName, event, fetchPr }) {
  if (eventName === 'pull_request' || eventName === 'pull_request_target') {
    return { number: event.pull_request.number, ...event.pull_request }
  }
  if (eventName === 'merge_group') {
    const ref = event.merge_group?.head_ref ?? ''
    const match = QUEUE_REF.exec(ref)
    // Why fail rather than skip: a gate that goes quiet when it cannot find its PR proves nothing.
    if (!match) {
      throw new Error(`cannot find the PR number in merge group ref "${ref}"`)
    }
    const number = Number(match[1])
    return { number, ...(await fetchPr(number)) }
  }
  return null
}

async function fetchPrFromApi(number) {
  const repository = process.env.GITHUB_REPOSITORY
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? ''
  const response = await fetch(`https://api.github.com/repos/${repository}/pulls/${number}`, {
    headers: {
      accept: 'application/vnd.github+json',
      ...(token ? { authorization: `Bearer ${token}` } : {})
    }
  })
  if (!response.ok) {
    throw new Error(`GET pulls/${number} returned ${response.status}`)
  }
  return response.json()
}

async function main() {
  const eventName = process.env.GITHUB_EVENT_NAME ?? ''
  const eventPath = process.env.GITHUB_EVENT_PATH ?? ''
  if (eventPath === '') {
    console.log('PR text attribution check skipped — no GitHub event in this environment.')
    return 0
  }
  const event = JSON.parse(readFileSync(eventPath, 'utf8'))
  const pr = await prTextForEvent({ eventName, event, fetchPr: fetchPrFromApi })
  if (pr === null) {
    console.log(`PR text attribution check skipped — ${eventName} has no pull request.`)
    return 0
  }

  const findings = findPrTextAttribution(pr)
  if (findings.length === 0) {
    console.log(`AI attribution check OK — PR #${pr.number} title and body credit no AI.`)
    return 0
  }
  console.error(`AI attribution found in PR #${pr.number}:\n`)
  for (const finding of findings) {
    console.error(`  ${finding.field} line ${finding.lineNumber}: ${finding.line}`)
    console.error(`    ${finding.reason}`)
  }
  console.error(
    '\nThis repo credits people, not tools, and a squash merge can copy the PR text into main.' +
      '\nRemove each line above from the PR (`gh pr edit <n> --body-file <file>`); the edit re-runs' +
      '\nthis check. A human co-author and the Claude-Session trailer stay valid.'
  )
  return 1
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(`PR text attribution check failed: ${error.message}`)
      process.exit(1)
    }
  )
}
