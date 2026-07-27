import { lstatSync } from 'node:fs'
import {
  findTrustedCodexSessionResume,
  type TrustedCodexSessionResume
} from './codex-session-resume-home'

export type CodexResumeFallbackDiagnostics = {
  sessionId: string
  recordedTranscriptPath: string
  resolvedTranscriptPath: string
}

export type CodexResumeGuardDiagnostics = {
  sessionId: string
  recordedTranscriptPath: string
  /** Whether the recorded path (or its plain/.zst sibling) is a file on disk. */
  recordedTranscriptPathExists: boolean
  trustedCodexHomes: readonly string[]
  /** First same-id rollout found by scanning the trusted homes, if any. A hit
   *  with a different path than the recorded one means the metadata went stale
   *  while the session itself is still inside the trust boundary. */
  sameIdRolloutInTrustedHomes: { homePath: string; transcriptPath: string } | null
}

function isRegularFile(filePath: string): boolean {
  try {
    return lstatSync(filePath).isFile()
  } catch {
    return false
  }
}

function recordedPathVariants(transcriptPath: string): string[] {
  if (transcriptPath.endsWith('.jsonl.zst')) {
    return [transcriptPath, transcriptPath.slice(0, -'.zst'.length)]
  }
  if (transcriptPath.endsWith('.jsonl')) {
    return [transcriptPath, `${transcriptPath}.zst`]
  }
  return [transcriptPath]
}

export function collectCodexResumeFallbackDiagnostics(
  session: TrustedCodexSessionResume
): CodexResumeFallbackDiagnostics | null {
  return session.repair
    ? {
        sessionId: session.repair.sessionId,
        recordedTranscriptPath: session.repair.recordedTranscriptPath,
        resolvedTranscriptPath: session.repair.resolvedTranscriptPath
      }
    : null
}

/**
 * Read-only evidence for a fired Codex resume guard: the trusted-home list the
 * guard saw versus where a same-id rollout actually lives. The guard's fire-time
 * state is unrecoverable after the fact, so this must be logged at the throw
 * site. Never used to select a resume home — the same-id scan here is evidence
 * collection, not trust.
 */
export async function collectCodexResumeGuardDiagnostics(args: {
  sessionId: string
  transcriptPath: string
  trustedCodexHomes: readonly string[]
  fileIsRegular?: (filePath: string) => boolean
  listSessionFiles?: (sessionsRoot: string) => AsyncIterable<string>
}): Promise<CodexResumeGuardDiagnostics> {
  const fileIsRegular = args.fileIsRegular ?? isRegularFile
  const recordedTranscriptPathExists = recordedPathVariants(args.transcriptPath).some(fileIsRegular)
  // Why: omitting transcriptPath forces the legacy same-id scan the guard
  // deliberately skips, answering "where is this session really?".
  const sameIdRolloutInTrustedHomes = await findTrustedCodexSessionResume({
    sessionId: args.sessionId,
    transcriptPath: undefined,
    trustedCodexHomes: args.trustedCodexHomes,
    // Why neutral ranking inputs: this only reports where the id lives, so which home would win
    // a resume is irrelevant — and a diagnostic must not consult the live account selection.
    getSelectedAccountCodexHome: () => null,
    systemCodexHomePath: null,
    sharedRuntimeCodexHomePath: null,
    ...(args.fileIsRegular ? { fileIsRegular: args.fileIsRegular } : {}),
    ...(args.listSessionFiles ? { listSessionFiles: args.listSessionFiles } : {})
  })
  return {
    sessionId: args.sessionId,
    recordedTranscriptPath: args.transcriptPath,
    recordedTranscriptPathExists,
    trustedCodexHomes: args.trustedCodexHomes,
    sameIdRolloutInTrustedHomes
  }
}
