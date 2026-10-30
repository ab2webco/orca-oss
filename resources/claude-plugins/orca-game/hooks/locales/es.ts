import type { GameCatalog } from '../game-strings'

const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`

export const ES: GameCatalog = {
  text: {
    panel: 'Panel',
    refresh: 'Actualizar',
    pet: 'Mimar',
    flatView: 'Texto',
    sceneView: 'Escena',
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
    asksLead: (lead) => `? Pregunta a ${lead}:`,
    briefReceived: 'Instrucciones recibidas',
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
      waiting: '! esperando',
      orchestrating: 'orquestando'
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
    perfectMerge: (review) => `${review}: merge perfecto`,
    memberLaunched: (member) => `${member} en marcha`,
    questDescription:
      'Modo quest, forma corta de /orca-game:quest: un Claude animado, tarjetas de personaje por fase del flujo y filas de herramientas discretas',
    questModesHelp:
      '/orca-game:mode on|zen|flat|off: off lo muestra todo, on oculta las filas de herramientas, zen también oculta las notas de trabajo y flat dibuja el juego como texto, sin escena. /orca-game:render classic|hd|hd-compact elige el aspecto, /orca-game:demo reproduce un grupo ficticio con guion y /orca-game:state muestra todo el estado del juego y /orca-game:layout ordena las secciones del Panel. /quest es la forma corta, que también funciona a mitad de un turno. /orca-game:view lista cada vista con su costo y cambia este panel, este proyecto o todos los proyectos.',
    questShown: (mode) => `Quest: ${mode}.`,
    questDemo:
      'Quest: demo. Un grupo ficticio con guion reproduce todas las reacciones; no se lee ni se escribe nada. /orca-game:mode on vuelve a los datos reales.',
    unknownMode: (asked) =>
      `Modo desconocido "${asked}". Usa /orca-game:mode on, /orca-game:mode zen, /orca-game:mode flat, /orca-game:mode off o /orca-game:demo.`,
    questRenderShown: (render) => `Render: ${render}.`,
    sessionOverride: (value, configured, source) =>
      `${value} (solo esta sesión; la configuración del proyecto es ${configured}${source ? `, de ${source}` : ''})`,
    unknownRender: (asked) =>
      `Render desconocido "${asked}". Usa /orca-game:render classic, hd o hd-compact.`,
    moreAllies: (count) => `+${count} más`,
    myReviews: (kind, count) => `Mis ${kind}s ${count}`,
    todo: (count) => `Por hacer ${count}`,
    actionsHeading: 'Acciones',
    layoutNewer:
      'Una versión más nueva de Orca Lab guardó este diseño del Panel; actualiza Orca Lab para cambiarlo.',
    layoutSections: {
      team: 'Equipo',
      review: 'Revisión',
      reviews: 'Mis PRs',
      todo: 'Por hacer',
      actions: 'Acciones'
    },
    layoutHint:
      'Consejo: pulsa ▾ junto a una sección del Panel para plegarla; /orca-game:layout las oculta, mueve o restablece.',
    layoutHeading: 'Diseño del Panel de este proyecto:',
    layoutStates: { shown: 'visible', collapsed: 'plegada', hidden: 'oculta' },
    layoutUsage:
      'Cámbialo con /orca-game:layout restablecer, añadir <sección>, quitar <sección> o mover <sección> arriba|abajo. Pulsa ▾ o ▸ en el Panel para plegar una sección.',
    catalogMenu: 'Widgets',
    layoutUnknownSection: (asked, sections) =>
      `Sección desconocida "${asked}". Secciones: ${sections}.`,
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
    limited: (backIn) => (backIn === null ? 'limitado' : `limitado · vuelve en ${backIn}`),
    remoteHost: (host, answering) => (answering ? `en ${host}` : `${host} no responde`),
    advisorPinned: ({ model, effort }) =>
      model && effort
        ? 'modelo y esfuerzo fijados'
        : model
          ? 'modelo fijado'
          : effort
            ? 'esfuerzo fijado'
            : '',
    membersOn: (count, model) => `${count} con ${model}`
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
    advisorConsulting: 'déjame pensar...',
    advisorAdvised: 'este es mi consejo',
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
