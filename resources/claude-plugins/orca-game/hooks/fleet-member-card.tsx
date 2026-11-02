import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'

import type { GameAgent } from '../types'
import { cellWidthOf, fitCells } from './cell-width'
import {
  activityTextOf,
  AGENT_COLORS,
  CI_COLORS,
  memberHeadingOf,
  memberMetaOf,
  reviewTextOf,
  workItemTextOf
} from './fleet-labels'
import { cardChipsOf, cardHeadOf, cardMetaRowsOf } from './member-card-rows'
import { TILE_COLUMNS } from './fleet-tiles'
import { localizedNameOf } from './game-strings'
import type { CardState } from './lead-state'
import { limitTagOf } from './member-tags'
import { viewLabelOf } from './remote-member-view'
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
  /** A phone card: chips stack beside View's touch chip (ORCA-949). */
  isTap?: boolean
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

// A terminal has one font size, so rank is color and weight: the id bold, the title bright, the rest dim.
export function memberCard(
  $: EngineInterface,
  e: RenderInput,
  agent: GameAgent,
  member: PartyMember,
  parts: MemberCardParts
): RenderElement {
  const { Box, Text } = $.ui.resolve(e)
  const { gold, panel, parchment } = parts.scene.band
  const color = AGENT_COLORS[parts.cardState]
  const heading = memberHeadingOf(agent)
  const head = cardHeadOf({
    name: heading.name,
    title: heading.title,
    cardState: parts.cardState,
    crown: parts.leadTitle === null ? '' : `♛ ${parts.leadTitle}`,
    room: parts.room
  })
  const viewLabel = parts.isTap ? ` ▸ ${viewLabelOf(agent)} ` : ` ${viewLabelOf(agent)} `
  const viewCells = parts.view === undefined ? 0 : cellWidthOf(viewLabel) + HOTKEY_CELLS + 1
  const chips = cardChipsOf({
    review: agent.review,
    workItem: agent.workItem,
    room: parts.isTap ? parts.room - viewCells : parts.room
  })
  const chipOf = (chip: (typeof chips)[number]) =>
    chip.key === 'review' && agent.review !== undefined ? (
      parts.link(
        `review-${agent.paneKey}`,
        agent.review.url,
        reviewTextOf(agent.review),
        <Text color={CI_COLORS[agent.review.ci]} backgroundColor={panel}>
          {chip.text}
        </Text>
      )
    ) : agent.workItem !== undefined && agent.workItem.url !== '' ? (
      parts.link(
        `work-item-${agent.paneKey}`,
        agent.workItem.url,
        workItemTextOf(agent.workItem),
        <Text color={parchment} backgroundColor={panel}>
          {chip.text}
        </Text>
      )
    ) : (
      <Text key={`work-item-${agent.paneKey}`} color={parchment} backgroundColor={panel}>
        {chip.text}
      </Text>
    )
  const metaRows = cardMetaRowsOf(
    memberMetaOf(agent, parts.room),
    memberDoingOf(agent, member, parts.scene),
    parts.room
  )
  const hasChipRow = chips.length > 0 || parts.view !== undefined
  return (
    <Box
      key={`card-${agent.paneKey}`}
      flexDirection="row"
      borderStyle="round"
      borderColor={agent.limit === undefined ? color : 'red'}
    >
      {parts.withTile === false ? null : (parts.tile ?? <Box width={TILE_COLUMNS} />)}
      <Box flexDirection="column" paddingX={1} flexGrow={1} flexShrink={1}>
        <Box key="card-head" flexDirection="row">
          <Text color={color} bold>
            {head.name}
          </Text>
          {parts.leadTitle !== null && <Text color={gold}>{` ♛ ${parts.leadTitle}`}</Text>}
          {head.title !== '' && (
            <Box marginLeft={2} flexShrink={1}>
              <Text color={parchment} bold wrap="truncate-end">
                {head.title}
              </Text>
            </Box>
          )}
          <Box flexGrow={1} />
          {head.isAlert ? (
            <Text color="white" backgroundColor="red" bold>
              {head.pill}
            </Text>
          ) : (
            <Text color={color} backgroundColor={panel}>
              {head.pill}
            </Text>
          )}
        </Box>
        {head.titleBelow !== '' && (
          <Text color={parchment} bold>
            {head.titleBelow}
          </Text>
        )}
        {metaRows.map((row, at) => (
          <Text key={`card-meta-${at}`} dimColor wrap="truncate-end">
            {row}
          </Text>
        ))}
        {agent.limit !== undefined && (
          <Text color="red" bold wrap="truncate-end">
            {limitTagOf(agent.limit, Date.now())}
          </Text>
        )}
        {parts.advisorRows}
        {hasChipRow &&
          (parts.isTap ? (
            // A phone stacks the chips beside View's three-row touch chip.
            <Box key="card-chips" flexDirection="row" marginTop={1}>
              <Box flexDirection="column" flexGrow={1} flexShrink={1} rowGap={1}>
                {chips.map((chip) => (
                  <Box key={`card-chip-${chip.key}`} flexDirection="row">
                    {chipOf(chip)}
                  </Box>
                ))}
              </Box>
              {parts.view}
            </Box>
          ) : (
            <Box key="card-chips" flexDirection="row" columnGap={1} marginTop={1}>
              {chips.map(chipOf)}
              <Box flexGrow={1} />
              {parts.view}
            </Box>
          ))}
        {agent.activity !== undefined &&
          parts.link(
            `activity-${agent.paneKey}`,
            agent.activity.url,
            agent.activity.id,
            <Text color={agent.activity.running ? 'cyan' : parchment} wrap="truncate-end">
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
