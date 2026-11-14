import { useEffect, useRef, useState } from 'react'
import { Copy, ExternalLink, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { translate } from '@/i18n/i18n'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { ClaudeRateLimitAccountsState } from '../../../../shared/managed-account-types'
import {
  beginClaudeSetupToken,
  cancelClaudeSetupToken,
  getClaudeSetupTokenStatus,
  submitClaudeSetupTokenCode
} from '@/runtime/runtime-claude-setup-token-client'

type Settings = Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null | undefined

type Phase =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'awaiting-code'; sessionId: string; url: string }
  | { kind: 'verifying'; sessionId: string }
  | { kind: 'failed'; error: string }

const POLL_MS = 1_000

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

export type ClaudeSetupTokenGenerateProps = {
  settings: Settings
  accountId: string
  accountLabel: string
  onStored: (accounts: ClaudeRateLimitAccountsState) => void
}

/** Runs `claude setup-token` on the account's host; the token is stored there and never shown. */
export function ClaudeSetupTokenGenerate({
  settings,
  accountId,
  accountLabel,
  onStored
}: ClaudeSetupTokenGenerateProps): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [code, setCode] = useState('')
  const liveSession = useRef<string | null>(null)
  const settingsRef = useRef(settings)
  const onStoredRef = useRef(onStored)
  useEffect(() => {
    settingsRef.current = settings
    onStoredRef.current = onStored
  })

  // Why cancel on unmount: the CLI keeps waiting on the host until its own timeout otherwise.
  useEffect(
    () => () => {
      const sessionId = liveSession.current
      if (sessionId) {
        void cancelClaudeSetupToken(settingsRef.current, sessionId).catch(() => {})
      }
    },
    []
  )

  const verifyingSession = phase.kind === 'verifying' ? phase.sessionId : null
  useEffect(() => {
    if (!verifyingSession) {
      return
    }
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const poll = (): void => {
      void getClaudeSetupTokenStatus(settingsRef.current, verifyingSession)
        .then((status) => {
          if (cancelled) {
            return
          }
          if (status.state === 'stored' && status.accounts) {
            liveSession.current = null
            onStoredRef.current(status.accounts)
            return
          }
          if (status.state === 'failed') {
            liveSession.current = null
            setPhase({ kind: 'failed', error: status.error ?? '' })
            return
          }
          timer = setTimeout(poll, POLL_MS)
        })
        .catch((cause: unknown) => {
          if (!cancelled) {
            liveSession.current = null
            setPhase({ kind: 'failed', error: messageOf(cause) })
          }
        })
    }
    timer = setTimeout(poll, POLL_MS)
    return () => {
      cancelled = true
      if (timer) {
        clearTimeout(timer)
      }
    }
  }, [verifyingSession])

  const start = (): void => {
    setCode('')
    setPhase({ kind: 'starting' })
    void beginClaudeSetupToken(settingsRef.current, accountId)
      .then((started) => {
        liveSession.current = started.sessionId
        setPhase({ kind: 'awaiting-code', ...started })
      })
      .catch((cause: unknown) => setPhase({ kind: 'failed', error: messageOf(cause) }))
  }

  const submit = (): void => {
    if (phase.kind !== 'awaiting-code') {
      return
    }
    const { sessionId } = phase
    setPhase({ kind: 'verifying', sessionId })
    void submitClaudeSetupTokenCode(settingsRef.current, sessionId, code.trim()).catch(
      (cause: unknown) => {
        liveSession.current = null
        setPhase({ kind: 'failed', error: messageOf(cause) })
      }
    )
  }

  if (phase.kind === 'awaiting-code') {
    return (
      <div className="space-y-3">
        <div className="space-y-1.5">
          <p className="text-xs">
            {translate(
              'auto.components.settings.ClaudeSetupTokenGenerate.openStep',
              '1. Open the sign-in page and sign in as {{value0}}.',
              { value0: accountLabel }
            )}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="xs"
              className="gap-1.5"
              onClick={() => window.open(phase.url, '_blank', 'noopener')}
            >
              <ExternalLink className="size-3" />
              {translate(
                'auto.components.settings.ClaudeSetupTokenGenerate.open',
                'Open sign-in page'
              )}
            </Button>
            <Button
              variant="ghost"
              size="xs"
              className="gap-1.5"
              onClick={() => void navigator.clipboard.writeText(phase.url)}
            >
              <Copy className="size-3" />
              {translate('auto.components.settings.ClaudeSetupTokenGenerate.copyUrl', 'Copy link')}
            </Button>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="claude-setup-token-code" className="text-xs font-normal">
            {translate(
              'auto.components.settings.ClaudeSetupTokenGenerate.codeLabel',
              '2. Paste the code the page shows.'
            )}
          </Label>
          <div className="flex gap-2">
            <Input
              id="claude-setup-token-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="min-w-0 text-xs"
            />
            <Button size="sm" onClick={submit} disabled={code.trim() === ''}>
              {translate('auto.components.settings.ClaudeSetupTokenGenerate.finish', 'Finish')}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  const busy = phase.kind === 'starting' || phase.kind === 'verifying'
  return (
    <div className="space-y-2">
      <Button onClick={start} disabled={busy} className="w-full gap-1.5">
        {busy ? <Loader2 className="size-3 animate-spin" /> : null}
        {phase.kind === 'starting'
          ? translate(
              'auto.components.settings.ClaudeSetupTokenGenerate.starting',
              'Starting claude setup-token…'
            )
          : phase.kind === 'verifying'
            ? translate(
                'auto.components.settings.ClaudeSetupTokenGenerate.verifying',
                'Saving the token…'
              )
            : phase.kind === 'failed'
              ? translate('auto.components.settings.ClaudeSetupTokenGenerate.retry', 'Try again')
              : translate(
                  'auto.components.settings.ClaudeSetupTokenGenerate.generate',
                  'Generate token'
                )}
      </Button>
      {phase.kind === 'failed' ? (
        <div role="alert" className="space-y-0.5 text-xs">
          {phase.error ? <p className="break-words text-destructive">{phase.error}</p> : null}
          <p className="text-muted-foreground">
            {translate(
              'auto.components.settings.ClaudeSetupTokenGenerate.unchanged',
              'Nothing changed: the account keeps its current login and token.'
            )}
          </p>
        </div>
      ) : null}
    </div>
  )
}
