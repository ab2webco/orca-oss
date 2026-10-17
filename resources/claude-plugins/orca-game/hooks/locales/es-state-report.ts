import type { StateReportCatalog } from '../state-report-words'

const onOff = (on: boolean): string => (on ? 'sí' : 'no')

export const ES_STATE_REPORT: StateReportCatalog = {
  title: 'Juego de Agent Teams',
  mode: 'Modo',
  scene: 'Escena',
  render: 'Render',
  timezone: 'Zona horaria',
  lead: 'Líder',
  warnings: 'Avisos',
  links: 'Enlaces',
  from: (source) => `(de ${source})`,
  sceneFile: (path) => `archivo de escena ${path}`,
  thisSession: (value, command) => `esta sesión: ${value} (/${command})`,
  hud: (on) => `HUD ${onOff(on)}`,
  rewards: (on) => `recompensas ${onOff(on)}`,
  tracker: (on) => `tracker ${onOff(on)}`,
  leadsHere: (label) => (label ? `${label}, este panel` : 'este panel'),
  memberHere: (label) =>
    label
      ? `${label} · este panel es un miembro y le reporta`
      : 'este panel es un miembro y le reporta a su líder',
  slots: (used, cap) => `${used} de ${cap} cupos usados, ${Math.max(0, cap - used)} libres`,
  noMembers: 'aún sin miembros',
  phases: {
    'needs-you': 'te espera',
    limited: 'limitado',
    working: 'trabajando',
    idle: 'inactivo',
    finished: 'terminado'
  },
  stop: (since, by) =>
    `STOP${since ? ` desde ${since}` : ''}${by ? ` (por ${by})` : ''}: no se lanza ni se publica nada hasta \`game resume\``,
  stopUnreadable: 'STOP (no se puede leer su estado, así que cuenta como activo)',
  notGamePane:
    'Esta sesión no la inició el juego de Orca: ORCA_GAME_CLI no está definido, así que no hay estado del juego que mostrar. Abre un panel de Claude Agent Teams desde Orca.',
  notState: 'orca game state respondió algo que no es un estado del juego',
  failed: (reason) => `orca game state falló: ${reason}`
}
