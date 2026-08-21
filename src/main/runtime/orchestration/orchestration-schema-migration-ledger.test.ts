import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ORCHESTRATION_LEDGER_FIRST_DECLARED_VERSION,
  ORCHESTRATION_SCHEMA_MIGRATION_LEDGER,
  ORCHESTRATION_SCHEMA_VERSION
} from './orchestration-schema-migration-ledger'

// Why source parsing and not a behavioural test: a collision is invisible at
// runtime on a fresh database — createTables() already builds the full schema, so
// every step is inert and every suite stays green. Only databases a *previous*
// build stamped skip the step, and a test cannot fabricate those. What it can do
// is read the ladder and check that no number carries two lineages' work.
const DB_SOURCE_PATH = join(__dirname, 'db.ts')
const LADDER_START = 'private migrate(): void {'
const LADDER_END = 'this.db.pragma(`user_version = ${SCHEMA_VERSION}`)'

// Why: this file's own prose quotes `if (current < N)`, and so does the ladder's
// commentary. A comment must never read as a gate.
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join('\n')
}

// Why anchored, not whole-file: db.ts also holds migrateLegacyContractStorage and
// other `current` comparisons that are not ladder gates.
function readMigrationLadder(): string {
  const source = readFileSync(DB_SOURCE_PATH, 'utf8')
  const start = source.indexOf(LADDER_START)
  const end = source.indexOf(LADDER_END)
  expect(start, `${LADDER_START} not found in db.ts`).toBeGreaterThan(-1)
  expect(end, `${LADDER_END} not found in db.ts`).toBeGreaterThan(start)
  return stripComments(source.slice(start, end))
}

type LadderGate = {
  readonly version: number
  readonly effects: readonly string[]
}

function gateEffects(body: string): readonly string[] {
  const effects = new Set<string>()
  for (const m of body.matchAll(/ALTER TABLE\s+(\S+)\s+ADD COLUMN\s+(\w+)/gi)) {
    effects.add(`column:${m[1]}.${m[2]}`)
  }
  for (const m of body.matchAll(/ALTER TABLE\s+(\S+)\s+RENAME TO\s+(\w+)/gi)) {
    effects.add(`rename:${m[1]}>${m[2]}`)
  }
  for (const m of body.matchAll(/CREATE (?:UNIQUE )?INDEX(?: IF NOT EXISTS)?\s+(\w+)/gi)) {
    effects.add(`index:${m[1]}`)
  }
  for (const m of body.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+(\w+)/gi)) {
    effects.add(`table:${m[1]}`)
  }
  for (const m of body.matchAll(/DROP (?:TABLE|INDEX)(?: IF EXISTS)?\s+(\w+)/gi)) {
    effects.add(`drop:${m[1]}`)
  }
  for (const m of body.matchAll(/\b(?:this\.)?((?:migrate|backfill|ensure)[A-Z]\w*)\s*\(/g)) {
    effects.add(`step:${m[1]}`)
  }
  return [...effects].sort()
}

// Why a scanner and not one regex: real gates carry extra conditions whose own
// parentheses (`current < 13 && !this.hasColumn(...)`) end a `[^)]*` match early,
// and a gate silently skipped by the parser is a gate this guard stops covering.
function findBlock(source: string, from: number, open: string, close: string): number {
  let depth = 0
  for (let cursor = from; cursor < source.length; cursor++) {
    if (source[cursor] === open) {
      depth += 1
    } else if (source[cursor] === close) {
      depth -= 1
      if (depth === 0) {
        return cursor
      }
    }
  }
  return -1
}

const GATE_OPENER = /if \(current < (\d+)\b/g

function parseGates(ladder: string): readonly LadderGate[] {
  const gates: LadderGate[] = []
  for (const match of ladder.matchAll(GATE_OPENER)) {
    const conditionEnd = findBlock(ladder, match.index + 'if '.length, '(', ')')
    const bodyStart = ladder.indexOf('{', conditionEnd)
    if (conditionEnd < 0 || bodyStart < 0) {
      continue
    }
    const bodyEnd = findBlock(ladder, bodyStart, '{', '}')
    gates.push({
      version: Number(match[1]),
      effects: gateEffects(ladder.slice(bodyStart + 1, bodyEnd))
    })
  }
  return gates
}

function renumberHint(nextVersion: number): string {
  return `renumber the incoming step to v${nextVersion}, declare it in ORCHESTRATION_SCHEMA_MIGRATION_LEDGER, and bump ORCHESTRATION_SCHEMA_VERSION`
}

describe('the orchestration migration ladder matches its ledger', () => {
  const gates = parseGates(readMigrationLadder())
  const nextFree = Math.max(ORCHESTRATION_SCHEMA_VERSION, ...gates.map((g) => g.version)) + 1

  // Why: a parser that silently drops a gate stops guarding it, and every check
  // below would still pass.
  it('parses every gate in the ladder', () => {
    const openers = [...readMigrationLadder().matchAll(/if \(current < \d/g)].length
    expect(openers).toBeGreaterThan(20)
    expect(gates).toHaveLength(openers)
  })

  it('gives every number exactly one gate, in ascending order', () => {
    const problems: string[] = []
    const seen = new Map<number, number>()
    for (const gate of gates) {
      seen.set(gate.version, (seen.get(gate.version) ?? 0) + 1)
    }
    for (const [version, count] of seen) {
      if (count > 1) {
        problems.push(
          `v${version} has ${count} gates in migrate(): upstream and the lab both numbered a migration ${version} — ${renumberHint(nextFree)}`
        )
      }
    }
    for (let i = 1; i < gates.length; i++) {
      if (gates[i].version <= gates[i - 1].version) {
        problems.push(
          `v${gates[i].version} is gated after v${gates[i - 1].version}: a step spliced in below the ladder's tip never runs on databases already stamped higher — ${renumberHint(nextFree)}`
        )
      }
    }
    expect(problems).toEqual([])
  })

  it('stamps the tip of the ladder', () => {
    const highest = Math.max(...gates.map((gate) => gate.version))
    expect(
      highest,
      `ORCHESTRATION_SCHEMA_VERSION is ${ORCHESTRATION_SCHEMA_VERSION} but the highest gate is v${highest}; a database stamped ${ORCHESTRATION_SCHEMA_VERSION} would skip every step above it`
    ).toBe(ORCHESTRATION_SCHEMA_VERSION)
  })

  it('keeps db.ts reading its version from the ledger', () => {
    const source = stripComments(readFileSync(DB_SOURCE_PATH, 'utf8'))
    const problems: string[] = []
    if (!source.includes('const SCHEMA_VERSION = ORCHESTRATION_SCHEMA_VERSION')) {
      problems.push(
        'db.ts no longer reads SCHEMA_VERSION from the ledger; restore `const SCHEMA_VERSION = ORCHESTRATION_SCHEMA_VERSION`'
      )
    }
    // A re-declared literal is how an incoming bump lands without touching the ledger.
    const literal = source.match(/const SCHEMA_VERSION\s*=\s*(\d+)/)
    if (literal) {
      problems.push(
        `db.ts hardcodes SCHEMA_VERSION = ${literal[1]}: that is upstream's numbering, not the lab's — restore the ledger import and ${renumberHint(nextFree)}`
      )
    }
    expect(problems).toEqual([])
  })

  it('declares each divergent step once, contiguously', () => {
    const problems: string[] = []
    const versions = ORCHESTRATION_SCHEMA_MIGRATION_LEDGER.map((step) => step.version)
    const expected = Array.from(
      { length: ORCHESTRATION_SCHEMA_VERSION - ORCHESTRATION_LEDGER_FIRST_DECLARED_VERSION + 1 },
      (_, i) => ORCHESTRATION_LEDGER_FIRST_DECLARED_VERSION + i
    )
    if (versions.join(',') !== expected.join(',')) {
      problems.push(
        `the ledger declares [${versions.join(', ')}]; it must declare exactly [${expected.join(', ')}] in order`
      )
    }
    const upstreamNumbers = new Set<number>()
    for (const step of ORCHESTRATION_SCHEMA_MIGRATION_LEDGER) {
      if (step.effects.length === 0) {
        problems.push(`v${step.version} declares no effects, so the ledger pins nothing about it`)
      }
      const renumbered = step.lineage === 'upstream-renumbered'
      if (renumbered !== (step.upstreamVersion !== undefined)) {
        problems.push(
          `v${step.version} must carry upstreamVersion if and only if its lineage is 'upstream-renumbered'`
        )
      }
      if (step.upstreamVersion === undefined) {
        continue
      }
      if (step.upstreamVersion === step.version) {
        problems.push(`v${step.version} claims to be a renumber of upstream's own v${step.version}`)
      }
      if (upstreamNumbers.has(step.upstreamVersion)) {
        problems.push(`upstream's v${step.upstreamVersion} is claimed by two ledger entries`)
      }
      upstreamNumbers.add(step.upstreamVersion)
    }
    expect(problems).toEqual([])
  })

  it('does exactly what the ledger says at each divergent number', () => {
    const problems: string[] = []
    const declared = new Map(
      ORCHESTRATION_SCHEMA_MIGRATION_LEDGER.map((step) => [step.version, step])
    )
    // Both directions: a gate the ledger never declared, and a declared step whose
    // gate was dropped wholesale, which is the shape a take-upstream's-side merge has.
    const gated = new Set(gates.map((gate) => gate.version))
    for (const step of ORCHESTRATION_SCHEMA_MIGRATION_LEDGER) {
      if (!gated.has(step.version)) {
        problems.push(
          `v${step.version} ("${step.summary}") is declared in the ledger but has no gate in migrate(): databases below ${step.version} would never get it`
        )
      }
    }
    for (const gate of gates) {
      if (gate.version < ORCHESTRATION_LEDGER_FIRST_DECLARED_VERSION) {
        continue
      }
      const step = declared.get(gate.version)
      if (!step) {
        problems.push(
          `v${gate.version} is gated in migrate() but absent from the ledger: declare it with its effects and, if it came from upstream, its upstreamVersion`
        )
        continue
      }
      const unexpected = gate.effects.filter((effect) => !step.effects.includes(effect))
      const missing = step.effects.filter((effect) => !gate.effects.includes(effect))
      if (unexpected.length > 0) {
        problems.push(
          `v${gate.version} ("${step.summary}") also does [${unexpected.join(', ')}]: a second lineage's work folded into an existing number never runs on databases already stamped ${gate.version} or higher — ${renumberHint(nextFree)}`
        )
      }
      if (missing.length > 0) {
        problems.push(
          `v${gate.version} ("${step.summary}") no longer does [${missing.join(', ')}]; update the ledger if the step legitimately moved`
        )
      }
    }
    expect(problems).toEqual([])
  })
})
