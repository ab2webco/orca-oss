import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'

import type {
  GameAction,
  GameLinkTone,
  GameProjectItem,
  GameProjectList,
  GameState
} from '../types'
import { ACTION_HOTKEYS } from './action-results'
import { reviewKindOf } from './band-chips'
import { actionRunsOf, mcpCallTextOf, runAction, workOn } from './game-actions'
import { gameStrings } from './game-strings'
import type { BandPalette } from './scenes/scene-definition'
import { todoSectionsOf } from './todo-sections'

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
  isDemo: boolean
): Promise<RenderElement[]> {
  const { Box, Text, Button, Link } = $.ui.resolve(e)
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
        <Link href={one.url}>
          <Text color={TONE_COLORS[one.tone ?? 'neutral']} underline>
            {one.id}
          </Text>
        </Link>
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
  const listRows = (key: string, heading: string, list: GameProjectList) => (
    <Box key={key} flexDirection="column">
      <Box flexDirection="row" gap={1}>
        {list.url === null ? (
          <Text bold>{heading}</Text>
        ) : (
          <Link href={list.url}>
            <Text bold underline>
              {heading}
            </Text>
          </Link>
        )}
      </Box>
      {todoSectionsOf(list).flatMap((section, at) => [
        ...(section.heading === null
          ? []
          : [
              <Text key={`${key}-heading-${at}`} dimColor bold>
                {`${text.todoHeadings[section.heading]}${section.count === undefined ? '' : ` ${section.count}`}`}
              </Text>
            ]),
        ...section.items.map((one) => itemRow(key, one))
      ])}
      {list.total > list.items.length && (
        <Text dimColor>{text.moreAllies(list.total - list.items.length)}</Text>
      )}
    </Box>
  )
  const actionButton = (action: GameAction, index: number) => {
    const hotkey = ACTION_HOTKEYS[index]
    return (
      <Button
        key={`action-${action.id}`}
        plain
        hotkey={hotkey}
        onPress={() => void runAction($, action, isDemo).catch(() => undefined)}
      >
        <Text backgroundColor={palette.panel} color={palette.parchment}>
          {' '}
          {hotkey !== undefined && (
            <Text color={palette.gold} bold>
              {`${hotkey} `}
            </Text>
          )}
          {`${action.label} `}
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
          {run.status === 'running' ? `${action.label} · ${text.actionRunning}` : action.label}
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
  return [
    ...(reviews === null
      ? []
      : [
          listRows('project-reviews', text.myReviews(reviewKindOf(reviews), reviews.total), reviews)
        ]),
    ...(todo === null ? [] : [listRows('project-todo', text.todo(todo.total), todo)]),
    ...(actions.length === 0
      ? []
      : [
          <Box key="project-actions" flexDirection="row" gap={1} flexWrap="wrap">
            <Text dimColor>{text.actionsHeading}</Text>
            {actions.map(actionButton)}
          </Box>,
          ...actions.flatMap(resultRows)
        ])
  ]
}
