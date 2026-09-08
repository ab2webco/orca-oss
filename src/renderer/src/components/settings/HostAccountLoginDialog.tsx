import { useCallback, useEffect, useState } from 'react'
import { Copy, ExternalLink, Loader2 } from 'lucide-react'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { translate } from '@/i18n/i18n'
import {
  beginHostAccountLogin,
  cancelHostAccountLogin,
  completeHostAccountLogin,
  type HostLoginAgent,
  type HostLoginStarted
} from '@/runtime/runtime-host-login-client'

type Settings = { activeRuntimeEnvironmentId?: string | null } | null | undefined

export type HostAccountLoginDialogProps = {
  agent: HostLoginAgent | null
  settings: Settings
  serverLabel: string
  onClose: () => void
  onCompleted: () => void
}

/** Drive an agent sign-in that runs on the server, from the client's browser.
 *
 *  Why this exists at all: the account belongs to the machine that runs the
 *  agent, so the sign-in has to happen there. Both providers already support a
 *  browserless flow — Claude redirects to platform.claude.com and asks for the
 *  code back, Codex uses device authorization — so the only missing piece was
 *  carrying the page and the code between the two machines.
 */
export function HostAccountLoginDialog({
  agent,
  settings,
  serverLabel,
  onClose,
  onCompleted
}: HostAccountLoginDialogProps): React.JSX.Element {
  const [session, setSession] = useState<HostLoginStarted | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (agent === null) {
      return
    }
    let cancelled = false
    setSession(null)
    setCode('')
    setError(null)
    setBusy(true)
    void beginHostAccountLogin(settings, agent)
      .then((started) => {
        if (!cancelled) {
          setSession(started)
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setBusy(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [agent, settings])

  const close = useCallback(() => {
    // Why cancel on close: the agent is still running on the server with a
    // temporary credential directory that nothing else will clean up.
    if (session && !busy) {
      void cancelHostAccountLogin(settings, session.sessionId).catch(() => {})
    }
    onClose()
  }, [busy, onClose, session, settings])

  const submit = useCallback(() => {
    if (!session) {
      return
    }
    setBusy(true)
    setError(null)
    void completeHostAccountLogin(settings, session.sessionId, code.trim() || null)
      .then(() => {
        onCompleted()
        onClose()
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => setBusy(false))
  }, [code, onClose, onCompleted, session, settings])

  return (
    <Dialog open={agent !== null} onOpenChange={(open) => (open ? undefined : close())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {translate(
              'auto.components.settings.HostAccountLoginDialog.title',
              'Sign in on {{server}}'
            ).replace('{{server}}', serverLabel)}
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.settings.HostAccountLoginDialog.description',
            'The account is created on the server, not on this computer. Open the page below, sign in, and bring the code back here.'
          )}
        </p>
        {session?.url ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="xs"
                className="gap-1.5"
                onClick={() => window.open(session.url, '_blank', 'noopener')}
              >
                <ExternalLink className="size-3" />
                {translate('auto.components.settings.HostAccountLoginDialog.open', 'Open sign-in page')}
              </Button>
              <Button
                variant="ghost"
                size="xs"
                className="gap-1.5"
                onClick={() => void navigator.clipboard.writeText(session.url)}
              >
                <Copy className="size-3" />
                {translate('auto.components.settings.HostAccountLoginDialog.copyUrl', 'Copy link')}
              </Button>
            </div>
            {session.deviceCode ? (
              <p className="text-xs">
                {translate(
                  'auto.components.settings.HostAccountLoginDialog.deviceCode',
                  'Enter this code on that page:'
                )}{' '}
                <span className="font-mono font-semibold">{session.deviceCode}</span>
              </p>
            ) : null}
          </div>
        ) : null}
        {session && !session.deviceCode ? (
          <div className="space-y-1.5">
            <Label htmlFor="host-login-code">
              {translate('auto.components.settings.HostAccountLoginDialog.codeLabel', 'Code from that page')}
            </Label>
            <Input
              id="host-login-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        ) : null}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={close} disabled={busy}>
            {translate('auto.components.settings.HostAccountLoginDialog.cancel', 'Cancel')}
          </Button>
          <Button
            size="sm"
            className="gap-1.5"
            onClick={submit}
            // Why the device-auth case may submit with an empty field: Codex
            // already took the code in the browser and only needs the go-ahead.
            disabled={busy || !session || (!session.deviceCode && code.trim() === '')}
          >
            {busy ? <Loader2 className="size-3 animate-spin" /> : null}
            {translate('auto.components.settings.HostAccountLoginDialog.finish', 'Finish sign-in')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
