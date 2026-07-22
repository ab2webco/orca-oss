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

/** True when the agent renders a digit-commit question selector that ignores
 *  typed label text (pasting "Blue" + Enter commits the highlighted FIRST
 *  option — STA-1860): Claude's AskUserQuestion and Codex 0.145's
 *  request_user_input card both behave this way, so answers must be delivered
 *  as per-option keystrokes. Other agents commit a pasted answer. */
export function shouldStepNativeChatAskAnswer(agent: string | null | undefined): boolean {
  const transcriptAgent = resolveNativeChatTranscriptAgent(agent)
  return transcriptAgent === 'claude' || transcriptAgent === 'codex'
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
