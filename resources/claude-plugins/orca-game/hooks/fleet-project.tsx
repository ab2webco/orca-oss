import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'

import type {
  GameAction,
  GameLinkTone,
  GameProjectItem,
  GameProjectList,
  GameState
} from '../types'
import { actionHotkeysOf } from './action-results'
import { reviewKindOf } from './band-chips'
import { actionRunsOf, mcpCallTextOf, runAction, workOn } from './game-actions'
import { gameLinkOf } from './game-link'
import { gameStrings } from './game-strings'
import type { BandPalette } from './scenes/scene-definition'
import { actionLabelOf, listActionOf } from './lead-actions'
import { tapButtonsOf } from './tap-buttons'
import { isTapLayout } from './tap-layout'
import { todoDrawnCountOf, todoSectionsOf } from './todo-sections'

const TONE_COLORS: Readonly<Record<GameLinkTone, string>> = {
  danger: 'red',
  pending: 'yellow',
  success: 'green',
  neutral: 'white'
}

/** My PRs, my To Do grouped by status, and the project's actions with each MCP one's last result. */
export async function projectRowsOf(
  $: EngineInterface,
  e: RenderInput,
  state: GameState,
  palette: BandPalette,
  isDemo: boolean,
  columns: number
): Promise<RenderElement[]> {
  const { Box, Text, Button } = $.ui.resolve(e)
  const worktreeId = state.worktree?.id ?? ''
  const text = gameStrings().text
  const runs = await actionRunsOf($)
  const itemRow = (key: string, one: GameProjectItem) => (
    <Box key={`${key}-${one.id}`} flexDirection="row" gap={1}>
      {one.prompt !== undefined && (
        <Button
          key={`work-${one.id}`}
          plain
          onPress={() => void workOn($, one, isDemo).catch(() => undefined)}
        >
          <Text color={palette.gold} bold>
            ▶
          </Text>
        </Button>
      )}
      {/* Why no shrink: only the title gives way, so an id or status never wraps mid-word. */}
      <Box flexShrink={0}>
        {gameLinkOf(
          $,
          e,
          { key: `${key}-link-${one.id}`, url: one.url, worktreeId, label: one.id },
          <Text color={TONE_COLORS[one.tone ?? 'neutral']} underline>
            {one.id}
          </Text>
        )}
      </Box>
      {one.status !== undefined && (
        <Box flexShrink={0}>
          <Text dimColor>{one.status}</Text>
        </Box>
      )}
      <Box flexShrink={1} minWidth={0}>
        <Text wrap="truncate-end">{one.title}</Text>
      </Box>
    </Box>
  )
  // A heading that opens the list, then the items, under a heading per status when they have one.
  const listRows = (key: string, heading: string, list: GameProjectList, action?: GameAction) => {
    const sections = todoSectionsOf(list)
    return (
      <Box key={key} flexDirection="column">
        <Box flexDirection="row" gap={1}>
          {action !== undefined ? (
            <Button
              key={`${key}-action`}
              plain
              onPress={() => void runAction($, action, isDemo).catch(() => undefined)}
            >
              <Text bold underline>
                {heading}
              </Text>
            </Button>
          ) : list.url === null ? (
            <Text bold>{heading}</Text>
          ) : (
            gameLinkOf(
              $,
              e,
              { key: `${key}-link`, url: list.url, worktreeId, label: heading },
              <Text bold underline>
                {heading}
              </Text>
            )
          )}
        </Box>
        {sections.flatMap((section, at) => [
          ...(section.heading === null
            ? []
            : [
                <Text key={`${key}-heading-${at}`} dimColor bold>
                  {`${text.todoHeadings[section.heading]}${section.count === undefined ? '' : ` ${section.count}`}`}
                </Text>
              ]),
          ...section.items.map((one) => itemRow(key, one))
        ])}
        {list.total > todoDrawnCountOf(sections) && (
          <Text dimColor>{text.moreAllies(list.total - todoDrawnCountOf(sections))}</Text>
        )}
      </Box>
    )
  }
  const actionButton = (action: GameAction, hotkey: string | undefined) => {
    return (
      <Button
        key={`action-${action.id}`}
        plain
        hotkey={hotkey}
        onPress={() => void runAction($, action, isDemo).catch(() => undefined)}
      >
        <Text backgroundColor={palette.panel} color={palette.parchment}>
          {` ${actionLabelOf(action)} `}
          {'mcp' in action && <Text dimColor>{`${mcpCallTextOf(action.mcp)} `}</Text>}
        </Text>
      </Button>
    )
  }
  const resultRows = (action: GameAction) => {
    const run = runs[action.id]
    if (!('mcp' in action) || run === undefined || run.call !== mcpCallTextOf(action.mcp)) {
      return []
    }
    const color = run.status === 'error' ? 'red' : undefined
    return [
      <Box key={`action-result-${action.id}`} flexDirection="column" paddingLeft={2}>
        <Text dimColor wrap="truncate-end">
          {run.status === 'running'
            ? `${actionLabelOf(action)} · ${text.actionRunning}`
            : actionLabelOf(action)}
        </Text>
        {run.lines.map((line, at) => (
          <Text key={`line-${at}`} color={color} wrap="truncate-end">
            {line}
          </Text>
        ))}
      </Box>
    ]
  }
  const reviews = state.project?.reviews ?? null
  const todo = state.project?.todo ?? null
  const actions = state.actions ?? []
  const hotkeys = actionHotkeysOf(actions)
  return [
    ...(reviews === null
      ? []
      : [
          listRows(
            'project-reviews',
            text.myReviews(reviewKindOf(reviews), reviews.total),
            reviews,
            listActionOf(state, 'reviews')
          )
        ]),
    ...(todo === null
      ? []
      : [listRows('project-todo', text.todo(todo.total), todo, listActionOf(state, 'todo'))]),
    ...(actions.length === 0
      ? []
      : [
          isTapLayout(columns) ? (
            <Box key="project-actions" flexDirection="column">
              <Text dimColor>{text.actionsHeading}</Text>
              {tapButtonsOf(
                $,
                e,
                'project-actions-tap',
                actions.map((action) => ({
                  key: `action-${action.id}`,
                  labels: [
                    'mcp' in action
                      ? `${actionLabelOf(action)} ${mcpCallTextOf(action.mcp)}`
                      : actionLabelOf(action)
                  ],
                  hotkey: hotkeys.get(action.id),
                  onPress: () => void runAction($, action, isDemo).catch(() => undefined),
                  color: palette.parchment,
                  backgroundColor: palette.panel
                })),
                columns
              )}
            </Box>
          ) : (
            <Box key="project-actions" flexDirection="row" columnGap={1} flexWrap="wrap">
              <Text dimColor>{text.actionsHeading}</Text>
              {actions.map((action) => actionButton(action, hotkeys.get(action.id)))}
            </Box>
          ),
          ...actions.flatMap(resultRows)
        ])
  ]
}
