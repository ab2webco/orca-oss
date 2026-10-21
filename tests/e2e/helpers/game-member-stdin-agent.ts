import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export type StdinLoggingAgent = {
  command: string
  readStdin: () => string
  dispose: () => void
}

// Why not the golden stub: it redraws a multi-line paste over itself, so the dispatch
// capability in Orca's preamble never survives a terminal read.
const agentSource = (ledgerPath: string): string => `
const { appendFileSync } = require('node:fs')
process.stdout.write('\\u001b]0;Codex Ready\\u0007OpenAI Codex\\nmodel: e2e\\ndirectory: e2e\\n')
process.stdin.on('data', (chunk) => appendFileSync(${JSON.stringify(ledgerPath)}, chunk.toString()))
process.stdin.resume()
setInterval(() => {}, 60_000)
`

/** A fake agent that keeps everything Orca types into it, so a test can read its own dispatch. */
export function createStdinLoggingAgent(): StdinLoggingAgent {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'orca-e2e-stdin-agent-'))
  const ledgerPath = path.join(dir, 'stdin.log')
  if (process.platform === 'win32') {
    writeFileSync(path.join(dir, 'agent.js'), agentSource(ledgerPath))
    writeFileSync(path.join(dir, 'agent.cmd'), '@echo off\r\nnode "%~dp0\\agent.js" %*\r\n')
  } else {
    writeFileSync(path.join(dir, 'agent'), `#!/usr/bin/env node\n${agentSource(ledgerPath)}`)
    chmodSync(path.join(dir, 'agent'), 0o755)
  }
  return {
    command: path.join(dir, process.platform === 'win32' ? 'agent.cmd' : 'agent'),
    readStdin: () => (existsSync(ledgerPath) ? readFileSync(ledgerPath, 'utf8') : ''),
    dispose: () => rmSync(dir, { recursive: true, force: true })
  }
}
