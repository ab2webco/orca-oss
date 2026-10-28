import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'

import type { GameAgent } from '../types'
import { cellWidthOf, fitCells } from './cell-width'
import {
  activityTextOf,
  AGENT_COLORS,
  CI_COLORS,
  fitWords,
  memberHeadingOf,
  memberHeadOf,
  memberMetaOf,
  reviewTextOf,
  workItemTextOf
} from './fleet-labels'
import { TILE_COLUMNS } from './fleet-tiles'
import { gameStrings, localizedNameOf } from './game-strings'
import type { CardState } from './lead-state'
import { limitTagOf } from './member-tags'
import type { PartyMember } from './party'
import { activityOf } from './quest-policy'
import type { SceneDefinition } from './scenes/scene-definition'
import { HOTKEY_CELLS } from './tap-layout'

export type MemberCardParts = {
  scene: SceneDefinition
  room: number
  leadTitle: string | null
  cardState: CardState
  tile?: RenderElement
  /** False drops the tile column: a phone card gives its width to the ticket (ORCA-827). */
  withTile?: boolean
  view?: RenderElement
  advisorRows: RenderElement[]
  link: (key: string, url: string, label: string, child: RenderElement) => RenderElement
}

// The card's icon is left out: `◆` is also Jev's mark on the row above.
/** What the member is doing: its phase's character and, while it works, its last tool. */
export const memberDoingOf = (
  agent: Pick<GameAgent, 'state' | 'toolName'>,
  member: Pick<PartyMember, 'phase'>,
  scene: SceneDefinition
): string => {
  const card = scene.cards[member.phase]
  const tool = agent.state === 'working' ? (agent.toolName ?? '') : ''
  return [localizedNameOf(card.name), tool === '' ? '' : activityOf(tool, {})]
    .filter((part) => part !== '')
    .join(' · ')
}

// A terminal has one font size, so rank is color and weight: the id bold, the title plain, the rest dim.
export function memberCard(
  $: EngineInterface,
  e: RenderInput,
  agent: GameAgent,
  member: PartyMember,
  parts: MemberCardParts
): RenderElement {
  const { Box, Text } = $.ui.resolve(e)
  const text = gameStrings().text
  const color = AGENT_COLORS[parts.cardState]
  const heading = memberHeadingOf(agent)
  const crown = parts.leadTitle === null ? '' : `♛ ${parts.leadTitle}`
  const viewCells = parts.view === undefined ? 0 : cellWidthOf(` ${text.view} `) + HOTKEY_CELLS + 1
  const crownCells = crown === '' ? 0 : cellWidthOf(crown) + 1
  const head = memberHeadOf(
    heading.name,
    text.agentStates[parts.cardState],
    parts.room - viewCells - crownCells,
    parts.room
  )
  // Both cut to one row, the ticket before the review, since a wrapped link reads as two.
  const review = agent.review === undefined ? '' : fitCells(reviewTextOf(agent.review), parts.room)
  const workItem =
    agent.workItem === undefined
      ? ''
      : fitCells(
          workItemTextOf(agent.workItem),
          parts.room - (review === '' ? 0 : cellWidthOf(review) + 1)
        )
  return (
    <Box
      key={`card-${agent.paneKey}`}
      flexDirection="row"
      borderStyle="round"
      borderColor={agent.limit === undefined ? color : 'red'}
    >
      {parts.withTile === false ? null : (parts.tile ?? <Box width={TILE_COLUMNS} />)}
      <Box flexDirection="column" paddingX={1} flexGrow={1} flexShrink={1}>
        {/* Why wrap: on a phone the crown and state move down whole instead of splitting mid-word. */}
        <Box flexDirection="row" columnGap={1} flexWrap="wrap">
          {head.name !== '' && (
            <Box flexShrink={0}>
              <Text color={color} bold>
                {head.name}
              </Text>
            </Box>
          )}
          {crown !== '' && (
            <Box flexShrink={0}>
              <Text color={parts.scene.band.gold}>{crown}</Text>
            </Box>
          )}
          <Box flexShrink={0}>
            <Text color={color}>{head.state}</Text>
          </Box>
          <Box flexGrow={1} />
          {parts.view}
        </Box>
        {heading.title !== '' && (
          <Text wrap="truncate-end">{fitWords(heading.title, parts.room)}</Text>
        )}
        <Text dimColor wrap="truncate-end">
          {memberMetaOf(agent, parts.room)}
        </Text>
        {agent.limit !== undefined && (
          <Text color="red" bold wrap="truncate-end">
            {limitTagOf(agent.limit, Date.now())}
          </Text>
        )}
        {parts.advisorRows}
        <Text wrap="truncate-end">
          {fitCells(memberDoingOf(agent, member, parts.scene), parts.room)}
        </Text>
        {(review !== '' || workItem !== '') && (
          <Box flexDirection="row" gap={1}>
            {agent.review !== undefined &&
              review !== '' &&
              parts.link(
                `review-${agent.paneKey}`,
                agent.review.url,
                reviewTextOf(agent.review),
                <Text color={CI_COLORS[agent.review.ci]} underline>
                  {review}
                </Text>
              )}
            {agent.workItem !== undefined &&
              workItem !== '' &&
              (agent.workItem.url === '' ? (
                <Text>{workItem}</Text>
              ) : (
                parts.link(
                  `work-item-${agent.paneKey}`,
                  agent.workItem.url,
                  workItemTextOf(agent.workItem),
                  <Text underline>{workItem}</Text>
                )
              ))}
          </Box>
        )}
        {agent.activity !== undefined &&
          parts.link(
            `activity-${agent.paneKey}`,
            agent.activity.url,
            agent.activity.id,
            <Text
              color={agent.activity.running ? 'cyan' : parts.scene.band.parchment}
              wrap="truncate-end"
            >
              {fitCells(
                activityTextOf({
                  name: agent.activity.name,
                  label: agent.activity.id,
                  running: agent.activity.running
                }),
                parts.room
              )}
            </Text>
          )}
      </Box>
    </Box>
  )
}
