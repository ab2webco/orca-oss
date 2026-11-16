import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** One start of the fake agent: its arguments and the launch pins Orca set in its env. */
export type StdinAgentLaunch = {
  argv: string[]
  modelPinned: string | null
  effortPinned: string | null
}

export type StdinLoggingAgent = {
  command: string
  readStdin: () => string
  /** Every start so far, oldest first. */
  readLaunches: () => StdinAgentLaunch[]
  dispose: () => void
}

// Why not the golden stub: it redraws a multi-line paste over itself, so the dispatch
// capability in Orca's preamble never survives a terminal read.
const agentSource = (ledgerPath: string, launchesPath: string): string => `
const { appendFileSync } = require('node:fs')
appendFileSync(${JSON.stringify(launchesPath)}, JSON.stringify({
  argv: process.argv.slice(2),
  modelPinned: process.env.ORCA_AGENT_MODEL_PINNED ?? null,
  effortPinned: process.env.ORCA_AGENT_EFFORT_PINNED ?? null
}) + '\\n')
process.stdout.write('\\u001b]0;Codex Ready\\u0007OpenAI Codex\\nmodel: e2e\\ndirectory: e2e\\n')
process.stdin.on('data', (chunk) => appendFileSync(${JSON.stringify(ledgerPath)}, chunk.toString()))
process.stdin.resume()
setInterval(() => {}, 60_000)
`

/** A fake agent that keeps everything Orca types into it, so a test can read its own dispatch. */
export function createStdinLoggingAgent(): StdinLoggingAgent {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'orca-e2e-stdin-agent-'))
  const ledgerPath = path.join(dir, 'stdin.log')
  const launchesPath = path.join(dir, 'launches.log')
  const source = agentSource(ledgerPath, launchesPath)
  if (process.platform === 'win32') {
    writeFileSync(path.join(dir, 'agent.js'), source)
    writeFileSync(path.join(dir, 'agent.cmd'), '@echo off\r\nnode "%~dp0\\agent.js" %*\r\n')
  } else {
    writeFileSync(path.join(dir, 'agent'), `#!/usr/bin/env node\n${source}`)
    chmodSync(path.join(dir, 'agent'), 0o755)
  }
  return {
    command: path.join(dir, process.platform === 'win32' ? 'agent.cmd' : 'agent'),
    readStdin: () => (existsSync(ledgerPath) ? readFileSync(ledgerPath, 'utf8') : ''),
    readLaunches: () =>
      existsSync(launchesPath)
        ? readFileSync(launchesPath, 'utf8')
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line) as StdinAgentLaunch)
        : [],
    dispose: () => rmSync(dir, { recursive: true, force: true })
  }
}
