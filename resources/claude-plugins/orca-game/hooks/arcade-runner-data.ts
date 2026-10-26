// The mod's copy of Orca's built-in runner (src/shared/orchestrator-game-arcade-runner.json);
// the mod cannot import src/shared, so tests/arcade-runner-data.spec.ts holds the two together.

export const ARCADE_FPS_MIN = 5
export const ARCADE_FPS_MAX = 15

export type ArcadeSpriteObstacle = {
  rows: readonly string[]
  colors: Readonly<Record<string, number>>
  weight: number
}
export type ArcadeObstacle = { from: 'scene'; weight: number } | ArcadeSpriteObstacle

export type ArcadeRunner = {
  engine: 'runner'
  name: string | { en: string; es?: string }
  fps: number
  /** Columns per second, ramping by `rampPerMinute` up to `max`. */
  speed: { start: number; max: number; rampPerMinute: number }
  /** Columns of ground between two obstacles. */
  difficulty: { minGap: number; maxGap: number }
  /** Peak height in band rows (two pixels each) and time in the air. */
  jump: { rows: number; ms: number }
  obstacles: readonly ArcadeObstacle[]
}

export const ARCADE_RUNNER: ArcadeRunner = {
  engine: 'runner',
  name: { en: 'Endless run', es: 'Carrera sin fin' },
  fps: 12,
  speed: { start: 12, max: 28, rampPerMinute: 6 },
  difficulty: { minGap: 22, maxGap: 48 },
  jump: { rows: 4, ms: 650 },
  obstacles: [
    { from: 'scene', weight: 1 },
    {
      rows: ['.RR.', 'RRrR', 'RrRR'],
      colors: { R: 0x6b6b73, r: 0x9a9aa3 },
      weight: 0.35
    }
  ]
}
