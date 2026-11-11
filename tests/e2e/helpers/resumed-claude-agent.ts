import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export type ResumedClaudeAgent = {
  command: string
  dispose: () => void
}

// Why from inside the PTY: only its env carries the launch token that ties the report to this pane.
const agentSource = (sessionId: string): string => `
const env = process.env
if (env.ORCA_AGENT_HOOK_PORT && env.ORCA_AGENT_HOOK_TOKEN && env.ORCA_PANE_KEY) {
  void fetch('http://127.0.0.1:' + env.ORCA_AGENT_HOOK_PORT + '/hook/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Orca-Agent-Hook-Token': env.ORCA_AGENT_HOOK_TOKEN },
    body: JSON.stringify({
      paneKey: env.ORCA_PANE_KEY,
      tabId: env.ORCA_TAB_ID,
      worktreeId: env.ORCA_WORKTREE_ID,
      env: env.ORCA_AGENT_HOOK_ENV,
      version: env.ORCA_AGENT_HOOK_VERSION,
      launchToken: env.ORCA_AGENT_LAUNCH_TOKEN,
      payload: { hook_event_name: 'SessionStart', source: 'resume', session_id: ${JSON.stringify(sessionId)} }
    })
  }).catch(() => {})
}
process.stdin.resume()
setInterval(() => {}, 60_000)
`

/** A stand-in `claude` that resumes a session as the real one reports it: a SessionStart hook. */
export function createResumedClaudeAgent(sessionId: string): ResumedClaudeAgent {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'orca-e2e-resumed-claude-'))
  if (process.platform === 'win32') {
    writeFileSync(path.join(dir, 'claude.js'), agentSource(sessionId))
    writeFileSync(path.join(dir, 'claude.cmd'), '@echo off\r\nnode "%~dp0\\claude.js" %*\r\n')
  } else {
    writeFileSync(path.join(dir, 'claude'), `#!/usr/bin/env node\n${agentSource(sessionId)}`)
    chmodSync(path.join(dir, 'claude'), 0o755)
  }
  return {
    command: path.join(dir, process.platform === 'win32' ? 'claude.cmd' : 'claude'),
    dispose: () => rmSync(dir, { recursive: true, force: true })
  }
}
