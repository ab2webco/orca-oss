import { useState } from 'react'
import { AlertCircle, CheckCircle2, LoaderCircle, Unlink } from 'lucide-react'
import { PlaneConnectDialog } from '@/components/plane-connect-dialog'
import { PlaneIcon } from '@/components/icons/PlaneIcon'
import { Button } from '@/components/ui/button'
import { useMountedRef } from '@/hooks/useMountedRef'
import { getProviderRuntimeContextKey } from '@/lib/provider-runtime-context'
import { useAppStore } from '@/store'
import { IntegrationCardDetails, IntegrationCardShell } from './integration-card-shell'
import { useIntegrationSubordinateRowClass } from './integration-card-presentation'
import { getProviderAccountScope } from './provider-account-scope'
import { ProviderHostScopeControl } from './ProviderHostScopeControl'
import { PlaneBoardSelector } from './plane-board-selector'
import { translate } from '@/i18n/i18n'

type VerificationResult = { state: 'ok' | 'error'; error?: string }

export function PlaneIntegrationCard(): React.JSX.Element {
  const planeStatus = useAppStore((s) => s.planeStatus)
  const planeStatusChecked = useAppStore((s) => s.planeStatusChecked)
  const planeStatusContextKey = useAppStore((s) => s.planeStatusContextKey)
  const checkPlaneConnection = useAppStore((s) => s.checkPlaneConnection)
  const disconnectPlane = useAppStore((s) => s.disconnectPlane)
  const testPlaneConnection = useAppStore((s) => s.testPlaneConnection)
  const settings = useAppStore((s) => s.settings)
  const mountedRef = useMountedRef()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [testingWorkspaceId, setTestingWorkspaceId] = useState<string | null>(null)
  const [testResultByWorkspace, setTestResultByWorkspace] = useState<
    Record<string, VerificationResult>
  >({})

  // Why: checking also covers a remote-environment switch mid-flight, so the
  // action row (and any per-workspace Test/Unlink button) hides rather than
  // acting on the previous runtime's stale connection status.
  const contextMatches = planeStatusContextKey === getProviderRuntimeContextKey(settings)
  const checking = !contextMatches || !planeStatusChecked
  const connected = contextMatches && planeStatus.connected
  const workspaces = planeStatus.workspaces ?? []
  const accountScope = getProviderAccountScope(settings)
  const subordinateRowClass = useIntegrationSubordinateRowClass('flex items-center gap-3')
  const accountScopeRowClass = useIntegrationSubordinateRowClass('text-xs')

  const handleDisconnect = async (workspaceId?: string): Promise<void> => {
    await disconnectPlane(workspaceId)
    if (mountedRef.current) {
      setTestResultByWorkspace({})
    }
  }

  const handleTest = async (workspaceId: string): Promise<void> => {
    setTestingWorkspaceId(workspaceId)
    setTestResultByWorkspace((prev) => {
      const next = { ...prev }
      delete next[workspaceId]
      return next
    })
    const result = await testPlaneConnection(workspaceId)
    if (!mountedRef.current) {
      return
    }
    setTestResultByWorkspace((prev) => ({
      ...prev,
      [workspaceId]: result.ok ? { state: 'ok' } : { state: 'error', error: result.error }
    }))
    setTestingWorkspaceId(null)
  }

  return (
    <IntegrationCardShell
      icon={<PlaneIcon className="size-5" />}
      name="Plane"
      description={
        connected
          ? translate(
              'auto.components.settings.plane.integration.card.workspace_count',
              '{{value0}} workspace{{value1}} connected',
              { value0: workspaces.length, value1: workspaces.length === 1 ? '' : 's' }
            )
          : checking
            ? translate(
                'auto.components.settings.plane.integration.card.checking',
                'Checking Plane access before showing setup actions.'
              )
            : translate(
                'auto.components.settings.plane.integration.card.not_connected',
                'Add Plane access to browse and launch from work items.'
              )
      }
      checking={checking}
      statusTone={connected ? 'connected' : 'attention'}
      statusLabel={
        connected
          ? translate(
              'auto.components.settings.plane.integration.card.connected_label',
              'Connected'
            )
          : translate(
              'auto.components.settings.plane.integration.card.not_connected_label',
              'Not connected'
            )
      }
      actions={
        !checking ? (
          <Button
            variant={connected ? 'outline' : 'default'}
            size="sm"
            onClick={() => setDialogOpen(true)}
          >
            {connected
              ? translate(
                  'auto.components.settings.plane.integration.card.add_workspace',
                  'Add workspace'
                )
              : translate(
                  'auto.components.settings.plane.integration.card.connect',
                  'Connect Plane'
                )}
          </Button>
        ) : null
      }
    >
      <IntegrationCardDetails>
        <ProviderHostScopeControl
          labelPrefix={translate(
            'auto.components.settings.plane.integration.card.account_scope_prefix',
            'Account scope'
          )}
          scope={accountScope}
          className={accountScopeRowClass}
        />
        {connected && workspaces.length > 0 ? (
          <div className="space-y-2">
            {workspaces.map((workspace) => {
              const testResult = testResultByWorkspace[workspace.id]
              const testing = testingWorkspaceId === workspace.id
              return (
                <div key={workspace.id} className={subordinateRowClass}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {workspace.displayName ?? workspace.workspaceSlug}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {workspace.workspaceSlug}
                    </p>
                  </div>
                  {testResult?.state === 'ok' ? (
                    <span className="flex shrink-0 items-center gap-1 text-xs text-status-success">
                      <CheckCircle2 className="size-3.5" />
                      {translate(
                        'auto.components.settings.plane.integration.card.verified',
                        'Verified'
                      )}
                    </span>
                  ) : null}
                  {testResult?.state === 'error' ? (
                    <span className="flex min-w-0 max-w-[220px] shrink items-center gap-1 truncate text-xs text-destructive">
                      <AlertCircle className="size-3.5 shrink-0" />
                      <span className="truncate">{testResult.error}</span>
                    </span>
                  ) : null}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleTest(workspace.id)}
                    disabled={testing}
                  >
                    {testing ? (
                      <>
                        <LoaderCircle className="size-3.5 mr-1.5 animate-spin" />
                        {translate(
                          'auto.components.settings.plane.integration.card.testing',
                          'Testing...'
                        )}
                      </>
                    ) : (
                      translate('auto.components.settings.plane.integration.card.test', 'Test')
                    )}
                  </Button>
                  <button
                    onClick={() => void handleDisconnect(workspace.id)}
                    aria-label={translate(
                      'auto.components.settings.plane.integration.card.disconnect_aria',
                      'Disconnect {{value0}}',
                      { value0: workspace.displayName ?? workspace.workspaceSlug }
                    )}
                    className="rounded-md p-1 text-muted-foreground/50 transition-colors hover:text-destructive"
                  >
                    <Unlink className="size-3.5" />
                  </button>
                </div>
              )
            })}
            <PlaneBoardSelector workspaces={workspaces} />
          </div>
        ) : connected ? (
          <>
            <p className="text-xs text-muted-foreground">
              {translate(
                'auto.components.settings.plane.integration.card.stale_hint',
                'Plane is connected for this runtime. Re-check if the connected workspace list looks stale.'
              )}
            </p>
            <Button variant="ghost" size="sm" onClick={() => void checkPlaneConnection(true)}>
              {translate('auto.components.settings.plane.integration.card.recheck', 'Re-check')}
            </Button>
          </>
        ) : !checking ? (
          <>
            <p className="text-xs text-muted-foreground">
              {translate(
                'auto.components.settings.plane.integration.card.setup_hint',
                'Connect with a Plane base URL, workspace slug, and personal access token. The same token can be reused to add more workspaces.'
              )}
            </p>
            <Button variant="ghost" size="sm" onClick={() => void checkPlaneConnection(true)}>
              {translate('auto.components.settings.plane.integration.card.recheck', 'Re-check')}
            </Button>
          </>
        ) : null}
      </IntegrationCardDetails>

      <PlaneConnectDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onConnected={() => setTestResultByWorkspace({})}
        overlayClassName="z-[110]"
        contentClassName="z-[120]"
      />
    </IntegrationCardShell>
  )
}
