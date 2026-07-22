export type NativeChatTranscriptAgent = 'claude' | 'codex' | 'grok'

/** Agents whose transcripts the native chat view can parse and render. */
export const NATIVE_CHAT_SUPPORTED_AGENTS: ReadonlySet<string> = new Set([
  'claude',
  'openclaude',
  // Why: claude-zai runs the real claude CLI, so transcripts are Claude-format
  // and the hook-reported transcript_path locates them under its config dir.
  'claude-zai',
  'codex',
  'grok'
])

export function isNativeChatSupportedAgent(agent: string | null | undefined): boolean {
  return agent != null && NATIVE_CHAT_SUPPORTED_AGENTS.has(agent)
}

/** True when the agent renders Claude's multi-step AskUserQuestion — one question
 *  per step, each Enter advancing — so a multi-line answer must be paced per line.
 *  Other agents submit the whole answer with a single Enter. */
export function shouldStepNativeChatAskAnswer(agent: string | null | undefined): boolean {
  return resolveNativeChatTranscriptAgent(agent) === 'claude'
}

export function resolveNativeChatTranscriptAgent(
  agent: string | null | undefined
): NativeChatTranscriptAgent | null {
  // Why: OpenClaude and claude-zai write the Claude transcript format and layout
  // even though Orca preserves their distinct agent identities for launch and UI.
  if (agent === 'claude' || agent === 'openclaude' || agent === 'claude-zai') {
    return 'claude'
  }
  if (agent === 'codex' || agent === 'grok') {
    return agent
  }
  return null
}
