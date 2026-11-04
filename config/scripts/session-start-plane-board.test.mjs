import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const hook = resolve(import.meta.dirname, '../../.claude/hooks/session-start-plane-board.py')
const python = execFileSync('python3', ['-c', 'import sys; print(sys.executable)'], {
  encoding: 'utf8'
}).trim()
const CONTEXT_CAP = 10_000
const tempDirs = []

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function ticket(n, state, priority = 'medium', title = `ticket ${n}`) {
  return { identifier: `ORCA-${n}`, priority, title, state: { name: state } }
}

/** Runs the hook on a PATH holding only `orca` (or nothing), which never reaches a system orca. */
function run(script) {
  const bin = mkdtempSync(join(tmpdir(), 'orca-session-board-'))
  tempDirs.push(bin)
  const calls = join(bin, 'calls')
  if (script !== null) {
    writeFileSync(join(bin, 'orca'), `#!/bin/sh\necho "$@" >> '${calls}'\n${script}\n`, {
      mode: 0o755
    })
  }
  const result = spawnSync(python, [hook], {
    encoding: 'utf8',
    env: { PATH: bin, ...(script === null ? {} : { ORCA_CLI_COMMAND: join(bin, 'orca') }) }
  })
  return {
    status: result.status,
    context: result.stdout ? JSON.parse(result.stdout).hookSpecificOutput.additionalContext : '',
    calls: existsSync(calls) ? readFileSync(calls, 'utf8') : ''
  }
}

/** The hook's read answered as the real CLI does: `--limit` cuts the list before any state split. */
function runBoard(items) {
  const dir = mkdtempSync(join(tmpdir(), 'orca-session-board-data-'))
  tempDirs.push(dir)
  const write = (name, rows) => {
    const file = join(dir, name)
    writeFileSync(file, `${JSON.stringify({ id: 'x', ok: true, result: rows })}\n`)
    return file
  }
  const full = write('full.json', items)
  const limited = write('limited.json', items.slice(0, 100))
  return run(
    `case "$*" in *--limit*) file='${limited}' ;; *) file='${full}' ;; esac\n` +
      `while read -r line; do echo "$line"; done < "$file"`
  )
}

describe('session-start-plane-board', () => {
  // Why: `--limit 100` cut the list before the states were split, so sessions saw 29 of 86 Todo.
  it('reads the open items in one call, with no limit and no --filter everything', () => {
    const { calls } = runBoard([ticket(1, 'Todo')])
    expect(calls.trim().split('\n')).toHaveLength(1)
    expect(calls).toContain('plane list')
    expect(calls).not.toContain('everything')
    expect(calls).not.toContain('--limit')
  })

  it('keeps tickets that come after 100 other open items', () => {
    const backlog = Array.from({ length: 150 }, (_, i) => ticket(i, 'Backlog'))
    const { context } = runBoard([...backlog, ticket(900, 'In Progress'), ticket(901, 'Todo')])
    expect(context).toContain('## In Progress (1)')
    expect(context).toContain('**ORCA-900**')
    expect(context).toContain('**ORCA-901**')
    expect(context).not.toContain('ORCA-0')
  })

  it('caps Todo by priority and states the total and what it hid', () => {
    const items = Array.from({ length: 120 }, (_, i) => ticket(i, 'Todo', 'medium'))
    items.push(ticket(500, 'Todo', 'urgent'))
    const { context } = runBoard(items)
    expect(context).toContain('## Todo (121)')
    expect(context).toContain('**ORCA-500**')
    expect(context.indexOf('**ORCA-500**')).toBeLessThan(context.indexOf('**ORCA-0**'))
    expect(context.match(/^- \*\*/gm)).toHaveLength(30)
    expect(context).toContain('91 más sin mostrar de 121')
    expect(context).toContain('orca plane list')
  })

  it('never caps In Progress on row count', () => {
    const items = Array.from({ length: 40 }, (_, i) => ticket(i, 'In Progress'))
    const { context } = runBoard(items)
    expect(context.match(/^- \*\*/gm)).toHaveLength(40)
    expect(context).not.toContain('sin mostrar')
  })

  it('stays under the context cap on long titles and says what it dropped', () => {
    const title = 'x'.repeat(400)
    const items = [
      ...Array.from({ length: 40 }, (_, i) => ticket(i, 'In Progress', 'high', title)),
      ...Array.from({ length: 40 }, (_, i) => ticket(100 + i, 'Todo', 'high', title))
    ]
    const { context } = runBoard(items)
    expect(context.length).toBeLessThan(CONTEXT_CAP)
    expect(context).toContain('## In Progress (40)')
    expect(context).toContain('## Todo (40)')
    expect(context).toContain('40 más sin mostrar de 40')
    expect(context).toContain('Al cambiar de estado')
  })

  it('says an empty board is empty', () => {
    expect(runBoard([ticket(1, 'Backlog')]).context).toContain('sin tickets en In Progress ni Todo')
  })

  // Why: a silent failure read as an empty board, so sessions took it for no work at all.
  it.each([
    [
      'the CLI reports an error',
      `echo '{"ok":false,"error":{"code":"runtime_unavailable","message":"Orca Lab is not running"}}'\nexit 1`,
      'Orca Lab is not running'
    ],
    ['the CLI fails with no JSON', 'echo boom >&2\nexit 3', 'boom'],
    ['the output is not JSON', 'echo not-json', 'no se pudo interpretar'],
    ['the result is not a list', `echo '{"ok":true,"result":{}}'`, 'no se pudo interpretar']
  ])('says the board is unread when %s', (_, script, reason) => {
    const { status, context } = run(script)
    expect(status).toBe(0)
    expect(context).toContain('NO se pudo leer')
    expect(context).toContain(reason)
    expect(context).not.toContain('## ')
  })

  it('says the board is unread when there is no Orca CLI', () => {
    const { status, context } = run(null)
    expect(status).toBe(0)
    expect(context).toContain('NO se pudo leer')
  })
})
