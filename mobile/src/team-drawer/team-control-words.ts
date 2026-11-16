import { GAME_LEAD_ACTIONS } from '../../../src/shared/orchestrator-game-lead-actions'
import type { GameOrcaActionId } from '../../../src/shared/orchestrator-game-orca-actions'
import type { TeamAction, TeamActionOff } from '../../../src/shared/team-panel-actions'
import type { SupportedUiLocale } from '../../../src/shared/ui-locale'

type Words = {
  actions: string
  orca: Record<GameOrcaActionId, string>
  off: Record<TeamActionOff, string>
  why: Record<'wave' | 'push' | 'sweep', (count: number) => string>
  stopAll: string
  stopConfirm: (count: number) => string
  cancel: string
  sending: (label: string) => string
  sent: (label: string) => string
  launched: (count: number) => string
  failed: (label: string) => string
  stoppedBy: (by: string) => string
  stopped: string
  paused: string
  menu: { label: string; search: string; now: string; project: string; orca: string; none: string }
}

// Why these words: they match desktop's teamPanel catalog, so both surfaces say the same.
const WORDS: Record<SupportedUiLocale, Words> = {
  en: {
    actions: 'Actions',
    orca: { wave: 'Wave', status: 'Status', push: 'Push', sweep: 'Sweep', stop: 'Stop' },
    off: {
      stopped: 'A STOP is on',
      nothingToDo: 'Nothing to do',
      nobodyStopped: 'Nobody stopped',
      nothingToClose: 'Nothing to close',
      alreadyStopped: 'Already stopped',
      noNativePath: 'Runs from the terminal'
    },
    why: {
      wave: (count) => `${count} to do, slots free`,
      push: (count) => `${count} stopped`,
      sweep: (count) => `${count} finished to close`
    },
    stopAll: 'Stop every member',
    stopConfirm: (count) => `Stop all ${count} members? They stay stopped until you push them.`,
    cancel: 'Cancel',
    sending: (label) => `Sending ${label} to the lead…`,
    sent: (label) => `Sent to the lead: ${label}`,
    launched: (count) => `Wave launched ${count} ${count === 1 ? 'member' : 'members'}`,
    failed: (label) => `Could not send ${label}`,
    stoppedBy: (by) => `Stopped by ${by}`,
    stopped: 'Stopped',
    paused: 'Launches and pushes paused',
    menu: {
      label: 'All actions',
      search: 'Search actions',
      now: 'Now',
      project: 'This project',
      orca: 'From Orca',
      none: 'No action with that name.'
    }
  },
  es: {
    actions: 'Acciones',
    orca: { wave: 'Ola', status: 'Estado', push: 'Reactivar', sweep: 'Barrer', stop: 'Detener' },
    off: {
      stopped: 'Hay un STOP activo',
      nothingToDo: 'Nada por hacer',
      nobodyStopped: 'Nadie detenido',
      nothingToClose: 'Nada por cerrar',
      alreadyStopped: 'Ya detenidos',
      noNativePath: 'Se corre desde la terminal'
    },
    why: {
      wave: (count) => `${count} por hacer, hay cupos`,
      push: (count) => `${count} detenidos`,
      sweep: (count) => `${count} terminados por cerrar`
    },
    stopAll: 'Detener a todos',
    stopConfirm: (count) =>
      `¿Detener a los ${count} miembros? Siguen parados hasta que los reactives.`,
    cancel: 'Cancelar',
    sending: (label) => `Enviando ${label} al líder…`,
    sent: (label) => `Enviado al líder: ${label}`,
    launched: (count) => `La ola lanzó ${count} ${count === 1 ? 'miembro' : 'miembros'}`,
    failed: (label) => `No se pudo enviar ${label}`,
    stoppedBy: (by) => `Detenido por ${by}`,
    stopped: 'Detenido',
    paused: 'Lanzamientos y pushes en pausa',
    menu: {
      label: 'Todas las acciones',
      search: 'Buscar acción',
      now: 'Ahora',
      project: 'De este proyecto',
      orca: 'De Orca',
      none: 'Ninguna acción con ese nombre.'
    }
  }
}

export const teamControlWordsOf = (locale: SupportedUiLocale): Words => WORDS[locale]
export type TeamControlWords = Words

const DEFAULT_LABELS = new Map(GAME_LEAD_ACTIONS.map((one) => [one.command, one.label]))

/** Orca's own in the app language; a label the project wrote stays as written. */
export function teamActionLabelOf(
  action: Pick<TeamAction, 'orca' | 'label'>,
  words: TeamControlWords
): string {
  return action.orca && action.label === DEFAULT_LABELS.get(action.orca)
    ? words.orca[action.orca]
    : action.label
}

/** Why it shows now, with its count; else what it sends. */
export function teamActionHintOf(action: TeamAction, words: TeamControlWords): string {
  const count = action.now?.count
  if (
    count !== undefined &&
    (action.orca === 'wave' || action.orca === 'push' || action.orca === 'sweep')
  ) {
    return words.why[action.orca](count)
  }
  return action.send ?? ''
}
