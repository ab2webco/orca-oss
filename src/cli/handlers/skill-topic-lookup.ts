import type { HandlerContext } from '../dispatch'
import { RuntimeClientError } from '../runtime-client'

/** Topic resolution for `orca skills get`: the bundled table first, then the
 *  runtime for skills an installed plugin contributes. */

export type BundledSkillGuide = {
  name: string
  description: string
  markdown: string
  fullMarkdown: string
  aliases: readonly string[]
}

/** A skill an approved Orca plugin contributes; served by the runtime because
 *  only it knows which plugins the user granted `skills:contribute`. */
export type ContributedSkill = {
  name: string
  pluginKey: string
  pluginName: string
  sourceLabel: string
  markdown: string
}

export function canonicalGuides(guides: readonly BundledSkillGuide[]): BundledSkillGuide[] {
  return [...guides].sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0
  )
}

// Why: installed stubs may retain an old topic forever, so aliases and canonical
// names share one lookup table instead of being treated as transient CLI aliases.
export function guidesByTopic(guides: BundledSkillGuide[]): Map<string, BundledSkillGuide> {
  return new Map(
    guides.flatMap((guide) => [guide.name, ...guide.aliases].map((name) => [name, guide]))
  )
}

export function guideNames(guides: BundledSkillGuide[]): string {
  return guides.map((guide) => guide.name).join(', ')
}

export function requireTopicName(
  flags: Map<string, string | boolean>,
  guides: BundledSkillGuide[]
): string {
  const topic = flags.get('topic')
  if (typeof topic !== 'string' || topic.length === 0) {
    throw new RuntimeClientError(
      'invalid_argument',
      `Missing skill topic. Available topics: ${guideNames(guides)}`
    )
  }
  return topic
}

export function unknownTopicError(topic: string, guides: BundledSkillGuide[]): RuntimeClientError {
  return new RuntimeClientError(
    'invalid_argument',
    `Unknown skill topic "${topic}". Available topics: ${guideNames(guides)}. ` +
      'Plugin-contributed skills need a running Orca Lab with that plugin enabled.'
  )
}

/** Null on every failure on purpose: no runtime, an older host without the
 *  method, or no such contributed skill all mean "not a topic this CLI serves",
 *  and a bundled-topic lookup must never start depending on a running app. */
export async function readContributedSkill(
  context: HandlerContext,
  topic: string
): Promise<ContributedSkill | null> {
  try {
    // Inside the try on purpose: reaching for the client is itself the part that
    // fails when no runtime is configured.
    const response = await context.client.call<ContributedSkill | null>('skills.getContributed', {
      name: topic
    })
    return response.result
  } catch {
    return null
  }
}
