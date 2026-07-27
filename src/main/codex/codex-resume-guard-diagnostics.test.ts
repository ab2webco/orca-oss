import { describe, expect, it } from 'vitest'
import { collectCodexResumeGuardDiagnostics } from './codex-resume-guard-diagnostics'

const SESSION_ID = '019f9c89-244d-7232-b6e6-0874d3557f76'

async function* emptyListing(): AsyncIterable<string> {}

function listingFor(files: Record<string, string[]>): (root: string) => AsyncIterable<string> {
  return (root) => {
    const paths = files[root] ?? []
    return (async function* () {
      yield* paths
    })()
  }
}

describe('collectCodexResumeGuardDiagnostics', () => {
  it('reports a stale recorded path alongside the same-id rollout found in a trusted home', async () => {
    const trustedHome = '/managed/accounts/abc/home'
    const actualRollout = `${trustedHome}/sessions/2026/07/26/rollout-2026-07-26T00-17-55-${SESSION_ID}.jsonl`
    const diagnostics = await collectCodexResumeGuardDiagnostics({
      sessionId: SESSION_ID,
      transcriptPath: `/gone/home/sessions/2026/07/26/rollout-2026-07-26T00-17-55-${SESSION_ID}.jsonl`,
      trustedCodexHomes: [trustedHome],
      fileIsRegular: (filePath) => filePath === actualRollout,
      listSessionFiles: listingFor({ [`${trustedHome}/sessions`]: [actualRollout] })
    })
    expect(diagnostics.recordedTranscriptPathExists).toBe(false)
    expect(diagnostics.trustedCodexHomes).toEqual([trustedHome])
    expect(diagnostics.sameIdRolloutInTrustedHomes).toEqual({
      homePath: trustedHome,
      transcriptPath: actualRollout
    })
  })

  it('reports an existing recorded file that sits outside every trusted home', async () => {
    const recordedPath = `/untrusted/home/sessions/2026/07/26/rollout-2026-07-26T00-17-55-${SESSION_ID}.jsonl`
    const diagnostics = await collectCodexResumeGuardDiagnostics({
      sessionId: SESSION_ID,
      transcriptPath: recordedPath,
      trustedCodexHomes: ['/Users/example/.codex'],
      fileIsRegular: (filePath) => filePath === recordedPath,
      listSessionFiles: () => emptyListing()
    })
    expect(diagnostics.recordedTranscriptPathExists).toBe(true)
    expect(diagnostics.sameIdRolloutInTrustedHomes).toBeNull()
  })

  it('treats a compressed sibling of the recorded path as existing', async () => {
    const recordedPath = `/Users/example/.codex/sessions/2026/07/26/rollout-2026-07-26T00-17-55-${SESSION_ID}.jsonl`
    const diagnostics = await collectCodexResumeGuardDiagnostics({
      sessionId: SESSION_ID,
      transcriptPath: recordedPath,
      trustedCodexHomes: [],
      fileIsRegular: (filePath) => filePath === `${recordedPath}.zst`,
      listSessionFiles: () => emptyListing()
    })
    expect(diagnostics.recordedTranscriptPathExists).toBe(true)
  })
})
