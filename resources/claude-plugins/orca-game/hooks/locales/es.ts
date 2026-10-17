import type { GameCatalog } from '../game-strings'

const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`

export const ES: GameCatalog = {
  text: {
    panel: 'Panel',
    refresh: 'Actualizar',
    pet: 'Mimar',
    petNamed: (name) => `Mimar a ${name}`,
    advisor: 'Consejero',
    advisorMain: 'conversación principal',
    advisorEmpty: 'Sin decisiones todavía',
    close: 'Cerrar',
    view: 'Ver',
    fleet: 'Flota',
    team: 'Equipo',
    loading: 'cargando…',
    refreshing: '(actualizando)',
    unavailable: 'orca game state no disponible',
    lead: 'líder',
    reviewHeading: 'Revisión',
    workItemHeading: 'Tarea',
    needsYou: 'Te necesitan:',
    waitingNeed: 'te espera',
    ciFailingNeed: 'CI fallando',
    teammates: (count) => `Equipo: ${plural(count, 'compañero', 'compañeros')}`,
    working: (count) => `${count} trabajando`,
    idle: (count) => plural(count, 'inactivo', 'inactivos'),
    done: (count) => plural(count, 'terminado', 'terminados'),
    waiting: (count) => plural(count, 'te espera', 'te esperan'),
    agentStates: {
      working: 'trabajando',
      idle: 'inactivo',
      done: 'terminado',
      waiting: '! esperando'
    },
    reviewStates: { open: 'abierto', draft: 'borrador', merged: 'mergeado', closed: 'cerrado' },
    ciWords: {
      success: 'en verde',
      failure: 'fallando',
      pending: 'en curso',
      neutral: 'neutral',
      none: 'sin resultado'
    },
    couldNotOpen: (name) => `No se pudo abrir el panel de ${name}`,
    openHeading: 'Abrir',
    couldNotOpenLink: (label) => `No se pudo abrir ${label}`,
    merged: (review) => `${review} mergeado`,
    ciGreen: (review) => `${review}: CI en verde`,
    questDescription:
      'Modo quest: un Claude animado, tarjetas de personaje por fase del flujo y filas de herramientas discretas',
    questModesHelp:
      '/quest off lo muestra todo, /quest on oculta las filas de herramientas, /quest zen también oculta las notas de trabajo, /quest demo reproduce un grupo ficticio con guion y /quest render classic|hd elige el aspecto.',
    questShown: (mode) => `Quest: ${mode}.`,
    questDemo:
      'Quest: demo. Un grupo ficticio con guion reproduce todas las reacciones; no se lee ni se escribe nada. /quest on vuelve a los datos reales.',
    unknownMode: (asked) =>
      `Modo desconocido "${asked}". Usa /quest off, /quest on, /quest zen o /quest demo.`,
    questRenderShown: (render) => `Render: ${render}.`,
    sessionOverride: (value, configured, source) =>
      `${value} (solo esta sesión; la configuración del proyecto es ${configured}${source ? `, de ${source}` : ''})`,
    unknownRender: (asked) =>
      `Render desconocido "${asked}". Usa /quest render classic o /quest render hd.`,
    moreAllies: (count) => `+${count} más`,
    myReviews: (kind, count) => `Mis ${kind}s ${count}`,
    todo: (count) => `Por hacer ${count}`,
    actionsHeading: 'Acciones',
    sentToLead: (label) => `Enviado al líder: ${label}`,
    couldNotSend: (label) => `No se pudo enviar ${label}`,
    actionRunning: 'ejecutando…',
    demoAction: (label) => `Demo: ${label} no se ejecuta`,
    todoHeadings: {
      in_progress: 'En curso',
      review: 'QA / revisión',
      todo: 'Por hacer',
      backlog: 'Backlog',
      other: 'Otros'
    },
    qa: (count) => `QA ${count}`,
    workOn: (id) => `Trabajar en ${id}`,
    leadActions: {
      wave: 'Ola',
      status: 'Estado',
      push: 'Reactivar',
      sweep: 'Barrer',
      stop: 'Detener'
    },
    actionCommandDescription: (label) => `Acción de Orca: ${label}`,
    actionCommandRefused: (command) =>
      `/${command} ya lo usa otro comando; usa su botón en la banda o en el Panel`,
    actionCommandGone: (command) => `/${command} ya no es una acción de este proyecto`,
    limited: (backIn) => (backIn === null ? 'limitado' : `limitado · vuelve en ${backIn}`)
  },
  art: {
    needsYou: '¡te necesita!',
    alert: (name) => `¡${name} te necesita!`,
    ciIsRed: 'CI en rojo',
    mergedFloat: (review) => `¡${review} mergeado!`,
    lead: 'Líder',
    noParty: 'Aún no hay grupo.',
    teammatesJoin: 'Los compañeros llegan cuando el líder los crea.',
    level: 'Nv',
    xp: 'XP',
    thinking: 'pensando',
    thanks: '♥ ¡gracias!',
    onIt: '¡voy!',
    levelUp: '★ ¡subes de nivel!',
    reading: 'Leyendo',
    editing: 'Editando',
    writing: 'Escribiendo',
    runningCommand: 'Ejecutando un comando',
    searchingCode: 'Buscando en el código',
    delegating: (what) => `Delegando: ${what}`,
    anAgent: 'un agente',
    researchingWeb: 'Investigando en la web',
    running: (what) => `Ejecutando ${what}`,
    aSkill: 'una skill',
    using: (what) => `Usando ${what}`,
    says: { working: 'trabajando', idle: 'inactivo', done: 'terminado', waiting: 'esperando' },
    movingTo: (item, status) => `Moviendo ${item} a ${status}`
  }
}
