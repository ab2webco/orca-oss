import { isDeepStrictEqual } from 'node:util'
import {
  isPlainObject,
  removeManagedCommands,
  type HookDefinition,
  type HooksConfig
} from '../agent-hooks/installer-utils'

/**
 * `keep-existing` is a dev Orca's policy for the real ~/.claude/settings.json: it never
 * rewrites or replaces an Orca entry the installed Orca put there, and adds its own only when
 * none exists, so a contributor without an installed Orca still gets status hooks (ORCA-1113).
 */
export type ManagedHookWritePolicy = 'replace' | 'keep-existing'

type ManagedCommandMatcher = (command: string | undefined) => boolean

function isManagedDefinition(
  definition: HookDefinition,
  isManaged: ManagedCommandMatcher
): boolean {
  return !isDeepStrictEqual(removeManagedCommands([definition], isManaged), [definition])
}

/** True when the event already holds exactly `expected` as its only Orca entry, wherever it sits. */
export function holdsIdenticalManagedEntry(
  current: readonly HookDefinition[],
  expected: HookDefinition,
  isManaged: ManagedCommandMatcher
): boolean {
  const managed = current.filter((definition) => isManagedDefinition(definition, isManaged))
  return managed.length === 1 && isDeepStrictEqual(managed[0], expected)
}

export function hasAnyManagedHook(config: HooksConfig, isManaged: ManagedCommandMatcher): boolean {
  const hooks = isPlainObject(config.hooks) ? config.hooks : {}
  return Object.values(hooks).some(
    (definitions) =>
      Array.isArray(definitions) &&
      definitions.some((definition) => isManagedDefinition(definition, isManaged))
  )
}
