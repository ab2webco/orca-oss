#!/usr/bin/env node
// Writes a terminal query burst the way a CLI does at startup and reports every reply it can
// read back, in order, plus whatever arrives after the last reply it expected. A reply that
// shows up late, twice, or never is what the next reader of the tty (the CLI itself, or the
// shell after it) would misread as keystrokes.
// Usage: node terminal-query-burst-probe.cjs --config <json file> --result <file>
// Config: { burst, mode: 'raw' | 'cooked', runs, expectedCount, delayBeforeMs, cookedHoldMs,
//           settleMs, totalTimeoutMs, reorderForOracleCheck }
const fs = require('node:fs')

function argValue(name) {
  const index = process.argv.indexOf(name)
  return index > 0 ? process.argv[index + 1] : null
}

const config = JSON.parse(fs.readFileSync(argValue('--config'), 'utf8'))
const resultPath = argValue('--result')
const settleMs = config.settleMs ?? 1500
const totalTimeoutMs = config.totalTimeoutMs ?? 8000

const TOKEN_RE =
  // oxlint-disable-next-line no-control-regex -- terminal reply grammars are control sequences
  /\x1b\]([^\x07\x1b]*)(?:\x07|\x1b\\)|\x1bP([^\x1b]*)\x1b\\|\x1b\[([?>=]?)([\d;:]*)(\$?[@-~])/g

function classifyCsi(prefix, params, final) {
  if (final === 'c') {
    return prefix === '?' ? 'da1' : prefix === '>' ? 'da2' : `csi:${prefix}${params}${final}`
  }
  if (final === 'n' && prefix === '' && params === '0') {
    return 'dsr5'
  }
  if (final === 'n' && prefix === '?' && params.startsWith('997;')) {
    return 'colorscheme'
  }
  if (final === 'R' && prefix === '' && /^\d+;\d+$/.test(params)) {
    return 'cpr'
  }
  if (final === '$y' && prefix === '?') {
    return `decrpm:${params.split(';')[0]}`
  }
  if (final === 'u' && prefix === '?') {
    return 'kitty'
  }
  if (final === 't' && prefix === '') {
    const op = params.split(';')[0]
    return op === '4' ? 'winpx' : op === '6' ? 'cellpx' : op === '8' ? 'winchars' : `t:${params}`
  }
  return `csi:${prefix}${params}${final}`
}

function classifyOsc(body) {
  const [code, ...rest] = body.split(';')
  if (code === '4') {
    return `osc4;${rest[0]}`
  }
  return `osc${code}`
}

function tokenize(received) {
  const tokens = []
  let cursor = 0
  for (const match of received.matchAll(TOKEN_RE)) {
    if (match.index > cursor) {
      tokens.push({ kind: 'bytes', raw: received.slice(cursor, match.index), end: match.index })
    }
    const kind =
      match[1] !== undefined
        ? classifyOsc(match[1])
        : match[2] !== undefined
          ? match[2].startsWith('>|')
            ? 'xtversion'
            : `dcs:${match[2].slice(0, 4)}`
          : classifyCsi(match[3], match[4], match[5])
    cursor = match.index + match[0].length
    tokens.push({ kind, raw: match[0], end: cursor })
  }
  if (cursor < received.length) {
    tokens.push({ kind: 'bytes', raw: received.slice(cursor), end: received.length })
  }
  return tokens
}

function summarize(received) {
  const tokens = tokenize(received)
  const replies = tokens.filter((token) => token.kind !== 'bytes')
  const expectedEnd =
    replies.length >= config.expectedCount && config.expectedCount > 0
      ? replies[config.expectedCount - 1].end
      : config.expectedCount === 0
        ? 0
        : received.length
  return {
    observedOrder: tokens.map((token) => token.kind),
    trailing: received.slice(expectedEnd),
    received
  }
}

function setRaw(on) {
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(on)
  }
}

let received = ''
let resolveRun = null
let settleTimer = null

function replyCount() {
  return tokenize(received).filter((token) => token.kind !== 'bytes').length
}

process.stdin.on('data', (chunk) => {
  received += chunk.toString('binary')
  if (resolveRun && !settleTimer && replyCount() >= config.expectedCount) {
    settleTimer = setTimeout(resolveRun, settleMs)
  }
})

// Why: `received` is only reset after a run, so a late reply from run 1 counts against run 2.
function collectRun() {
  settleTimer = null
  return new Promise((resolve) => {
    const deadline = setTimeout(() => resolve(), totalTimeoutMs)
    resolveRun = () => {
      clearTimeout(deadline)
      resolve()
    }
    if (config.expectedCount === 0 || replyCount() >= config.expectedCount) {
      settleTimer = setTimeout(resolveRun, settleMs)
    }
  }).then(() => {
    clearTimeout(settleTimer)
    resolveRun = null
    const summary = summarize(received)
    received = ''
    // Why: the oracle check proves the spec goes red when replies arrive out of order.
    if (config.reorderForOracleCheck && summary.observedOrder.length > 1) {
      summary.observedOrder = summary.observedOrder.toReversed()
    }
    return summary
  })
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function main() {
  await sleep(config.delayBeforeMs ?? 0)
  const runs = []
  for (let run = 0; run < (config.runs ?? 1); run += 1) {
    if (config.mode === 'raw') {
      setRaw(true)
      process.stdin.resume()
      fs.writeSync(1, config.burst)
    } else {
      // Why: a prober that queries before its raw-mode switch lands still has ECHO on when
      // the query leaves; that window is what Orca's echo containment defers replies for.
      setRaw(false)
      fs.writeSync(1, config.burst)
      await sleep(config.cookedHoldMs ?? 20)
      setRaw(true)
      process.stdin.resume()
    }
    // Stays raw between runs: a cooked tty would discard a late reply that belongs to run 1.
    runs.push(await collectRun())
  }
  setRaw(false)
  process.stdin.pause()
  const line = `PROBE_RESULT ${JSON.stringify({ runs })}`
  fs.writeFileSync(resultPath, `${line}\n`)
  process.stdout.write('\r\nPROBE_DONE\r\n')
  process.exit(0)
}

void main()
