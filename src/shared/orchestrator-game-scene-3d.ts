import { z } from 'zod'
import { color } from './orchestrator-game-scene-values'

/** The optional 3D block of a scene: what Orca's WebGL panel draws, as a point figure. */

export const ORCHESTRATOR_GAME_SCENE_3D_FIGURES = [
  'sphere',
  'torus',
  'helix',
  'wave',
  'clusters'
] as const

// Why a cap in the format: the memory budget holds for any project's file, before a frame is drawn.
export const ORCHESTRATOR_GAME_SCENE_3D_MAX_NODES = 1600
const MIN_NODES = 50
const MAX_LINKS = 4

const nodesError = `must be a whole number from ${MIN_NODES} to ${ORCHESTRATOR_GAME_SCENE_3D_MAX_NODES}`
const linksError = `must be a whole number from 0 to ${MAX_LINKS}`
const spinError = 'must be from 0 to 1'

const scene3dSchema = z.object({
  figure: z.enum(ORCHESTRATOR_GAME_SCENE_3D_FIGURES),
  nodes: z
    .number({ error: nodesError })
    .int(nodesError)
    .min(MIN_NODES, nodesError)
    .max(ORCHESTRATOR_GAME_SCENE_3D_MAX_NODES, nodesError),
  links: z
    .number({ error: linksError })
    .int(linksError)
    .min(0, linksError)
    .max(MAX_LINKS, linksError)
    .default(3),
  spin: z.number({ error: spinError }).min(0, spinError).max(1, spinError).default(0.3),
  pulses: z.boolean().default(true),
  // Why optional: a missing color is taken from the scene's own looks.
  colors: z.object({ node: color, link: color, glow: color }).partial().optional()
})

export type OrchestratorGameScene3d = z.infer<typeof scene3dSchema>

// Why apart, like the roster and themes: a bad 3D block only costs the 3D; the scene draws as 2D.
export function orchestratorGameScene3dOf(raw: unknown): {
  scene3d?: OrchestratorGameScene3d
  issues: string[]
} {
  if (typeof raw !== 'object' || raw === null || !('scene3d' in raw)) {
    return { issues: [] }
  }
  const parsed = scene3dSchema.safeParse(raw.scene3d)
  return parsed.success
    ? { scene3d: parsed.data, issues: [] }
    : {
        issues: parsed.error.issues.map(
          (issue) => `${['scene3d', ...issue.path].join('.')}: ${issue.message}`
        )
      }
}
