import { z } from 'zod'
import { defineMethod, type RpcMethod } from '../core'
import { SkillDiscoveryTargetSchema } from '../../../../shared/skills'
import {
  discoverSkillsOnTarget,
  resolveSkillDiscoveryTarget
} from '../../../skills/skill-discovery-target'
import { readOrcaPluginSkill } from '../../../skills/orca-plugin-skill-sources'

export const SKILL_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'skills.discover',
    params: SkillDiscoveryTargetSchema.default({}),
    handler: async (params, { runtime }) => {
      // Why: the executing runtime owns WSL project preferences. Remote callers
      // send worktree identity only; trusting their projectRuntime absence
      // would scan this host's native filesystem for a WSL-configured project.
      const target = params.projectRuntime
        ? params
        : {
            ...params,
            projectRuntime: runtime.resolveProjectRuntimeForWorktree(params.worktreeId)
          }
      return discoverSkillsOnTarget(resolveSkillDiscoveryTarget(target), runtime.listRepos(), {
        refresh: params.refresh === true
      })
    }
  }),
  // Backs `orca skills get` for plugin-contributed skills: the CLI has no way
  // to know which plugins the user approved, and on a remote host the bytes
  // only exist here. Additive method — an older host answers method_not_found
  // and the CLI falls back to its bundled-only error.
  defineMethod({
    name: 'skills.getContributed',
    params: z.object({ name: z.string().min(1).max(256) }),
    handler: async (params) => readOrcaPluginSkill(params.name)
  })
]
