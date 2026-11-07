import type { NotificationDispatchRequest } from '../../shared/notification-settings-types'
import { translateMain } from '../i18n/main-i18n'

const NOTIFICATION_AGENT_LABEL_MAX_LENGTH = 40
const NOTIFICATION_TITLE_CONTEXT_MAX_LENGTH = 80
const NOTIFICATION_BODY_PREVIEW_MAX_LENGTH = 180

const AGENT_TYPE_LABELS: Readonly<Record<string, string>> = {
  claude: 'Claude',
  openclaude: 'OpenClaude',
  'claude-zai': 'Claude GLM (z.ai)',
  codex: 'Codex',
  gemini: 'Gemini',
  antigravity: 'Antigravity',
  opencode: 'OpenCode',
  cursor: 'Cursor',
  aider: 'Aider',
  pi: 'Pi',
  omp: 'OMP',
  droid: 'Droid',
  grok: 'Grok',
  hermes: 'Hermes'
}

export function buildNotificationOptions(args: NotificationDispatchRequest): {
  title: string
  body: string
  silent?: boolean
  sound?: string
} {
  if (args.source === 'terminal-bell') {
    return {
      title: translateMain('agentNotification.bellTitle', 'Bell in {{workspace}}', {
        workspace: args.worktreeLabel ?? workspaceWord()
      }),
      body: args.repoLabel
        ? `${args.repoLabel} · ${translateMain('agentNotification.attentionRequested', 'Attention requested')}`
        : translateMain('agentNotification.attentionRequested', 'Attention requested')
    }
  }

  if (args.source === 'game-owner-question') {
    const project = normalizeNotificationText(args.repoLabel, NOTIFICATION_TITLE_CONTEXT_MAX_LENGTH)
    return {
      title: project
        ? translateMain('agentNotification.leadAsksProject', '{{project}}: the lead asks you', {
            project
          })
        : translateMain('agentNotification.leadAsks', 'The lead asks you'),
      body:
        normalizeNotificationText(args.ownerQuestion, NOTIFICATION_BODY_PREVIEW_MAX_LENGTH) ||
        translateMain('agentNotification.openInbox', 'Open the Inbox to answer.')
    }
  }

  if (args.source === 'test') {
    return {
      title: translateMain('agentNotification.testTitle', 'Orca Lab notifications are on'),
      body: translateMain(
        'agentNotification.testBody',
        'This is a test notification from Orca Lab.'
      )
    }
  }

  const richOptions = buildAgentTaskCompleteNotificationOptions(args)
  if (richOptions) {
    return richOptions
  }

  return buildAgentTaskCompleteFallbackNotificationOptions(args)
}

function buildAgentTaskCompleteNotificationOptions(
  args: NotificationDispatchRequest
): { title: string; body: string } | null {
  if (!hasAgentNotificationSnapshot(args)) {
    return null
  }

  const agentLabel = formatNotificationAgentLabel(args.agentType)
  const worktreeContext = formatNotificationWorktreeContext(args)
  const status =
    args.agentState === 'blocked' || args.agentState === 'waiting'
      ? { key: 'needsInput', fallback: '{{agent}} needs input' }
      : args.agentState === 'done' && args.agentInterrupted
        ? { key: 'stopped', fallback: '{{agent}} stopped' }
        : { key: 'finished', fallback: '{{agent}} finished' }
  const statusText = translateMain(`agentNotification.${status.key}`, status.fallback, {
    agent: agentLabel
  })

  return {
    title: `${worktreeContext} - ${statusText}`,
    body: buildAgentTaskCompleteRichBody(args) ?? `${statusText}.`
  }
}

function formatNotificationWorktreeContext(args: NotificationDispatchRequest): string {
  const worktreeLabel = normalizeNotificationText(
    args.worktreeLabel,
    NOTIFICATION_TITLE_CONTEXT_MAX_LENGTH
  )
  const repoLabel = normalizeNotificationText(args.repoLabel, NOTIFICATION_TITLE_CONTEXT_MAX_LENGTH)
  if (args.hasMultipleActiveRepos && repoLabel && worktreeLabel) {
    return normalizeNotificationText(
      `${repoLabel} / ${worktreeLabel}`,
      NOTIFICATION_TITLE_CONTEXT_MAX_LENGTH
    )
  }
  return worktreeLabel || repoLabel || workspaceWord()
}

function hasAgentNotificationSnapshot(args: NotificationDispatchRequest): boolean {
  return Boolean(
    args.agentType ||
    args.agentState ||
    args.agentPrompt ||
    args.agentToolName ||
    args.agentToolInput ||
    args.agentLastAssistantMessage ||
    args.agentInterrupted
  )
}

function buildAgentTaskCompleteRichBody(args: NotificationDispatchRequest): string | null {
  const assistantMessage = normalizeNotificationText(
    args.agentLastAssistantMessage,
    NOTIFICATION_BODY_PREVIEW_MAX_LENGTH
  )
  if (assistantMessage) {
    return assistantMessage
  }

  const toolName = normalizeNotificationText(args.agentToolName, 60)
  const toolInput = normalizeNotificationText(
    args.agentToolInput,
    NOTIFICATION_BODY_PREVIEW_MAX_LENGTH
  )
  if (toolName && toolInput) {
    return translateMain('agentNotification.usingToolWithInput', 'Using {{tool}}: {{input}}', {
      tool: toolName,
      input: toolInput
    })
  }
  if (toolName) {
    return translateMain('agentNotification.usingTool', 'Using {{tool}}', { tool: toolName })
  }
  if (toolInput) {
    return translateMain('agentNotification.toolInput', 'Tool input: {{input}}', {
      input: toolInput
    })
  }

  return null
}

function buildAgentTaskCompleteFallbackNotificationOptions(args: NotificationDispatchRequest): {
  title: string
  body: string
} {
  return {
    title: translateMain('agentNotification.taskComplete', 'Task complete in {{workspace}}', {
      workspace: args.worktreeLabel ?? workspaceWord()
    }),
    body: buildAgentTaskCompleteFallbackBody(args)
  }
}

function buildAgentTaskCompleteFallbackBody(args: NotificationDispatchRequest): string {
  return args.repoLabel
    ? `${args.repoLabel}${args.terminalTitle ? ` · ${args.terminalTitle}` : ''}`
    : (args.terminalTitle ??
        translateMain('agentNotification.agentFinished', 'A coding agent finished working.'))
}

function formatNotificationAgentLabel(agentType: string | null | undefined): string {
  const normalized = normalizeNotificationText(agentType, NOTIFICATION_AGENT_LABEL_MAX_LENGTH)
  if (!normalized || normalized === 'unknown') {
    return translateMain('agentNotification.agent', 'Agent')
  }
  return AGENT_TYPE_LABELS[normalized] ?? normalized
}

function normalizeNotificationText(value: string | null | undefined, maxLength: number): string {
  const normalized = value?.replace(/\s+/g, ' ').trim() ?? ''
  if (normalized.length <= maxLength) {
    return normalized
  }
  const truncated = normalized.slice(0, maxLength - 1)
  const lastCode = truncated.charCodeAt(truncated.length - 1)
  const safeTruncated =
    lastCode >= 0xd800 && lastCode <= 0xdbff ? truncated.slice(0, -1) : truncated
  return `${safeTruncated}…`
}

function workspaceWord(): string {
  return translateMain('agentNotification.workspace', 'workspace')
}
