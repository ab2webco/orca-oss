import type { TeamSceneBody, TeamSceneWorld } from './team-scene-director'
import { teamSceneStrideAt } from './team-scene-motion'
import type { TeamSceneActivity, TeamSceneActor, TeamScenePose } from './team-scene-types'

const SEATED_POSE: Record<TeamSceneActivity, TeamScenePose> = {
  working: 'work',
  resting: 'idle',
  needsYou: 'raise',
  done: 'done'
}

function poseOf(world: TeamSceneWorld, body: TeamSceneBody): TeamScenePose {
  if (world.t < world.cheerUntil) {
    return 'cheer'
  }
  if (Math.abs(body.v) > 3) {
    return 'walk'
  }
  const visit = world.visitor ? world.bodies.get(world.visitor)?.plan : undefined
  const atLead = visit && visit.kind !== 'seated' && visit.stage === 'atLead' ? visit : null
  if (atLead && (body.role === 'lead' || body.key === world.visitor)) {
    return atLead.kind === 'handoff' ? 'give' : 'wave'
  }
  if (body.role === 'advisor') {
    return world.t < world.advisorRaiseUntil ? 'raise' : 'idle'
  }
  return body.plan.kind === 'leave' ? 'idle' : SEATED_POSE[body.activity]
}

/** What styles draw this frame, back to front. */
export function teamSceneActors(world: TeamSceneWorld): TeamSceneActor[] {
  const cheering = world.t < world.cheerUntil
  return [...world.bodies.values()]
    .map((body): TeamSceneActor => {
      const timed = body.emote && world.t < body.emote.until ? body.emote.kind : null
      const seatedMark =
        body.plan.kind !== 'seated'
          ? null
          : body.activity === 'needsYou'
            ? 'alert'
            : body.activity === 'done'
              ? 'check'
              : null
      const plan = body.plan
      return {
        key: body.key,
        role: body.role,
        name: body.name,
        characterKey: body.characterKey,
        x: body.x,
        depth: body.depth,
        facing: body.facing,
        pose: poseOf(world, body),
        gait: body.gait,
        stride: teamSceneStrideAt(body.depth),
        carrying: plan.kind === 'handoff' && plan.stage === 'toLead',
        emote: timed ?? seatedMark,
        jump: cheering ? Math.abs(Math.sin(world.t * 6.5 + body.x * 9)) * 8 : 0
      }
    })
    .sort((p, q) => p.depth - q.depth)
}
