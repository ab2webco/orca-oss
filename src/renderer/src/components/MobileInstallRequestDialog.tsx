import type React from 'react'
import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import type { MobileInstallRequestState } from '../../../shared/remote-server-update'

function secondsLeft(deadlineAt: number, now: number): number {
  return Math.max(0, Math.ceil((deadlineAt - now) / 1000))
}

function useMobileInstallRequest(): MobileInstallRequestState | null {
  const [request, setRequest] = useState<MobileInstallRequestState | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.api.updater.getMobileInstallRequest().then((current) => {
      if (!cancelled) {
        setRequest((latest) => latest ?? current)
      }
    })
    const unsubscribe = window.api.updater.onMobileInstallRequest(setRequest)
    // Why: main asks the window to restart so dirty editors are backed up before the quit.
    const unsubscribeRestart = window.api.updater.onMobileInstallRestart(() => {
      void window.api.updater.quitAndInstall().catch(console.error)
    })
    return () => {
      cancelled = true
      unsubscribe()
      unsubscribeRestart()
    }
  }, [])

  return request
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) {
      return
    }
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  return now
}

export function MobileInstallRequestDialog(): React.JSX.Element | null {
  const request = useMobileInstallRequest()
  const status = useAppStore((state) => state.updateStatus)
  const now = useNow(request?.phase === 'countdown')

  if (!request) {
    return null
  }

  const version = 'version' in status && status.version ? status.version : null
  const cancel = (): void => {
    void window.api.updater.cancelMobileInstall(request.requestId).catch(console.error)
  }
  const restartNow = (): void => {
    void window.api.updater.restartMobileInstallNow(request.requestId).catch(console.error)
  }
  const downloading = request.phase === 'downloading' || request.deadlineAt === null

  return (
    <Dialog
      open
      // Why: closing the dialog any other way must not leave a hidden countdown that restarts the app.
      onOpenChange={(open) => {
        if (!open) {
          cancel()
        }
      }}
    >
      <DialogContent
        showCloseButton={false}
        onInteractOutside={(event) => event.preventDefault()}
        className="sm:max-w-md"
      >
        <DialogHeader>
          <DialogTitle>
            {translate(
              'auto.components.MobileInstallRequestDialog.title',
              '{{value0}} asked to update Orca Lab',
              { value0: request.deviceName }
            )}
          </DialogTitle>
          <DialogDescription>
            {downloading
              ? translate(
                  'auto.components.MobileInstallRequestDialog.downloading',
                  'Downloading the update. A countdown you can cancel starts when it is ready.'
                )
              : translate(
                  'auto.components.MobileInstallRequestDialog.countdown',
                  'Orca Lab restarts to install {{value0}} in {{value1}}s. Save your work, or cancel to stay on this version.',
                  {
                    value0:
                      version ??
                      translate(
                        'auto.components.MobileInstallRequestDialog.theUpdate',
                        'the update'
                      ),
                    value1: secondsLeft(request.deadlineAt ?? now, now)
                  }
                )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" autoFocus onClick={cancel}>
            {translate('auto.components.MobileInstallRequestDialog.cancel', 'Cancel')}
          </Button>
          {downloading ? (
            <Loader2 className="size-4 animate-spin self-center text-muted-foreground" />
          ) : (
            <Button type="button" onClick={restartNow}>
              {translate('auto.components.MobileInstallRequestDialog.restartNow', 'Restart now')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
