import React from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type {
  AgentCliSelfUpdateStatus,
  RepairableAgentCliId
} from '../../../../shared/agent-cli-self-update'

/**
 * Aviso para un CLI de agente que esta instalado donde su dueno no lo puede
 * actualizar: un `npm i -g` global propiedad de root, o un prefix en un montaje
 * de solo lectura. El CLI intenta auto-actualizarse, no puede, y se queda
 * clavado meses sin que nadie lo note.
 *
 * Orca no instala estos CLIs — no es duena del host. Lo unico que ofrece aqui
 * es mover el que YA esta al HOME del usuario, que si es escribible.
 */
export function AgentCliSelfUpdateNotice({
  status,
  onRepair
}: {
  status: AgentCliSelfUpdateStatus | null
  onRepair: (agentId: RepairableAgentCliId) => Promise<void>
}): React.JSX.Element | null {
  const [repairing, setRepairing] = React.useState(false)
  if (status?.state !== 'blocked') {
    return null
  }
  const agentId = status.agentId as RepairableAgentCliId
  return (
    <div className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs">
      <p className="text-foreground">
        {translate(
          'auto.components.settings.AgentCliSelfUpdateNotice.blocked',
          "This CLI can't update itself"
        )}
      </p>
      <p className="mt-1 text-muted-foreground">
        {translate(
          'auto.components.settings.AgentCliSelfUpdateNotice.blockedDetail',
          'It is installed in a directory this user cannot write, so its own updater fails and the version stays frozen.'
        )}
      </p>
      {status.installRoot ? (
        <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
          {status.installRoot}
        </p>
      ) : null}
      {status.repairable ? (
        <Button
          size="sm"
          variant="outline"
          className="mt-2"
          disabled={repairing}
          onClick={() => {
            setRepairing(true)
            void onRepair(agentId).finally(() => setRepairing(false))
          }}
        >
          {repairing
            ? translate('auto.components.settings.AgentCliSelfUpdateNotice.fixing', 'Moving…')
            : translate(
                'auto.components.settings.AgentCliSelfUpdateNotice.fix',
                'Reinstall for this user'
              )}
        </Button>
      ) : (
        <p className="mt-1 text-muted-foreground">
          {translate(
            'auto.components.settings.AgentCliSelfUpdateNotice.manual',
            'Reinstall it under your home directory so its updater can write.'
          )}
        </p>
      )}
    </div>
  )
}

/** Traduce el resultado de la reparacion a algo que el usuario pueda accionar. */
export function reportAgentCliSelfUpdateRepair(
  result: Awaited<ReturnType<NonNullable<typeof window.api>['preflight']['repairAgentSelfUpdate']>>
): void {
  if (result.kind === 'repaired') {
    toast.success(
      translate('auto.components.settings.AgentCliSelfUpdateNotice.repaired', 'Reinstalled'),
      { description: result.status.binPath ?? undefined }
    )
    return
  }
  if (result.kind === 'shadowed-by-path') {
    // Why se dice y no se celebra: quedo instalado, pero el viejo sigue ganando
    // en el PATH, asi que el auto-update seguiria fallando. Decir "listo" aqui
    // es el error que hace que el problema vuelva en un mes.
    toast.warning(
      translate(
        'auto.components.settings.AgentCliSelfUpdateNotice.shadowed',
        'Installed, but the old copy still wins'
      ),
      {
        description: translate(
          'auto.components.settings.AgentCliSelfUpdateNotice.shadowedDetail',
          'Put {dir} first in your PATH and open a new terminal.'
        ).replace('{dir}', result.userBinDir)
      }
    )
    return
  }
  toast.error(
    translate('auto.components.settings.AgentCliSelfUpdateNotice.failed', 'Could not reinstall'),
    { description: result.kind === 'failed' ? result.message : undefined }
  )
}
