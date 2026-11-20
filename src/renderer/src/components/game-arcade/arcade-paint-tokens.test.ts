import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ORCHESTRATOR_GAME_ARCADE_BRICKS,
  ORCHESTRATOR_GAME_ARCADE_DEFENSE,
  ORCHESTRATOR_GAME_ARCADE_RUNNER,
  ORCHESTRATOR_GAME_ARCADE_SNAKE,
  parseOrchestratorGameArcade,
  type OrchestratorGameArcade
} from '../../../../shared/orchestrator-game-arcade-file'
import {
  ARCADE_TOKEN_NAMES,
  arcadeTokensOf,
  type ArcadeRgb,
  type ArcadeTokenRole,
  type ArcadeTokens
} from './arcade-theme-tokens'
import type * as TokensModule from './arcade-theme-tokens'

// Why distinct per role and theme: a colour the painter drew can be traced back to exactly one token.
const themeOf = (key: string, isDark: boolean, base: number): ArcadeTokens =>
  arcadeTokensOf(
    key,
    isDark,
    Object.fromEntries(
      Object.keys(ARCADE_TOKEN_NAMES).map((role, i) => [role, [base, i * 7, 200 - i] as ArcadeRgb])
    ) as Record<ArcadeTokenRole, ArcadeRgb>
  )
const DARK = themeOf('dark', true, 11)
const LIGHT = themeOf('light', false, 241)
let theme = DARK

vi.mock('./arcade-theme-tokens', async (actual) => ({
  ...(await actual<typeof TokensModule>()),
  arcadeTokens: () => theme
}))

const { arcadeRunOf, stepArcadeRun } = await import('./arcade-run-state')
const { paintArcadeFrame } = await import('./arcade-canvas-paint')

/** A 2D context that records every colour assigned or added to a gradient, and draws nothing. */
function recordingContext(colors: Set<string>): CanvasRenderingContext2D {
  const gradient = { addColorStop: (_: number, color: string) => colors.add(color) }
  const target: Record<string, unknown> = {}
  return new Proxy(target, {
    get: (_, name: string) => {
      if (name in target) {
        return target[name]
      }
      if (name === 'measureText') {
        return (text: string) => ({ width: text.length * 7 })
      }
      return () => gradient
    },
    set: (_, name: string, value) => {
      // Why strings only: a gradient's colours arrive through its addColorStop calls.
      const isColor = name === 'fillStyle' || name === 'strokeStyle' || name === 'shadowColor'
      if (isColor && typeof value === 'string') {
        colors.add(value)
      }
      target[name] = value
      return true
    }
  }) as unknown as CanvasRenderingContext2D
}

const gameOf = (text: string): OrchestratorGameArcade => {
  const parsed = parseOrchestratorGameArcade(text)
  if (!parsed.ok) {
    throw new Error(parsed.error)
  }
  return parsed.game
}
const GAMES = {
  runner: gameOf(ORCHESTRATOR_GAME_ARCADE_RUNNER),
  snake: gameOf(ORCHESTRATOR_GAME_ARCADE_SNAKE),
  bricks: gameOf(ORCHESTRATOR_GAME_ARCADE_BRICKS),
  defense: gameOf(ORCHESTRATOR_GAME_ARCADE_DEFENSE)
}
const SIZE = { width: 800, height: 600, scale: 1 }
const WORDS = { score: '5 pts', hint: 'hint', held: 'held', over: 'Game over', overHint: 'back' }

/** The colours one frame of `engine` draws mid-run and on its game-over screen, under `theme`. */
function colorsOf(engine: keyof typeof GAMES): Set<string> {
  const colors = new Set<string>()
  const g = recordingContext(colors)
  let run = { ...arcadeRunOf(GAMES[engine], 7), screen: 'running' as const }
  for (let i = 0; i < 60; i += 1) {
    const stepped = stepArcadeRun(run, 50, false).run
    if (stepped.screen !== 'running') {
      break
    }
    run = { ...stepped, screen: 'running' }
  }
  const backdrop = {} as HTMLCanvasElement
  paintArcadeFrame(g, backdrop, run, WORDS, SIZE)
  paintArcadeFrame(g, backdrop, { ...run, screen: 'over' }, WORDS, SIZE)
  return colors
}

const RGB = /^rgb\((\d+) (\d+) (\d+)(?: \/ [\d.]+)?\)$/

/** The token roles `colors` came from, or the colours no token of `tokens` explains. */
function rolesOf(
  colors: Set<string>,
  tokens: ArcadeTokens
): { roles: Set<string>; stray: string[] } {
  const roles = new Set<string>()
  const stray: string[] = []
  for (const color of colors) {
    const m = RGB.exec(color)
    const role = m
      ? Object.entries(tokens.rgb).find(([, rgb]) => rgb.join() === `${m[1]},${m[2]},${m[3]}`)?.[0]
      : undefined
    if (role) {
      roles.add(role)
    } else {
      stray.push(color)
    }
  }
  return { roles, stray }
}

describe('the arcade painters draw with the app tokens', () => {
  beforeEach(() => {
    theme = DARK
  })

  for (const engine of Object.keys(GAMES) as (keyof typeof GAMES)[]) {
    it(`${engine}: every colour is a token of the current theme, and switching theme repaints in its colours`, () => {
      theme = DARK
      const dark = colorsOf(engine)
      theme = LIGHT
      const light = colorsOf(engine)

      expect(rolesOf(dark, DARK).stray, 'colours no dark token explains').toEqual([])
      expect(rolesOf(light, LIGHT).stray, 'colours no light token explains').toEqual([])
      // The same roles paint the scene in both themes, each in that theme's own colour.
      expect([...rolesOf(light, LIGHT).roles].sort()).toEqual([...rolesOf(dark, DARK).roles].sort())
      expect([...dark].some((color) => light.has(color))).toBe(false)
      expect(rolesOf(dark, DARK).roles).toContain('foreground')
    })
  }
})
