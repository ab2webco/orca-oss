import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'

import type { GameState } from '../types'
import { CI_COLORS, reviewTextOf, workItemTextOf } from './fleet-labels'
import type { SectionMarks } from './fleet-project'
import { gameStrings } from './game-strings'

type LinkOf = (key: string, url: string, label: string, child: RenderElement) => RenderElement

/** The review and work item rows under one ▾/▸ mark; no `review` when the pane has neither. */
export function reviewSectionOf(
  $: EngineInterface,
  e: RenderInput,
  state: GameState,
  marks: SectionMarks,
  link: LinkOf
): Partial<Record<'review', RenderElement>> {
  const { Box, Text } = $.ui.resolve(e)
  const text = gameStrings().text
  const isCollapsed = marks.isCollapsed('review')
  const reviewRow =
    state.review === null ? null : (
      <Box key="pane-review" flexDirection="row" gap={1}>
        <Box width={10}>
          <Text dimColor>{text.reviewHeading}</Text>
        </Box>
        {link(
          'pane-review',
          state.review.url,
          reviewTextOf(state.review),
          <Text color={CI_COLORS[state.review.ci]} underline>
            {reviewTextOf(state.review)}
          </Text>
        )}
        <Text dimColor wrap="truncate-end">
          {state.review.title}
        </Text>
      </Box>
    )
  const workItemRow =
    state.workItem === null ? null : (
      <Box key="pane-work-item" flexDirection="row" gap={1}>
        <Box width={10}>
          <Text dimColor>{text.workItemHeading}</Text>
        </Box>
        {state.workItem.url === '' ? (
          <Text>{workItemTextOf(state.workItem)}</Text>
        ) : (
          link(
            'pane-work-item',
            state.workItem.url,
            workItemTextOf(state.workItem),
            <Text underline>{workItemTextOf(state.workItem)}</Text>
          )
        )}
        <Text dimColor wrap="truncate-end">
          {state.workItem.title}
        </Text>
      </Box>
    )
  // Collapsed, the review keeps its CI color so a red CI still shows on the one line.
  const reviewSummary =
    state.review !== null ? (
      <Text>
        {`${text.reviewHeading} `}
        <Text color={CI_COLORS[state.review.ci]}>{reviewTextOf(state.review)}</Text>
      </Text>
    ) : state.workItem !== null ? (
      <Text>{`${text.workItemHeading} ${workItemTextOf(state.workItem)}`}</Text>
    ) : null
  if (reviewSummary === null) {
    return {}
  }
  const review = (
    <Box key="section-review" flexDirection="column">
      <Box key="layout-header-review" flexDirection="row">
        {marks.markOf('review')}
        {isCollapsed ? reviewSummary : (reviewRow ?? workItemRow)}
      </Box>
      {!isCollapsed && reviewRow !== null && workItemRow !== null && (
        <Box paddingLeft={2}>{workItemRow}</Box>
      )}
    </Box>
  )
  return { review }
}
