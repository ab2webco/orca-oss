import type { Lang } from './product'

export type Who = 'you' | 'lead' | 'agent' | 'auto'

// Who acts at each of the ten stations.
const who: readonly Who[] = [
  'you',
  'lead',
  'lead',
  'agent',
  'auto',
  'agent',
  'auto',
  'lead',
  'you',
  'lead'
]
// The machinery around the lead and the stations (1-based) each works at, so a step lights it.
// Orca's own parts are solid; the plugins it runs with are dashed and tagged.
const gears = [
  { slot: 0, at: [1, 2, 9, 10], plugin: false },
  { slot: 2, at: [2], plugin: true },
  { slot: 4, at: [3, 4], plugin: true },
  { slot: 6, at: [5, 6], plugin: false },
  { slot: 8, at: [7, 8], plugin: false }
] as const

// Each station: name, its label on the ring, what happens, the command, then what Orca Game shows,
// what watches it and what it asks of you. Kept short: the landing holds 95 words per 1440 screen.
// Every `orca` line must parse as written: src/cli/landing-factory-commands.test.ts runs them.
type Station = readonly [string, string, string, string, string, string, string]

const copy: Record<
  Lang,
  {
    title: string
    lede: string
    svg: string
    lead: readonly [string, string]
    rows: readonly [string, string, string]
    who: Record<Who, string>
    gears: readonly [string, string, string, string, string]
    legend: readonly [string, string, string, string, string, string]
    pause: readonly [string, string]
    stations: readonly Station[]
  }
> = {
  en: {
    title: 'The software factory',
    lede: 'Follow one ticket through ten stations: what runs in Orca and what Orca Game shows.',
    svg: 'The factory loop as a ring of ten stations, with the lead at the centre. One ticket, APP-12, travels around it, and a second agent reviews every change before it merges.',
    lead: ['Lead', 'coordinates'],
    rows: ['Orca Game', 'Watching', 'You here'],
    who: { you: 'You', lead: 'Lead', agent: 'Agent', auto: 'Automation' },
    gears: ['Panel', 'Sonar', 'Jev', 'Reports', 'Monitors'],
    legend: [
      'You',
      'Lead',
      'Agents',
      'Automation',
      'Plugin',
      'A second agent reviews every change'
    ],
    pause: ['Pause', 'Play'],
    stations: [
      [
        'Idea or bug',
        'you ask for it or the system finds it',
        'You ask the lead, in its terminal or by phone.',
        '/orca-game:lead\n> I want dark mode in the app',
        'The lead joins the scene and Panel.',
        'orca.yaml rules load with the lead.',
        'you ask'
      ],
      [
        'Ticket',
        'in the project’s tracker',
        'Sonar searches the code; the lead files the ticket.',
        'orca sonar find "theme"\norca plane create --project <id> --title "Dark mode" --state Todo',
        'It lands in To Do.',
        'Lessons from earlier laps.',
        'nothing'
      ],
      [
        'Plan',
        'small changes',
        'The lead picks the model and launches a member.',
        'orca game plan APP-12 --phase "implement:opus-5-5:high:every screen"\norca game launch APP-12 --on studio --repo name:app',
        'A character spawns.',
        'Quota and machine load.',
        'product calls'
      ],
      [
        'Build',
        'one agent per ticket',
        'The member reads its plan and codes, test first.',
        'orca game plan APP-12',
        'Advisor shows Jev’s pick and why.',
        'Jev picks model and effort per step.',
        'nothing'
      ],
      [
        'Change and CI',
        'checks on push',
        'The member opens the PR and reports to the lead.',
        'orca orchestration send --type worker_done --subject "PR #48" --envelope-file done.json\norca orchestration check --wait',
        'Its card shows PR #48 and CI running.',
        'The report wait and PR checks.',
        'nothing'
      ],
      [
        'Review',
        'another agent, not the author',
        'A second member reviews the diff against the criteria.',
        'orca game launch APP-12 --kind review',
        'Two characters on one ticket.',
        'Findings go back to the author.',
        'nothing'
      ],
      [
        'Merge queue',
        'the full suite',
        'The lead enqueues the PR; the full suite runs.',
        'orca game watch --lead',
        '#48 merged and the team earns XP.',
        'A monitor flags a dropped PR.',
        'nothing'
      ],
      [
        'Release',
        'the change goes out',
        'It ships in the next release; the lead frees finished members.',
        'orca game sweep --close',
        'Finished characters leave the scene.',
        'Each freed member is kept in game history.',
        'nothing yet'
      ],
      [
        'Your test',
        'the whole product',
        'You test the release; decisions reach your Inbox.',
        'orca game ask-owner --ticket APP-12 --question "Default theme?"',
        'One tap answers the Inbox question.',
        'Panel flags who waits.',
        'test and decide'
      ],
      [
        'Lesson',
        'a new check',
        'What you found becomes a ticket, a test, a rule.',
        'orca plane create --project <id> --title "White flash"',
        'It enters To Do.',
        'The new test runs on every change.',
        'nothing: back to 1'
      ]
    ]
  },
  es: {
    title: 'La fábrica de software',
    lede: 'Sigue un ticket por diez estaciones: lo que corre en Orca y lo que muestra Orca Game.',
    svg: 'El bucle de la fábrica como un anillo de diez estaciones, con el líder al centro. Un ticket, APP-12, lo recorre, y un segundo agente revisa cada cambio antes de integrarlo.',
    lead: ['Líder', 'coordina'],
    rows: ['Orca Game', 'Vigila', 'Tú aquí'],
    who: { you: 'Tú', lead: 'Líder', agent: 'Agente', auto: 'Automatización' },
    gears: ['Panel', 'Sonar', 'Jev', 'Reportes', 'Monitores'],
    legend: [
      'Tú',
      'Líder',
      'Agentes',
      'Automatización',
      'Plugin',
      'Un segundo agente revisa cada cambio'
    ],
    pause: ['Pausa', 'Reproducir'],
    stations: [
      [
        'Idea o defecto',
        'lo pides tú o lo detecta el sistema',
        'Le pides algo al líder, en su terminal o por teléfono.',
        '/orca-game:lead\n> Quiero modo oscuro en la app',
        'El líder entra a la escena y al Panel.',
        'Las reglas de orca.yaml cargan con el líder.',
        'lo pides'
      ],
      [
        'Ticket',
        'en el tracker del proyecto',
        'El líder busca en el código con Sonar y escribe el ticket.',
        'orca sonar find "theme"\norca plane create --project <id> --title "Modo oscuro" --state Todo',
        'El ticket llega a To Do.',
        'Lecciones de vueltas anteriores.',
        'nada'
      ],
      [
        'Plan',
        'cambios pequeños',
        'El líder elige el modelo y lanza un miembro.',
        'orca game plan APP-12 --phase "implement:opus-5-5:high:todas las pantallas"\norca game launch APP-12 --on studio --repo name:app',
        'Nace un personaje.',
        'Cuota y carga de la máquina.',
        'decisiones de producto'
      ],
      [
        'Construcción',
        'un agente por ticket',
        'El miembro lee su plan y programa, primero la prueba.',
        'orca game plan APP-12',
        'Advisor muestra la elección de Jev y por qué.',
        'Jev elige modelo y esfuerzo en cada paso.',
        'nada'
      ],
      [
        'Cambio y CI',
        'chequeos al subir',
        'El miembro abre el PR y avisa al líder.',
        'orca orchestration send --type worker_done --subject "PR #48" --envelope-file done.json\norca orchestration check --wait',
        'Su tarjeta muestra el PR #48 y el CI en curso.',
        'La espera de reportes y los chequeos del PR.',
        'nada'
      ],
      [
        'Revisión',
        'otro agente, no el autor',
        'Un segundo miembro revisa el diff contra los criterios.',
        'orca game launch APP-12 --kind review',
        'Dos personajes en un ticket.',
        'Los hallazgos vuelven al autor.',
        'nada'
      ],
      [
        'Cola de integración',
        'la suite completa',
        'El líder encola el PR; la cola corre la suite completa.',
        'orca game watch --lead',
        '#48 integrado y el equipo gana XP.',
        'Un monitor avisa si la cola lo expulsa.',
        'nada'
      ],
      [
        'Versión',
        'el cambio sale',
        'Sale en la próxima versión; el líder libera a los miembros terminados.',
        'orca game sweep --close',
        'Los personajes terminados salen.',
        'Cada miembro liberado queda en el historial.',
        'nada todavía'
      ],
      [
        'Tu prueba',
        'el producto entero',
        'Pruebas la versión; tus decisiones llegan a tu Inbox.',
        'orca game ask-owner --ticket APP-12 --question "¿Tema por defecto?"',
        'Un toque responde la pregunta del Inbox.',
        'El Panel marca quién espera.',
        'pruebas y decides'
      ],
      [
        'Lección',
        'una comprobación nueva',
        'Lo que encontraste se vuelve ticket, prueba y regla.',
        'orca plane create --project <id> --title "Fondo blanco al abrir"',
        'El ticket nuevo entra a To Do.',
        'La prueba nueva corre en cada cambio.',
        'nada: vuelve a la 1'
      ]
    ]
  }
}

export const factoryRing = (lang: Lang) => {
  const t = copy[lang]
  return {
    ...t,
    stations: t.stations.map(([name, sub, body, command, ...rows], i) => ({
      who: who[i] as Who,
      name,
      sub,
      body,
      command,
      rows
    })),
    gears: gears.map((gear, i) => ({ ...gear, name: t.gears[i] as string }))
  }
}
