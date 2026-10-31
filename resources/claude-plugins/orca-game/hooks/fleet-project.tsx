import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'

import type {
  ActionRuns,
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
import type { PanelSection } from './panel-layout'
import { metricsSectionOf } from './metrics-section'
import { tapButtonsOf } from './tap-buttons'
import { isTapLayout } from './tap-layout'
import { todoDrawnCountOf, todoSectionsOf } from './todo-sections'

const TONE_COLORS: Readonly<Record<GameLinkTone, string>> = {
  danger: 'red',
  pending: 'yellow',
  success: 'green',
  neutral: 'white'
}

/** Draws a section's ▾/▸ mark and says whether the person collapsed it. */
export type SectionMarks = {
  markOf: (section: PanelSection) => RenderElement
  isCollapsed: (section: PanelSection) => boolean
}

export type ProjectSections = Partial<
  Record<'reviews' | 'todo' | 'actions' | 'metrics', RenderElement>
>

/** My PRs, my To Do grouped by status, the project's actions with each MCP one's last result, and Metrics. */
export async function projectRowsOf(
  $: EngineInterface,
  e: RenderInput,
  state: GameState,
  palette: BandPalette,
  isDemo: boolean,
  columns: number,
  marks: SectionMarks,
  isShown: (section: PanelSection) => boolean
): Promise<ProjectSections> {
  const { Box, Text, Button } = $.ui.resolve(e)
  const worktreeId = state.worktree?.id ?? ''
  const text = gameStrings().text
  // Why: a closed Actions widget reads no run log.
  const runs: ActionRuns = isShown('actions') ? await actionRunsOf($) : {}
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
  const listRows = (
    section: 'reviews' | 'todo',
    heading: string,
    list: GameProjectList,
    action?: GameAction
  ) => {
    const key = `project-${section}`
    const sections = todoSectionsOf(list)
    const isCollapsed = marks.isCollapsed(section)
    return (
      <Box key={key} flexDirection="column">
        <Box key={`layout-header-${section}`} flexDirection="row">
          {marks.markOf(section)}
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
        </Box>
        {!isCollapsed &&
          sections.flatMap((group, at) => [
            ...(group.heading === null
              ? []
              : [
                  <Text key={`${key}-heading-${at}`} dimColor bold>
                    {`${text.todoHeadings[group.heading]}${group.count === undefined ? '' : ` ${group.count}`}`}
                  </Text>
                ]),
            ...group.items.map((one) => itemRow(key, one))
          ])}
        {!isCollapsed && list.total > todoDrawnCountOf(sections) && (
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
  const actionsRow = isTapLayout(columns) ? (
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
  )
  const isActionsCollapsed = marks.isCollapsed('actions')
  return {
    ...(reviews === null || !isShown('reviews')
      ? {}
      : {
          reviews: listRows(
            'reviews',
            text.myReviews(reviewKindOf(reviews), reviews.total),
            reviews,
            listActionOf(state, 'reviews')
          )
        }),
    ...(todo === null || !isShown('todo')
      ? {}
      : { todo: listRows('todo', text.todo(todo.total), todo, listActionOf(state, 'todo')) }),
    ...(actions.length === 0 || !isShown('actions')
      ? {}
      : {
          actions: (
            <Box key="project-actions-section" flexDirection="column">
              <Box key="layout-header-actions" flexDirection="row">
                {marks.markOf('actions')}
                {isActionsCollapsed ? (
                  <Text dimColor>{`${text.actionsHeading} ${actions.length}`}</Text>
                ) : (
                  actionsRow
                )}
              </Box>
              {!isActionsCollapsed && actions.flatMap(resultRows)}
            </Box>
          )
        }),
    ...(isShown('metrics')
      ? { metrics: metricsSectionOf($, e, state, palette, columns, marks) }
      : {})
  }
}
