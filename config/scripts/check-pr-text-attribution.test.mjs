import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { afterAll, describe, expect, it } from 'vitest'
import { findPrTextAttribution, prTextForEvent } from './check-pr-text-attribution.mjs'

// The footer #912 carried, as Claude Code writes it.
const SIGNATURE = '🤖 Generated with [Claude Code](https://claude.com/claude-code)'
const body = (...lines) => ['## What Changed', '', 'Fixes the thing.', '', ...lines].join('\n')

describe('AI attribution in a PR title and body', () => {
  it('fails the exact Claude Code signature in the body', () => {
    const findings = findPrTextAttribution({ title: 'fix: x', body: body(SIGNATURE) })
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ field: 'body', line: SIGNATURE })
  })

  it('fails the disclosure lines a tool writes in place of the signature', () => {
    for (const line of [
      'Written with Claude Code (Opus 5.5)',
      'AI Disclosure: Written with Claude Code (Opus 5.5)',
      '## AI Disclosure',
      'Claude Opus 5.5',
      'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>'
    ]) {
      expect(findPrTextAttribution({ title: 'fix: x', body: body(line) }), line).toHaveLength(1)
    }
  })

  it('fails attribution in the title', () => {
    expect(findPrTextAttribution({ title: 'Generated with Codex', body: '' })).toMatchObject([
      { field: 'title' }
    ])
  })

  it('passes a human co-author, the Claude-Session trailer and an empty body', () => {
    const clean = body(
      'Co-authored-by: Jinwoo-H <jinwoo0825@gmail.com>',
      'Claude-Session: https://claude.ai/code/session_x'
    )
    expect(findPrTextAttribution({ title: 'fix(claude): x', body: clean })).toEqual([])
    expect(findPrTextAttribution({ title: 'fix: x', body: null })).toEqual([])
  })
})

describe('the PR text each event judges', () => {
  const noFetch = () => {
    throw new Error('must not fetch')
  }

  it('reads an edit from the pull_request payload', async () => {
    const event = { pull_request: { number: 7, title: 't', body: SIGNATURE } }
    await expect(
      prTextForEvent({ eventName: 'pull_request', event, fetchPr: noFetch })
    ).resolves.toMatchObject({ number: 7, body: SIGNATURE })
  })

  // A merge group carries no text: the live PR is what an edit after the last push changed.
  it('reads the live PR named by the merge queue ref', async () => {
    const event = { merge_group: { head_ref: 'refs/heads/gh-readonly-queue/main/pr-912-0a1b2c3d' } }
    const fetched = []
    const pr = await prTextForEvent({
      eventName: 'merge_group',
      event,
      fetchPr: async (number) => {
        fetched.push(number)
        return { title: 't', body: SIGNATURE }
      }
    })
    expect(fetched).toEqual([912])
    expect(findPrTextAttribution(pr)).toHaveLength(1)
  })

  it('fails instead of skipping when the queue ref names no PR', async () => {
    const event = { merge_group: { head_ref: 'refs/heads/somewhere-else' } }
    await expect(
      prTextForEvent({ eventName: 'merge_group', event, fetchPr: noFetch })
    ).rejects.toThrow('cannot find the PR number')
  })
})

describe('the gate as CI runs it', () => {
  const script = fileURLToPath(new URL('check-pr-text-attribution.mjs', import.meta.url))
  const dir = mkdtempSync(join(tmpdir(), 'orca-pr-text-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  const run = (prBody) => {
    const eventPath = join(dir, 'event.json')
    writeFileSync(
      eventPath,
      JSON.stringify({ pull_request: { number: 912, title: 'fix: x', body: prBody } })
    )
    const result = spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      env: { ...process.env, GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: eventPath }
    })
    return { status: result.status, output: `${result.stdout}${result.stderr}` }
  }

  it('exits 1 and names the line for a signed body', () => {
    const { status, output } = run(body(SIGNATURE))
    expect(status).toBe(1)
    expect(output).toContain(`body line 5: ${SIGNATURE}`)
  })

  it('exits 0 for a body co-authored by a person', () => {
    expect(run(body('Co-authored-by: Fabian Altahona <scloud@netsat.co>')).status).toBe(0)
  })
})

describe('PR text gate wiring', () => {
  it('re-runs on every edit and in the merge queue', () => {
    const workflow = parse(readFileSync('.github/workflows/pr-text.yml', 'utf8'))
    expect(workflow.on.pull_request.types).toEqual(
      expect.arrayContaining(['opened', 'edited', 'synchronize', 'reopened'])
    )
    expect(workflow.on.merge_group).toBeDefined()
    expect(workflow.jobs.attribution.steps.at(-1).run).toContain('check-pr-text-attribution.mjs')
  })

  // `verify` is the required check, and static analysis feeds it.
  it('runs inside the required static analysis job, with read access to the PR', () => {
    const job = parse(readFileSync('.github/workflows/pr.yml', 'utf8')).jobs.static_analysis
    expect(job.steps.some((step) => step.run === 'pnpm run check:pr-text-attribution')).toBe(true)
    expect(job.permissions['pull-requests']).toBe('read')
  })

  it('keeps the AI Disclosure section out of the PR template', () => {
    expect(readFileSync('.github/pull_request_template.md', 'utf8')).not.toMatch(/AI Disclosure/i)
  })

  // Why empty strings: `false` makes older clients skip the whole settings file.
  it('blanks Claude Code attribution for every account that opens this repo', () => {
    const settings = JSON.parse(readFileSync('.claude/settings.json', 'utf8'))
    expect(settings.attribution).toEqual({ commit: '', pr: '' })
  })
})
