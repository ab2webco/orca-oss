import { z } from 'zod'
import type { OrchestratorGameBuiltInScene } from './orchestrator-game-config'
import type { OrchestratorGameLead } from './orchestrator-game-lead'
import { ticketInText } from './orchestrator-game-ticket-id'
import { isSafeDisplayCharacter } from './skill-display-text'

/** The character names a lead's members take, from the active scene's roster. */

export type GameMemberName = string | { en: string; es?: string }

export const GAME_MEMBER_NAME_MAX = 32
export const GAME_MEMBER_ROSTER_MAX = 24
const SEPARATOR = ' · '

const nameSchema = z.union([z.string(), z.object({ en: z.string(), es: z.string().optional() })])

const variantsOf = (name: GameMemberName): string[] =>
  typeof name === 'string' ? [name] : [name.en, ...(name.es === undefined ? [] : [name.es])]

function variantIssueOf(variant: string): string | null {
  if (variant.trim().length === 0 || variant.length > GAME_MEMBER_NAME_MAX) {
    return `must be 1 to ${GAME_MEMBER_NAME_MAX} characters`
  }
  if (![...variant].every(isSafeDisplayCharacter)) {
    return 'must not contain control characters'
  }
  if (variant.includes(SEPARATOR.trim())) {
    return `must not contain "${SEPARATOR}"`
  }
  // Why: the ticket is read back out of the member's name, so a name must never parse as one.
  return ticketInText(variant) === null ? null : 'must not look like a ticket id'
}

export const memberRosterSchema = z
  .array(nameSchema)
  .min(1, `must list 1 to ${GAME_MEMBER_ROSTER_MAX} names`)
  .max(GAME_MEMBER_ROSTER_MAX, `must list 1 to ${GAME_MEMBER_ROSTER_MAX} names`)
  .superRefine((roster, ctx) => {
    const seen = new Set<string>()
    roster.forEach((name, index) => {
      for (const variant of variantsOf(name)) {
        const issue = variantIssueOf(variant)
        if (issue !== null) {
          ctx.addIssue({ code: 'custom', path: [index], message: issue })
          return
        }
      }
      const key = variantsOf(name)[0]?.toLowerCase() ?? ''
      if (seen.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: [index],
          message: `"${variantsOf(name)[0]}" is listed twice`
        })
      }
      seen.add(key)
    })
  })

export type MemberRosterProblem = { path: string; message: string }

/** The roster, or every reason Orca refuses it; `path` is the index, empty for the list itself. */
export function parseMemberRoster(raw: unknown): {
  roster?: GameMemberName[]
  problems: MemberRosterProblem[]
} {
  const parsed = memberRosterSchema.safeParse(raw)
  return parsed.success
    ? { roster: parsed.data, problems: [] }
    : {
        problems: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message
        }))
      }
}

export const memberRosterIssues = (raw: unknown): string[] =>
  parseMemberRoster(raw).problems.map(({ path, message }) => `${path || '(root)'}: ${message}`)

// Why public-domain and original names: built-in scenes ship in Orca, so no franchise characters.
export const ORCHESTRATOR_GAME_BUILT_IN_ROSTERS: Readonly<
  Record<OrchestratorGameBuiltInScene, readonly GameMemberName[]>
> = {
  quest: [
    { en: 'Arthur', es: 'Arturo' },
    { en: 'Merlin', es: 'Merlín' },
    { en: 'Lancelot', es: 'Lanzarote' },
    { en: 'Guinevere', es: 'Ginebra' },
    { en: 'Gawain', es: 'Galván' },
    'Morgana',
    'Percival',
    { en: 'Tristan', es: 'Tristán' },
    { en: 'Isolde', es: 'Isolda' },
    'Galahad',
    'Bedivere',
    'Elaine'
  ],
  vigilante: [
    'Nightjar',
    'Raven',
    'Lynx',
    'Vesper',
    'Specter',
    'Onyx',
    'Talon',
    'Nova',
    'Shade',
    'Ember',
    'Falcon',
    'Cipher'
  ],
  jrpg: [
    'Aerin',
    'Kael',
    'Lyra',
    'Riven',
    'Sora',
    'Thane',
    'Mira',
    'Elara',
    'Bryn',
    'Corin',
    'Faye',
    'Zephyr'
  ],
  tamer: [
    'Pip',
    'Mochi',
    'Bramble',
    'Sprout',
    'Pebble',
    'Fern',
    'Clover',
    'Thistle',
    'Puddle',
    'Nibbles',
    'Juniper',
    'Biscuit'
  ]
}

const isBuiltIn = (scene: string): scene is OrchestratorGameBuiltInScene =>
  Object.hasOwn(ORCHESTRATOR_GAME_BUILT_IN_ROSTERS, scene)

type RosterSource = {
  config: { scene?: string }
  lead?: Pick<OrchestratorGameLead, 'memberNames'>
  extensions?: {
    scenes: readonly { id: string; definition: { roster?: readonly GameMemberName[] } }[]
  }
}

/** The project's memberNames, else the active scene's roster; an unlisted scene falls back to Quest, as the mod draws it. */
export function memberRosterOf(state: RosterSource): readonly GameMemberName[] {
  if (state.lead?.memberNames !== undefined) {
    return state.lead.memberNames
  }
  const scene = state.config.scene ?? 'quest'
  if (isBuiltIn(scene)) {
    return ORCHESTRATOR_GAME_BUILT_IN_ROSTERS[scene]
  }
  const contributed = state.extensions?.scenes.find((one) => one.id === scene)
  return contributed
    ? (contributed.definition.roster ?? [])
    : ORCHESTRATOR_GAME_BUILT_IN_ROSTERS.quest
}

const shownIn = (name: GameMemberName, locale: string): string =>
  typeof name === 'string' ? name : locale === 'es' && name.es ? name.es : name.en

const numbered = (variant: string, n: number): string =>
  `${variant.slice(0, GAME_MEMBER_NAME_MAX - String(n).length - 1).trimEnd()} ${n}`

/**
 * The first roster name no live member holds, in `locale` when the roster has it. Once all are
 * taken, a numbered one (`Arthur 2`); null only without a roster.
 */
export function nextMemberName(
  roster: readonly GameMemberName[],
  inUse: readonly string[],
  locale: string
): string | null {
  const taken = new Set(inUse.map((one) => one.toLowerCase()))
  const isFree = (variants: readonly string[]): boolean =>
    variants.every((variant) => !taken.has(variant.toLowerCase()))
  const free = roster.find((name) => isFree(variantsOf(name)))
  if (free !== undefined) {
    return shownIn(free, locale)
  }
  // Why: the roster sets the scene's names, not how many members the machine can run.
  for (let n = 2; n <= taken.size + 2; n += 1) {
    for (const name of roster) {
      const variants = variantsOf(name).map((variant) => numbered(variant, n))
      if (isFree(variants) && variants.every((variant) => variantIssueOf(variant) === null)) {
        return numbered(shownIn(name, locale), n)
      }
    }
  }
  return null
}

/** One key for every language variant of a roster name, so a character's progress is not split. */
export function characterKeyOf(roster: readonly GameMemberName[], shown: string): string {
  const wanted = shown.trim().toLowerCase()
  const entry = roster.find((name) =>
    variantsOf(name).some((variant) => variant.toLowerCase() === wanted)
  )
  return entry === undefined ? wanted : (variantsOf(entry)[0] ?? shown).toLowerCase()
}

/** `<name> · <ticket title>` cut to `max`, never into `ticket`; the base alone without a name. */
export function memberDisplayNameOf(
  name: string | null,
  base: string,
  max: number,
  ticket = ''
): string {
  if (name === null) {
    return base.slice(0, max)
  }
  const prefix = `${name}${SEPARATOR}`
  return `${prefix}${base.slice(0, Math.max(max - prefix.length, ticket.length))}`
}

const NAMED = /^(.+?) · (?=[A-Za-z][A-Za-z0-9_]*-\d+(?:\s|$))/

/** The character a member was named after, read back from its display name. */
export const memberNameOf = (displayName: string | null | undefined): string | null =>
  (displayName && NAMED.exec(displayName)?.[1]) || null
