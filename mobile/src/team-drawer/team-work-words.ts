import type {
  TeamMachine,
  TeamPrRow,
  TeamQueueEntry
} from '../../../src/shared/team-panel-model-types'
import type { TeamMachineWarning } from '../../../src/shared/team-machine-board'
import type { SupportedUiLocale } from '../../../src/shared/ui-locale'

type Words = {
  prs: string
  hosts: string
  mergeQueue: string
  openPrs: string
  viewAll: (count: number) => string
  reason: Record<TeamPrRow['reason'], string>
  queue: Record<TeamQueueEntry['state'], string>
  longWait: (hours: number) => string
  noPrs: string
  prsError: string
  queueError: string
  machinesError: string
  unavailable: string
  loading: string
  providerFailed: string
  githubLimit: (minutes: number) => string
  offline: string
  /** The 3D Office's ground floor. */
  lobby: string
  lowMemory: string
  free: string
  launch: Record<Exclude<TeamMachine['launch']['kind'], 'ready'>, string>
  notRegisteredNote: (project: string) => string
  notAnsweringNote: string
  unknownNote: string
  running: (count: number) => string
  runningOfCap: (count: number, cap: number) => string
  used: (label: string, percent: number) => string
  memoryFree: (free: string, total: string) => string
  warning: Record<TeamMachineWarning, string>
  cpu: string
  memory: string
  disk: string
  load: (load: string) => string
  cores: (count: number) => string
  slotsFree: (count: number) => string
  ready: string
  agents: string
  busyOrLow: string
  ofTotal: (total: number) => string
  blocked: (count: number) => string
  offlineCount: (count: number) => string
  aloneTitle: string
  aloneText: string
}

// Why these words: they match desktop's teamPanel catalog, so both surfaces say the same.
const WORDS: Record<SupportedUiLocale, Words> = {
  en: {
    prs: 'PRs',
    hosts: 'Hosts',
    mergeQueue: 'Merge queue',
    openPrs: 'Open PRs',
    viewAll: (count) => `View all ${count}`,
    reason: {
      checksFailed: 'Check failed',
      checksUnknown: 'CI unknown',
      conflict: 'Conflict',
      inReview: 'In review',
      ready: 'Ready',
      draft: 'Draft',
      merged: 'Merged',
      closed: 'Closed'
    },
    queue: { checks: 'In checks', waiting: 'In queue', failed: 'Failed' },
    longWait: (hours) => `For ${hours} h`,
    noPrs: 'No open pull requests',
    prsError: 'Could not read pull requests',
    queueError: 'Could not read the queue',
    machinesError: 'Could not read the machines',
    unavailable: 'This Orca host does not publish it yet.',
    loading: 'Loading',
    providerFailed: 'The provider did not answer. It retries on its own.',
    githubLimit: (minutes) => `GitHub API limit reached. It retries on its own in ${minutes} min.`,
    offline: 'Offline',
    lobby: 'Lobby',
    lowMemory: 'Low memory',
    free: 'Free',
    launch: {
      unregistered: 'Not registered',
      refused: 'Refused',
      unanswered: 'Not answering',
      unknown: 'Unknown'
    },
    notRegisteredNote: (project) =>
      `${project} is not registered here. With the owner's OK, clone and register it.`,
    notAnsweringNote: 'It did not list its repos, so Orca cannot tell if members can start here.',
    unknownNote:
      'This Orca does not say if members can start here. Update Orca Lab on this machine.',
    running: (count) => (count === 1 ? '1 agent' : `${count} agents`),
    runningOfCap: (count, cap) => `${count} of ${cap} agents`,
    used: (label, percent) => `${label} used ${percent}%`,
    memoryFree: (free, total) => `${free} of ${total} GB free`,
    warning: { busy: 'Busy', lowMemory: 'Low memory', lowDisk: 'Low disk' },
    cpu: 'CPU',
    memory: 'Memory',
    disk: 'Disk',
    load: (load) => `load ${load}`,
    cores: (count) => `${count} cores`,
    slotsFree: (count) => (count === 1 ? '1 slot free' : `${count} slots free`),
    ready: 'Ready',
    agents: 'Agents',
    busyOrLow: 'Busy / low',
    ofTotal: (total) => `of ${total}`,
    blocked: (count) => `${count} can't launch`,
    offlineCount: (count) => `${count} offline`,
    aloneTitle: 'Only this machine',
    aloneText: 'Pair another machine to spread agents across hosts.'
  },
  es: {
    prs: 'PRs',
    hosts: 'Hosts',
    mergeQueue: 'Cola de merge',
    openPrs: 'PRs abiertos',
    viewAll: (count) => `Ver los ${count}`,
    reason: {
      checksFailed: 'Check falló',
      checksUnknown: 'CI desconocido',
      conflict: 'Conflicto',
      inReview: 'En revisión',
      ready: 'Listo',
      draft: 'Borrador',
      merged: 'Fusionado',
      closed: 'Cerrado'
    },
    queue: { checks: 'En checks', waiting: 'En cola', failed: 'Falló' },
    longWait: (hours) => `Lleva ${hours} h`,
    noPrs: 'No hay pull requests abiertos',
    prsError: 'No se pudieron leer los pull requests',
    queueError: 'No se pudo leer la cola',
    machinesError: 'No se pudieron leer las máquinas',
    unavailable: 'Este host de Orca todavía no lo publica.',
    loading: 'Cargando',
    providerFailed: 'El proveedor no respondió. Se reintenta solo.',
    githubLimit: (minutes) =>
      `Límite de la API de GitHub alcanzado. Se reintenta solo en ${minutes} min.`,
    offline: 'Sin conexión',
    lobby: 'Lobby',
    lowMemory: 'Poca memoria',
    free: 'Libre',
    launch: {
      unregistered: 'Sin registrar',
      refused: 'Rechazada',
      unanswered: 'No responde',
      unknown: 'Desconocida'
    },
    notRegisteredNote: (project) =>
      `${project} no está registrado aquí. Con el visto bueno del dueño, clónalo y regístralo.`,
    notAnsweringNote:
      'No listó sus repos, así que Orca no sabe si los miembros pueden arrancar aquí.',
    unknownNote:
      'Este Orca no dice si los miembros pueden arrancar aquí. Actualiza Orca Lab en esta máquina.',
    running: (count) => (count === 1 ? '1 agente' : `${count} agentes`),
    runningOfCap: (count, cap) => `${count} de ${cap} agentes`,
    used: (label, percent) => `${label} en uso ${percent}%`,
    memoryFree: (free, total) => `${free} de ${total} GB libres`,
    warning: { busy: 'Ocupada', lowMemory: 'Poca memoria', lowDisk: 'Poco disco' },
    cpu: 'CPU',
    memory: 'Memoria',
    disk: 'Disco',
    load: (load) => `carga ${load}`,
    cores: (count) => `${count} núcleos`,
    slotsFree: (count) => (count === 1 ? '1 lugar libre' : `${count} lugares libres`),
    ready: 'Listas',
    agents: 'Agentes',
    busyOrLow: 'Ocupadas / bajas',
    ofTotal: (total) => `de ${total}`,
    blocked: (count) => `${count} no pueden lanzar`,
    offlineCount: (count) => `${count} sin conexión`,
    aloneTitle: 'Solo esta máquina',
    aloneText: 'Empareja otra máquina para repartir agentes entre hosts.'
  }
}

export const teamWorkWordsOf = (locale: SupportedUiLocale): Words => WORDS[locale]
export type TeamWorkWords = Words
