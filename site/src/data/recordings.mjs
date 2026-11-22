// Recordings of Orca Lab the landing shows, from docs/assets/readme (ORCA-954/955 captures of a demo
// project). sync-docs copies exactly these; ORCA-959 replaces each file with a motion clip in place.
export const RECORDINGS = {
  'team-machines.gif': {
    width: 1200,
    height: 750,
    en: 'The Team panel’s Machines tab: each paired host with its members against its cap, CPU, memory, disk and load.',
    es: 'La pestaña Machines del panel Equipo: cada host emparejado con sus miembros frente a su tope, CPU, memoria, disco y carga.'
  },
  'team-office-building.gif': {
    width: 1200,
    height: 750,
    en: 'The Team panel’s Office scene in 3D: a floor per machine, its Lobby with the games room and cafeteria, and the lead riding the glass lift to a member whose CI went red.',
    es: 'La escena Oficina del panel Equipo en 3D: un piso por máquina, su Lobby con la sala de juegos y la cafetería, y el líder subiendo en el ascensor de vidrio hasta un miembro cuyo CI quedó en rojo.'
  },
  'team-merge.gif': {
    width: 1200,
    height: 750,
    en: 'A member’s PR goes green and merges, and each award fills the team’s bar to the next level.',
    es: 'El PR de un miembro pasa a verde y se mergea, y cada premio llena la barra del equipo hasta el siguiente nivel.'
  },
  'team-style-office.gif': {
    width: 1200,
    height: 750,
    en: 'The Office style: a 3D building, a floor per machine.',
    es: 'El estilo Oficina: un edificio 3D, un piso por máquina.'
  },
  'team-style-figures.gif': {
    width: 1200,
    height: 750,
    en: 'The Figures style: an island per machine, each member building its house.',
    es: 'El estilo Figuras: una isla por máquina, cada miembro construyendo su casa.'
  },
  'team-style-pixel.gif': {
    width: 1200,
    height: 750,
    en: 'The Pixel style: the team as pixel sprites, a floor per machine.',
    es: 'El estilo Pixel: el equipo como sprites de píxeles, un piso por máquina.'
  },
  'plane-board.gif': {
    width: 1280,
    height: 764,
    en: 'A Plane board inside Orca Lab: Todo, In Progress, In Review and Done columns.',
    es: 'Un board de Plane dentro de Orca Lab: columnas Todo, In Progress, In Review y Done.'
  },
  'claude-accounts-switch.gif': {
    width: 1280,
    height: 800,
    en: 'Settings → AI Provider Accounts: switching the active Claude account.',
    es: 'Ajustes → Cuentas de proveedores de IA: cambiando la cuenta de Claude activa.'
  },
  'agent-grid.gif': {
    width: 1280,
    height: 800,
    en: 'The agent grid: four agents grouped as Needs You, Working and Done.',
    es: 'La cuadrícula de agentes: cuatro agentes agrupados en Te necesita, Trabajando y Listo.'
  },
  'diff-note.gif': {
    width: 960,
    height: 600,
    en: 'An AI diff in Orca Lab’s editor, where a note in the gutter goes to the agent.',
    es: 'Un diff de IA en el editor de Orca Lab, donde una nota en el margen va al agente.'
  },
  'design-mode.gif': {
    width: 960,
    height: 600,
    en: 'Design mode in the built-in browser: an annotated headline ready to send to the agent.',
    es: 'Modo diseño en el navegador integrado: un titular anotado listo para enviar al agente.'
  },
  'worklog-plugin.gif': {
    width: 1280,
    height: 800,
    en: 'The Worklog example plugin’s panel in Settings, reading and writing its own storage.',
    es: 'El panel del plugin de ejemplo Worklog en Ajustes, leyendo y escribiendo su propio almacenamiento.'
  },
  'mobile-inbox-ios.gif': {
    width: 360,
    height: 783,
    en: 'The iOS app’s Team sheet: the lead’s question arrives, is answered from the Inbox, and the member goes back to work.',
    es: 'La hoja Equipo de la app de iOS: llega la pregunta del líder, se responde desde el Inbox y el miembro vuelve a trabajar.'
  },
  'mobile-team-ios.gif': {
    width: 360,
    height: 783,
    en: 'The iOS app’s Team sheet: the live scene, each member’s state in its colour, the merge queue and the hosts.',
    es: 'La hoja Equipo de la app de iOS: la escena en vivo, el estado de cada miembro en su color, la cola de merge y los hosts.'
  },
  'mobile-terminal-ios.gif': {
    width: 360,
    height: 783,
    en: 'The iOS app streaming a Claude Code terminal, with keys to type into it.',
    es: 'La app de iOS mostrando en vivo una terminal de Claude Code, con teclas para escribir en ella.'
  }
}

// Motion clips from docs/assets/media (mp4, webm and the poster png); each reuses its GIF's size and text.
export const CLIPS = [
  'team-office-building',
  'team-merge',
  'team-style-office',
  'team-style-figures',
  'team-style-pixel',
  'team-machines'
]
