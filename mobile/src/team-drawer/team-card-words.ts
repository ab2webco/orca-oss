import type { SupportedUiLocale } from '../../../src/shared/ui-locale'
import type { TeamFlowPhase } from '../../../src/shared/team-panel-model-types'
import type { TeamMemberRow } from './team-drawer-model'

type Words = {
  state: Record<TeamMemberRow['state'], string>
  phase: Record<TeamFlowPhase, string>
  waitingForAnswer: string
  loggedOut: string
  limitReached: string
  limitResetsIn: (age: string) => string
  ciGreen: string
  ciFailing: string
  ciRunning: string
  merged: string
  comments: (count: number) => string
  answerInInbox: string
  openTerminal: string
  terminalOnHost: (host: string) => string
  local: string
  now: string
  needYou: (count: number) => string
  workingOf: (working: number, total: number) => string
  noMembers: string
  team: string
  inbox: string
  openTeam: (peek: string) => string
  closeTeam: (peek: string) => string
  members: (count: number) => string
  noMembersRunning: string
  metrics: string
  mergedOn: (day: string) => string
  mergedIn: (days: number) => string
  medianLeadTime: string
}

// Why these words: they match desktop's teamPanel catalog, so both surfaces say the same.
// Why `mergedIn` keeps a no-break space: a narrow tile wrapped the "d" alone onto its own line.
const WORDS: Record<SupportedUiLocale, Words> = {
  en: {
    state: { waiting: 'Waiting for you', working: 'Working', idle: 'Idle', done: 'Done' },
    phase: {
      plan: 'Planning',
      docs: 'Documenting',
      code: 'Coding',
      tests: 'Testing',
      pr: 'In PR',
      merge: 'Merging'
    },
    waitingForAnswer: 'Waiting for your answer',
    loggedOut: 'Logged out',
    limitReached: 'Usage limit reached',
    limitResetsIn: (age) => `Usage limit · resets in ${age}`,
    ciGreen: 'CI green',
    ciFailing: 'CI failing',
    ciRunning: 'CI running',
    merged: 'Merged',
    comments: (count) => `${count} comment${count === 1 ? '' : 's'}`,
    answerInInbox: 'Answer in Inbox',
    openTerminal: 'Open terminal',
    terminalOnHost: (host) => `Its terminal is on ${host}`,
    local: 'local',
    now: 'now',
    needYou: (count) => `${count} ${count === 1 ? 'needs' : 'need'} you`,
    workingOf: (working, total) => `${working} working · ${total} member${total === 1 ? '' : 's'}`,
    noMembers: 'No members running',
    team: 'Team',
    inbox: 'Inbox',
    openTeam: (peek) => `Open Team, ${peek}`,
    closeTeam: (peek) => `Close Team, ${peek}`,
    members: (count) => `Members (${count})`,
    noMembersRunning: 'No members running.',
    metrics: 'Metrics',
    mergedOn: (day) => `Merged on ${day}`,
    mergedIn: (days) => `Merged in ${days} d`,
    medianLeadTime: 'Median lead time'
  },
  es: {
    state: { waiting: 'Esperándote', working: 'Trabajando', idle: 'En reposo', done: 'Terminado' },
    phase: {
      plan: 'Planeando',
      docs: 'Documentando',
      code: 'Programando',
      tests: 'Probando',
      pr: 'En PR',
      merge: 'En merge'
    },
    waitingForAnswer: 'Esperando tu respuesta',
    loggedOut: 'Sesión cerrada en la cuenta',
    limitReached: 'Límite de uso alcanzado',
    limitResetsIn: (age) => `Límite de uso · se renueva en ${age}`,
    ciGreen: 'CI en verde',
    ciFailing: 'CI fallando',
    ciRunning: 'CI en curso',
    merged: 'Mergeado',
    comments: (count) => `${count} comentario${count === 1 ? '' : 's'}`,
    answerInInbox: 'Responder en Bandeja',
    openTerminal: 'Abrir terminal',
    terminalOnHost: (host) => `Su terminal está en ${host}`,
    local: 'local',
    now: 'ahora',
    needYou: (count) => `${count} te ${count === 1 ? 'necesita' : 'necesitan'}`,
    workingOf: (working, total) =>
      `${working} trabajando · ${total} miembro${total === 1 ? '' : 's'}`,
    noMembers: 'Ningún miembro en marcha',
    team: 'Equipo',
    inbox: 'Bandeja',
    openTeam: (peek) => `Abrir Equipo, ${peek}`,
    closeTeam: (peek) => `Cerrar Equipo, ${peek}`,
    members: (count) => `Miembros (${count})`,
    noMembersRunning: 'Ningún miembro en marcha.',
    metrics: 'Métricas',
    mergedOn: (day) => `Mergeados el ${day}`,
    mergedIn: (days) => `Mergeados en ${days} d`,
    medianLeadTime: 'Tiempo de entrega mediano'
  }
}

export const teamCardWordsOf = (locale: SupportedUiLocale): Words => WORDS[locale]
export type TeamCardWords = Words
