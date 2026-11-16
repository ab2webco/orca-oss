import type { EngineInterface } from 'claude-code'

import { stewardEffortOf, type StewardPick } from './steward-rules'

/**
 * The pick Jev's model router is sending this member's steps on, or null: Jev absent, its router
 * off or measuring, or keeping the session's own. Installed alone never counts (ORCA-1242).
 */
export async function routerRouteOf($: EngineInterface): Promise<StewardPick | null> {
  const held = await $.state
    .get({ plugin: 'orca-jev-mod-skills', key: 'routerSticky' })
    .catch(() => ({ value: undefined }))
  const sticky: unknown = held.value
  if (typeof sticky !== 'object' || sticky === null || Reflect.get(sticky, 'rewrite') !== true) {
    return null
  }
  const model: unknown = Reflect.get(sticky, 'model')
  return { model: String(model), effort: stewardEffortOf(Reflect.get(sticky, 'effort')) }
}
