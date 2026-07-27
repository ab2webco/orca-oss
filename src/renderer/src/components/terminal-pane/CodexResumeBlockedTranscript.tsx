import { ShieldCheck } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import type { AgentProviderSessionMetadata } from '../../../../shared/agent-session-resume'
import { useNativeChatLiveSession } from '../native-chat/use-native-chat-live-session'
import { selectNativeChatViewState } from '../native-chat/native-chat-view-state'
import { NativeChatMessageList } from '../native-chat/NativeChatMessageList'
import { NativeChatEmptyState } from '../native-chat/NativeChatEmptyState'

/**
 * Read-only fallback for a Codex resume the account-isolation guard refused:
 * the conversation is safe on disk, so show it instead of a blank pane. Renders
 * no composer and never resumes — display only (ORCA-61).
 */
export function CodexResumeBlockedTranscript({
  paneKey,
  providerSession
}: {
  paneKey: string
  providerSession: AgentProviderSessionMetadata
}): React.JSX.Element {
  const session = useNativeChatLiveSession({
    paneKey,
    agent: 'codex',
    sessionId: providerSession.id,
    transcriptPath: providerSession.transcriptPath ?? null,
    runtimeEnvironmentId: null
  })
  const viewState = selectNativeChatViewState(session)
  return (
    <div className="absolute inset-0 z-10 flex min-h-0 min-w-0 flex-col bg-background">
      <div className="flex items-start gap-3 border-b border-border bg-muted/50 px-4 py-3">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium text-foreground">
            {translate(
              'components.terminal-pane.codex-resume-blocked.title',
              'Your conversation is safe and shown below'
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {translate(
              'components.terminal-pane.codex-resume-blocked.subtitle',
              'Orca paused automatic resume because it could not confirm this Codex session belongs to the selected account. The transcript below is read-only — nothing was sent or lost. To keep working, start a new Codex session or switch to the account that owns this one.'
            )}
          </p>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {viewState.kind === 'loading' ? (
          <NativeChatEmptyState kind="loading" />
        ) : viewState.kind === 'error' ? (
          <NativeChatEmptyState
            kind="error"
            message={translate(
              'components.terminal-pane.codex-resume-blocked.read-error',
              'Orca could not read the saved session file either. It may have been moved or deleted; automatic resume stayed paused and nothing was sent.'
            )}
          />
        ) : viewState.kind === 'empty' ? (
          <NativeChatEmptyState
            kind="error"
            message={translate(
              'components.terminal-pane.codex-resume-blocked.read-empty',
              'The saved session file was found but contains no readable messages.'
            )}
          />
        ) : (
          <NativeChatMessageList
            session={session}
            isWorking={false}
            expandSignal={false}
            fontScale={1}
          />
        )}
      </div>
    </div>
  )
}
