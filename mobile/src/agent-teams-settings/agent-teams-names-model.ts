import { z } from 'zod'
import type { AgentTeamsNamesSettings } from '../../../src/shared/agent-teams-names-settings'

// Why catch per field: one malformed field reads as unset instead of hiding the whole section.
const NamesList = z.array(z.string()).nullable().catch(null)
const SettingsGetNames = z.object({
  settings: z.object({
    agentTeamsNames: z.object({
      leadName: z.string().nullable().catch(null),
      memberNames: NamesList,
      sceneRoster: NamesList
    })
  })
})

/** null from a host that sends no agentTeamsNames in settings.get (it sits under `settings`). */
export const namesFromSettingsGet = (result: unknown): AgentTeamsNamesSettings | null =>
  SettingsGetNames.safeParse(result).data?.settings.agentTeamsNames ?? null

type NameRow = { value: string; source: string }

/** The lead's row: with no name it is called Lead, never a roster name (ORCA-1304). */
export const leadNameRowOf = (names: AgentTeamsNamesSettings): NameRow =>
  names.leadName === null
    ? { value: 'Lead', source: 'Lead, until you name it · default' }
    : { value: names.leadName, source: 'Every project without its own · this computer' }

export const memberNamesRowOf = (names: AgentTeamsNamesSettings): NameRow =>
  names.memberNames !== null
    ? { value: names.memberNames.join(', '), source: 'Your list · this computer' }
    : names.sceneRoster === null
      ? { value: "The scene's names", source: 'From the scene file · set them on the desktop' }
      : { value: names.sceneRoster.join(', '), source: 'From the scene' }

/** Names typed one per comma or line; an empty list means the scene's names again. */
export function memberNamesFromInput(text: string): string[] | null {
  const names = text
    .split(/[,\n]/)
    .map((one) => one.trim())
    .filter(Boolean)
  return names.length > 0 ? names : null
}
