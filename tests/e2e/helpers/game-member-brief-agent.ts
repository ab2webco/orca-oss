import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export type BriefHeartbeat = {
  named: string
  args: string[]
  status: number | null
  stdout: string
  stderr: string
}

export type BriefReadingAgent = {
  command: string
  readStdin: () => string
  readHeartbeats: () => BriefHeartbeat[]
  dispose: () => void
}

// Why every id comes from the brief file: the member is typed only the line naming it, so a
// heartbeat with the launched dispatch id proves the file alone was enough to act on.
const agentSource = (args: { stdinPath: string; ledgerPath: string; cliEntry: string }): string => `
const { appendFileSync, readFileSync } = require('node:fs')
const { spawnSync } = require('node:child_process')
const path = require('node:path')
let typed = ''
let acted = false
process.stdout.write('\\u001b]0;Codex Ready\\u0007OpenAI Codex\\nmodel: e2e\\ndirectory: e2e\\n')
process.stdin.on('data', (chunk) => {
  typed += chunk.toString()
  appendFileSync(${JSON.stringify(args.stdinPath)}, chunk.toString())
  const named = typed.match(/Read your Orca Lab brief at (\\S+) \\(task \\S+\\) and follow it\\./)?.[1]
  if (!named || acted) return
  acted = true
  const brief = readFileSync(path.join(process.cwd(), named), 'utf8')
  const from = brief.match(/orchestration send --from (\\S+)/)?.[1] ?? ''
  const capability = brief.match(/--dispatch-capability (dcap_[A-Za-z0-9_-]+)/)?.[1] ?? ''
  const ids = brief.match(/--type heartbeat[\\s\\S]*?--task-id (\\S+) --dispatch-id (\\S+)/) ?? []
  const cliArgs = [
    'orchestration', 'send', '--from', from, '--dispatch-capability', capability,
    '--type', 'heartbeat', '--subject', 'alive',
    '--task-id', ids[1] ?? '', '--dispatch-id', ids[2] ?? '', '--phase', 'investigating', '--json'
  ]
  const result = spawnSync(process.execPath, [${JSON.stringify(args.cliEntry)}, ...cliArgs], {
    env: process.env,
    encoding: 'utf8'
  })
  appendFileSync(
    ${JSON.stringify(args.ledgerPath)},
    JSON.stringify({ named, args: cliArgs, status: result.status, stdout: result.stdout, stderr: result.stderr }) + '\\n'
  )
})
process.stdin.resume()
setInterval(() => {}, 60_000)
`

/** A fake member that reads the brief Orca names and sends the start heartbeat it describes. */
export function createBriefReadingAgent(cliEntry: string): BriefReadingAgent {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'orca-e2e-brief-agent-'))
  const stdinPath = path.join(dir, 'stdin.log')
  const ledgerPath = path.join(dir, 'heartbeats.jsonl')
  const source = agentSource({ stdinPath, ledgerPath, cliEntry })
  if (process.platform === 'win32') {
    writeFileSync(path.join(dir, 'agent.js'), source)
    writeFileSync(path.join(dir, 'agent.cmd'), '@echo off\r\nnode "%~dp0\\agent.js" %*\r\n')
  } else {
    writeFileSync(path.join(dir, 'agent'), `#!/usr/bin/env node\n${source}`)
    chmodSync(path.join(dir, 'agent'), 0o755)
  }
  return {
    command: path.join(dir, process.platform === 'win32' ? 'agent.cmd' : 'agent'),
    readStdin: () => (existsSync(stdinPath) ? readFileSync(stdinPath, 'utf8') : ''),
    readHeartbeats: () =>
      existsSync(ledgerPath)
        ? readFileSync(ledgerPath, 'utf8')
            .split(/\r?\n/)
            .filter(Boolean)
            .map((line) => JSON.parse(line) as BriefHeartbeat)
        : [],
    dispose: () => rmSync(dir, { recursive: true, force: true })
  }
}
