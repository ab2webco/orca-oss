import {
  isHttpUrl,
  renderGameUrlTemplate,
  type OrchestratorGameLinkTemplate
} from './orchestrator-game-integrations'
import type {
  GameLink,
  GameLinkTone,
  GameReview,
  GameStatusGroup,
  GameWorkItem
} from './orchestrator-game-state'

const REVIEW_TONES: Record<GameReview['state'], GameLinkTone> = {
  open: 'pending',
  draft: 'neutral',
  merged: 'success',
  closed: 'neutral'
}

const CI_TONES: Record<Exclude<GameReview['ci'], 'none'>, GameLinkTone> = {
  pending: 'pending',
  success: 'success',
  failure: 'danger',
  neutral: 'neutral'
}

const WORK_ITEM_TONES: Record<GameStatusGroup, GameLinkTone> = {
  backlog: 'neutral',
  todo: 'neutral',
  in_progress: 'pending',
  review: 'pending',
  done: 'success',
  cancelled: 'neutral',
  unknown: 'neutral'
}

// Why: only these providers have a checks page Orca can address from the review URL.
const CI_PATHS: Partial<Record<GameReview['provider'], string>> = {
  github: '/checks',
  gitlab: '/pipelines'
}

function reviewLinks(review: GameReview): GameLink[] {
  const label = review.provider === 'gitlab' ? `MR !${review.number}` : `PR #${review.number}`
  const links: GameLink[] = [
    {
      id: 'review',
      kind: 'review',
      provider: review.provider,
      label,
      url: review.url,
      status: review.state,
      tone: REVIEW_TONES[review.state]
    }
  ]
  const ciPath = CI_PATHS[review.provider]
  if (ciPath && review.ci !== 'none') {
    links.push({
      id: 'ci',
      kind: 'ci',
      provider: review.provider,
      label: 'CI',
      url: `${review.url.replace(/\/+$/, '')}${ciPath}`,
      status: review.ci,
      tone: CI_TONES[review.ci]
    })
  }
  return links
}

function workItemLink(item: GameWorkItem): GameLink {
  return {
    id: 'workItem',
    kind: 'workItem',
    provider: item.provider,
    label: item.identifier,
    url: item.url,
    ...(item.status ? { status: item.status } : {}),
    tone: WORK_ITEM_TONES[item.statusGroup]
  }
}

export function projectGameLinksOf(
  templates: readonly OrchestratorGameLinkTemplate[],
  values: Readonly<Record<string, string | undefined>>
): GameLink[] {
  return templates.flatMap((template, index) => {
    const url = renderGameUrlTemplate(template.url, values)
    return url
      ? [
          {
            id: `project:${index}`,
            kind: 'project' as const,
            provider: 'project',
            label: template.label,
            url
          }
        ]
      : []
  })
}

export function gameLinksOf(input: {
  review: GameReview | null
  workItem: GameWorkItem | null
  extra?: readonly GameLink[]
}): GameLink[] {
  const links = [
    ...(input.review ? reviewLinks(input.review) : []),
    ...(input.workItem ? [workItemLink(input.workItem)] : []),
    ...(input.extra ?? [])
  ]
  return links.filter((link) => isHttpUrl(link.url))
}
