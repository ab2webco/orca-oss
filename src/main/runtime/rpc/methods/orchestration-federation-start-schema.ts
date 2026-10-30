import { z } from 'zod'
import { ORCHESTRATOR_GAME_SCENE_MAX_BYTES } from '../../../../shared/orchestrator-game-scene'
import { OptionalFiniteNumber, OptionalString, requiredString } from '../schemas'
import { OptionalWorkerLaunchPreference } from './orchestration-worker-start-schema'

export const FederationAttachStartParams = z.object({
  dispatchId: requiredString('Missing Dispatch ID'),
  taskId: requiredString('Missing Task ID'),
  taskSpec: requiredString('Missing Task spec'),
  protocolVersion: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  worktree: requiredString('Missing remote worktree selector'),
  name: OptionalString,
  repo: OptionalString,
  baseBranch: OptionalString,
  displayName: OptionalString,
  comment: OptionalString,
  setup: z.enum(['run', 'skip', 'inherit']).optional(),
  setupSource: z.enum(['explicit_request', 'orchestration_default']).optional(),
  terminal: OptionalString,
  agent: OptionalString,
  model: OptionalWorkerLaunchPreference,
  effort: OptionalWorkerLaunchPreference,
  timeoutMs: OptionalFiniteNumber,
  devMode: z.boolean().optional(),
  // Why optional: the home sends both only to a host advertising the game-member capability.
  game: z.boolean().optional(),
  setupAdmission: z.enum(['queue']).optional(),
  // Why optional: the home sends it only to a host advertising the game-scene capability.
  gameScene: z
    .object({
      id: z.string().min(1).max(512),
      text: z.string().max(ORCHESTRATOR_GAME_SCENE_MAX_BYTES)
    })
    .optional(),
  // Why optional: the home sends it only to a host advertising the member-account capability.
  account: z.string().min(1).max(320).optional()
})

export type FederationAttachStartInput = z.infer<typeof FederationAttachStartParams>
