import { describe, expect, it } from 'vitest'
import { factoryRing } from '../../site/src/data/factory-ring'
import {
  findCommandSpec,
  normalizeCommandPositionals,
  parseArgs,
  validateCommandAndFlags
} from './args'
import { remotePlacementOf } from './handlers/orchestrator-game-launch-options'
import { COMMAND_SPECS } from './specs'
import { parseGameEffortPlan } from '../shared/orchestrator-game-effort-plan'

// The landing's software factory shows these as the commands of each step; a reader may paste them.
const words = (line: string): string[] =>
  [...line.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2] ?? '')

const orcaLines = (['en', 'es'] as const).flatMap((lang) =>
  factoryRing(lang).stations.flatMap((station) =>
    station.command
      .split('\n')
      .filter((line) => line.startsWith('orca '))
      .map((line) => ({ lang, line }))
  )
)

describe('the landing factory ring commands', () => {
  it('shows a command at every step', () => {
    expect(orcaLines.length).toBeGreaterThanOrEqual(20)
  })

  it.each(orcaLines)('the CLI accepts $lang: $line', ({ line }) => {
    const argv = words(line).slice(1)
    const passthrough = COMMAND_SPECS.find(
      (spec) => spec.argumentMode === 'passthrough' && spec.path[0] === argv[0]
    )
    if (passthrough) {
      // Why: `orca sonar` forwards to the plugin CLI, whose subcommands its summary names.
      expect(/\(([^)]*)\)/.exec(passthrough.summary)?.[1]?.split(', ')).toContain(argv[1])
      return
    }
    const parsed = normalizeCommandPositionals(
      COMMAND_SPECS,
      parseArgs(
        argv,
        COMMAND_SPECS.map((spec) => spec.path)
      )
    )
    expect(() => validateCommandAndFlags(COMMAND_SPECS, parsed)).not.toThrow()
    const spec = findCommandSpec(COMMAND_SPECS, parsed.commandPath)
    // Flags outside [...] in the usage line are required.
    const required = [
      ...((spec?.usage ?? '')
        .split('\n')[0]
        ?.replace(/\[[^\]]*\]/g, '')
        .matchAll(/--([\w-]+)/g) ?? [])
    ]
    for (const [, flag] of required) {
      expect(parsed.flags.has(flag ?? ''), `--${flag} is required`).toBe(true)
    }
    const phases = argv.flatMap((word, i) => (argv[i - 1] === '--phase' ? [word] : []))
    if (phases.length > 0) {
      expect(parseGameEffortPlan(phases)).toMatchObject({ ok: true })
    }
    if (parsed.flags.has('on')) {
      const repo = parsed.flags.get('repo')
      expect(() =>
        remotePlacementOf(parsed.flags, typeof repo === 'string' ? repo : null)
      ).not.toThrow()
    }
  })
})
