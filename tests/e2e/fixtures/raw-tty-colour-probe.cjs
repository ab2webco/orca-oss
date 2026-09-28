#!/usr/bin/env node
// Probes the terminal the way gh 2.101's termenv prompt does: OSC 11 ;? ST then CSI 6n
// on a raw tty, reading replies until the CPR. Reports the reply order and any bytes that
// arrive after the CPR — those are what the next program (gh) would read as keystrokes.
// Usage: node raw-tty-colour-probe.cjs [--result <file>]
const fs = require('node:fs')

const resultIndex = process.argv.indexOf('--result')
const resultPath = resultIndex > 0 ? process.argv[resultIndex + 1] : null

const SETTLE_AFTER_CPR_MS = 1500
const TOTAL_TIMEOUT_MS = 8000
// oxlint-disable-next-line no-control-regex -- terminal reply grammars are control sequences
const REPLY_RE = /\x1b\]11;[^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[\d+;\d+R/g

let received = ''
let settleTimer = null

function classify() {
  const order = []
  let cprEnd = -1
  for (const match of received.matchAll(REPLY_RE)) {
    const kind = match[0].startsWith('\x1b]') ? 'osc11' : 'cpr'
    order.push(kind)
    if (kind === 'cpr') {
      cprEnd = match.index + match[0].length
      break
    }
  }
  const trailing = cprEnd >= 0 ? received.slice(cprEnd) : ''
  return { order, trailing, received }
}

function finish() {
  process.stdin.setRawMode(false)
  process.stdin.pause()
  const line = `PROBE_RESULT ${JSON.stringify(classify())}`
  if (resultPath) {
    fs.writeFileSync(resultPath, `${line}\n`)
  }
  process.stdout.write(`\r\n${line}\r\n`)
  process.exit(0)
}

process.stdin.setRawMode(true)
process.stdin.resume()
process.stdin.on('data', (chunk) => {
  received += chunk.toString('binary')
  if (!settleTimer && classify().order.includes('cpr')) {
    settleTimer = setTimeout(finish, SETTLE_AFTER_CPR_MS)
  }
})
setTimeout(finish, TOTAL_TIMEOUT_MS)
process.stdout.write('\x1b]11;?\x1b\\\x1b[6n')
