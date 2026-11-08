import type { AppState } from '@/store/types'
import { useAppStore } from '@/store'
import { getSettingsForAgentTabRuntimeOwner } from '@/lib/agent-paste-draft'
import {
  sendNativeChatAskAnswer,
  sendNativeChatMessage
} from '../native-chat/native-chat-runtime-send'
import { inferQuestionAnsweredFromCurrentStatus } from '../terminal-pane/agent-question-answered-inference'
import {
  findTerminalHandleTarget,
  type TerminalHandleFocusState
} from '../terminal-pane/terminal-handle-links'
import {
  buildAskAnswerKeys,
  buildCodexAskAnswerKeys,
  formatAskAnswer,
  parseAskFromStatus
} from '../../../../shared/native-chat-ask'
import {
  resolveNativeChatTranscriptAgent,
  shouldStepNativeChatAskAnswer
} from '../../../../shared/native-chat-agent-support'
import { parsePaneKey } from '../../../../shared/stable-pane-id'
import { teamLiveActionOfEntry } from '../../../../shared/team-panel-activity-rows'
import type {
  TeamPanelGameModel,
  TeamPanelModel,
  TeamSessionRef
} from '../../../../shared/team-panel-model-types'
import { openTeamSession } from './team-session-open'

/** An agent session blocked on a question to the user, as its AgentStatusEntry reports it. */
export type TeamInboxAgentQuestion = TeamSessionRef & {
  repoName: string
  worktreeName: string
  text: string
  options: string[]
}

export type TeamInboxAgentState = TerminalHandleFocusState & Pick<AppState, 'agentStatusByPaneKey'>

/** This window's pane key for the lead; a paired host names its pane under its own tab id. */
function localLeadPaneKey(
  lead: TeamPanelGameModel['lead'],
  state: TerminalHandleFocusState
): string {
  if (lead.host.kind !== 'remote' || !lead.host.environmentId || !lead.terminalHandle) {
    return lead.paneKey
  }
  const target = findTerminalHandleTarget(lead.terminalHandle, state, lead.host.environmentId)
  return target?.leafId ? `${target.tabId}:${target.leafId}` : lead.paneKey
}

/** The lead's own live question; game.state never carries it, so agent status does. */
export function teamLeadQuestionOf(
  model: TeamPanelGameModel,
  state: TeamInboxAgentState
): TeamInboxAgentQuestion | null {
  const { lead } = model
  const paneKey = localLeadPaneKey(lead, state)
  const entry = state.agentStatusByPaneKey[paneKey]
  const action = entry ? teamLiveActionOfEntry(entry) : null
  return action?.kind === 'question'
    ? {
        paneKey,
        terminalHandle: lead.terminalHandle,
        worktreeId: lead.worktreeId,
        host: lead.host,
        repoName: model.projectName,
        worktreeName: lead.name,
        text: action.text,
        options: action.options
      }
    : null
}

/**
 * With no team, every session's live question except a team's, which belongs to its own Inbox.
 * With a team, the lead's; members ask the lead, and their prompts stay on their cards.
 */
export function teamInboxAgentQuestionsOf(
  model: TeamPanelModel,
  state: TeamInboxAgentState
): TeamInboxAgentQuestion[] {
  if (model.kind !== 'solo') {
    const lead = teamLeadQuestionOf(model, state)
    return lead ? [lead] : []
  }
  return model.rows.flatMap((row) =>
    row.liveAction?.kind === 'question' && !row.inTeam
      ? [
          {
            paneKey: row.paneKey,
            terminalHandle: row.terminalHandle,
            worktreeId: row.worktreeId,
            host: row.host,
            repoName: row.repoName,
            worktreeName: row.worktreeName,
            text: row.liveAction.text,
            options: row.liveAction.options
          }
        ]
      : []
  )
}

export function openTeamInboxAgent(question: TeamInboxAgentQuestion): void {
  void openTeamSession(question, question.worktreeName)
}

/** Whether one tap can answer: a single, single-choice question with options. */
export function isOneTapQuestion(question: TeamInboxAgentQuestion): boolean {
  const entry = useAppStore.getState().agentStatusByPaneKey[question.paneKey]
  const ask = entry ? parseAskFromStatus(entry.interactivePrompt, entry.toolName) : null
  return (
    ask?.questions.length === 1 &&
    ask.questions[0].multiSelect !== true &&
    ask.questions[0].options.length > 0
  )
}

/**
 * Answers the pane's live question with one option, through the keystrokes the chat card writes.
 * False when the pane has no PTY in this window or its question changed.
 */
export function answerTeamInboxAgent(
  question: TeamInboxAgentQuestion,
  optionIndex: number
): boolean {
  const state = useAppStore.getState()
  const pane = parsePaneKey(question.paneKey)
  const entry = state.agentStatusByPaneKey[question.paneKey]
  const ask = entry ? parseAskFromStatus(entry.interactivePrompt, entry.toolName) : null
  const ptyId = pane
    ? (state.terminalLayoutsByTabId[pane.tabId]?.ptyIdsByLeafId?.[pane.leafId] ?? null)
    : null
  // Why the text: a new question may have replaced the one on screen since it rendered.
  if (!pane || !entry || !ask || !ptyId || ask.questions[0]?.question !== question.text) {
    return false
  }
  const settings = getSettingsForAgentTabRuntimeOwner(pane.tabId)
  const selections = [{ indices: [optionIndex] }]
  if (!shouldStepNativeChatAskAnswer(entry.agentType)) {
    sendNativeChatMessage(settings, ptyId, formatAskAnswer(ask, selections))
    return true
  }
  const keys =
    resolveNativeChatTranscriptAgent(entry.agentType) === 'codex'
      ? buildCodexAskAnswerKeys(ask, selections)
      : buildAskAnswerKeys(ask, selections)
  sendNativeChatAskAnswer(settings, ptyId, keys, (delivered) => {
    if (delivered) {
      inferQuestionAnsweredFromCurrentStatus({
        paneKey: question.paneKey,
        getStatusEntry: () => entry,
        inferQuestionAnswered: (request) =>
          window.api.agentStatus.inferQuestionAnswered(request).catch(() => false)
      })
    }
  })
  return true
}
