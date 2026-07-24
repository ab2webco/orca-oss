import { useId, useLayoutEffect, useState } from 'react'
import { LoaderCircle, Lock } from 'lucide-react'
import { useAppStore } from '@/store'
import { useMountedRef } from '@/hooks/useMountedRef'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { hasRemoteProviderRuntime } from '@/lib/provider-runtime-context'
import { translate } from '@/i18n/i18n'

type PlaneConnectDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConnected?: () => void
  overlayClassName?: string
  contentClassName?: string
}

type ConnectState = 'idle' | 'connecting' | 'error'

// Why: mirrors JiraConnectDialog's shape so the settings card and the
// feature-wall onboarding step reuse the same connect flow. Also doubles as
// the "Add workspace" dialog — a Plane Personal Access Token is account-level
// and reusable across workspaces, so submitting an existing key with a new
// baseUrl/workspaceSlug must succeed instead of being rejected as a duplicate
// (see mem #2169 correction to the original spec).
export function PlaneConnectDialog({
  open,
  onOpenChange,
  onConnected,
  overlayClassName,
  contentClassName
}: PlaneConnectDialogProps): React.JSX.Element {
  const connectPlane = useAppStore((s) => s.connectPlane)
  const settings = useAppStore((s) => s.settings)
  const mountedRef = useMountedRef()
  const baseUrlId = useId()
  const workspaceSlugId = useId()
  const apiKeyId = useId()
  const errorId = useId()

  const [baseUrl, setBaseUrl] = useState('')
  const [workspaceSlug, setWorkspaceSlug] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [connectState, setConnectState] = useState<ConnectState>('idle')
  const [connectError, setConnectError] = useState<string | null>(null)

  // Start every open with a clean slate so a previously-typed secret or a
  // stale error can't linger across reopens (e.g. "Add workspace" right after
  // a failed attempt). Runs before paint so nothing stale renders for a frame.
  useLayoutEffect(() => {
    if (!open) {
      return
    }
    setBaseUrl('')
    setWorkspaceSlug('')
    setApiKey('')
    setConnectState('idle')
    setConnectError(null)
  }, [open])

  const canSubmit =
    Boolean(baseUrl.trim()) &&
    Boolean(workspaceSlug.trim()) &&
    Boolean(apiKey.trim()) &&
    connectState !== 'connecting'
  const credentialStorageCopy = hasRemoteProviderRuntime(settings)
    ? translate(
        'auto.components.plane.connect.dialog.storage_remote',
        'Your token is sent to the selected remote runtime and stored there with runtime-supported encryption.'
      )
    : translate(
        'auto.components.plane.connect.dialog.storage_local',
        'Your token is stored locally and encrypted when local runtime storage supports it.'
      )

  const clearErrorOnEdit = (): void => {
    if (connectState === 'error') {
      setConnectState('idle')
      setConnectError(null)
    }
  }

  const handleOpenChange = (nextOpen: boolean): void => {
    if (connectState !== 'connecting') {
      onOpenChange(nextOpen)
    }
  }

  const handleConnect = async (): Promise<void> => {
    const trimmedBaseUrl = baseUrl.trim()
    const trimmedWorkspaceSlug = workspaceSlug.trim()
    const trimmedApiKey = apiKey.trim()
    if (
      !trimmedBaseUrl ||
      !trimmedWorkspaceSlug ||
      !trimmedApiKey ||
      connectState === 'connecting'
    ) {
      return
    }
    setConnectState('connecting')
    setConnectError(null)
    try {
      const result = await connectPlane({
        baseUrl: trimmedBaseUrl,
        workspaceSlug: trimmedWorkspaceSlug,
        apiKey: trimmedApiKey
      })
      if (!mountedRef.current) {
        return
      }
      if (result.ok) {
        setBaseUrl('')
        setWorkspaceSlug('')
        setApiKey('')
        setConnectState('idle')
        onOpenChange(false)
        onConnected?.()
        return
      }
      setConnectState('error')
      setConnectError(result.error)
    } catch (error) {
      if (mountedRef.current) {
        setConnectState('error')
        setConnectError(
          error instanceof Error
            ? error.message
            : translate(
                'auto.components.plane.connect.dialog.connection_failed',
                'Connection failed'
              )
        )
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        overlayClassName={overlayClassName}
        className={cn('sm:max-w-md', contentClassName)}
      >
        <DialogHeader className="gap-3">
          <DialogTitle className="leading-tight">
            {translate('auto.components.plane.connect.dialog.title', 'Connect Plane workspace')}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.plane.connect.dialog.description',
              'Use your Plane instance URL, workspace slug, and a personal access token to browse work items. The same token can be reused to add more workspaces.'
            )}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void handleConnect()
          }}
        >
          <div className="flex flex-col gap-3">
            <div className="space-y-2">
              <Label htmlFor={baseUrlId} className="text-xs">
                {translate('auto.components.plane.connect.dialog.base_url_label', 'Plane base URL')}
              </Label>
              <Input
                id={baseUrlId}
                autoFocus
                placeholder={translate(
                  'auto.components.plane.connect.dialog.base_url_placeholder',
                  'https://api.plane.so'
                )}
                value={baseUrl}
                onChange={(event) => {
                  setBaseUrl(event.target.value)
                  clearErrorOnEdit()
                }}
                disabled={connectState === 'connecting'}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={workspaceSlugId} className="text-xs">
                {translate(
                  'auto.components.plane.connect.dialog.workspace_slug_label',
                  'Workspace slug'
                )}
              </Label>
              <Input
                id={workspaceSlugId}
                placeholder={translate(
                  'auto.components.plane.connect.dialog.workspace_slug_placeholder',
                  'my-workspace'
                )}
                value={workspaceSlug}
                onChange={(event) => {
                  setWorkspaceSlug(event.target.value)
                  clearErrorOnEdit()
                }}
                disabled={connectState === 'connecting'}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={apiKeyId} className="text-xs">
                {translate(
                  'auto.components.plane.connect.dialog.api_key_label',
                  'Personal access token'
                )}
              </Label>
              <Input
                id={apiKeyId}
                type="password"
                placeholder={translate(
                  'auto.components.plane.connect.dialog.api_key_placeholder',
                  'Plane personal access token'
                )}
                value={apiKey}
                onChange={(event) => {
                  setApiKey(event.target.value)
                  clearErrorOnEdit()
                }}
                disabled={connectState === 'connecting'}
                aria-invalid={connectState === 'error'}
                aria-describedby={connectState === 'error' ? errorId : undefined}
              />
            </div>
            {connectState === 'error' && connectError ? (
              <p id={errorId} className="text-xs text-destructive">
                {connectError}
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              {translate(
                'auto.components.plane.connect.dialog.pat_hint',
                'Create a personal access token from your Plane profile settings.'
              )}{' '}
              <button
                type="button"
                className="text-primary underline-offset-2 hover:underline"
                onClick={() => window.api.shell.openUrl('https://app.plane.so/profile/security')}
              >
                {translate(
                  'auto.components.plane.connect.dialog.pat_link',
                  'Plane personal access tokens'
                )}
              </button>
              .
            </p>
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
              <Lock className="size-3 shrink-0" />
              {credentialStorageCopy}
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={connectState === 'connecting'}
            >
              {translate('auto.components.plane.connect.dialog.cancel', 'Cancel')}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {connectState === 'connecting' ? (
                <>
                  <LoaderCircle className="size-4 animate-spin" />
                  {translate('auto.components.plane.connect.dialog.verifying', 'Verifying…')}
                </>
              ) : (
                translate('auto.components.plane.connect.dialog.connect', 'Connect')
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
