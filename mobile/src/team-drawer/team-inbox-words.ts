import type { SupportedUiLocale } from '../../../src/shared/ui-locale'
import type { GameWaitingItem } from '../../../src/shared/orchestrator-game-inbox-threads'

/** The owner-question card's words; English by default where the card is used outside the Team drawer. */
export type QuestionCardWords = {
  justNow: string
  typeAnswer: string
  typedAnswer: string
  sendAnswer: string
  send: string
  answerOnDesktop: string
  openLink: (link: string) => string
  answerOption: (option: string) => string
}

type Words = QuestionCardWords & {
  forYou: (count: number) => string
  noQuestions: string
  reading: string
  updateOrca: string
  waitingOnLead: (count: number) => string
  nothingWaits: string
  threads: (count: number) => string
  noMemberWrote: string
  answered: (count: number) => string
  kind: Record<GameWaitingItem['kind'], string>
  answeredBy: (who: string) => string
  youReplaced: string
  thread: (open: boolean, ticket: string, count: number) => string
  waiting: (count: number) => string
  lastOf: (shown: number, count: number) => string
  rejected: string
  failed: string
}

export const QUESTION_CARD_ENGLISH: QuestionCardWords = {
  justNow: 'just now',
  typeAnswer: 'Type an answer',
  typedAnswer: 'Typed answer',
  sendAnswer: 'Send answer',
  send: 'Send',
  answerOnDesktop: 'Answer this one from Orca on the desktop.',
  openLink: (link) => `Open ${link}`,
  answerOption: (option) => `Answer ${option}`
}

const WORDS: Record<SupportedUiLocale, Words> = {
  en: {
    ...QUESTION_CARD_ENGLISH,
    forYou: (count) => `For you (${count})`,
    noQuestions: 'No questions are waiting for you.',
    reading: "Reading the lead's Inbox…",
    updateOrca: "Update Orca on this computer to read the lead's Inbox here.",
    waitingOnLead: (count) => `Waiting on the lead (${count})`,
    nothingWaits: 'Nothing waits on the lead.',
    threads: (count) => `Threads (${count})`,
    noMemberWrote: 'No member has written yet.',
    answered: (count) => `Answered (${count})`,
    kind: { question: 'Question', decision_gate: 'Decision' },
    answeredBy: (who) => `Answered by ${who}`,
    youReplaced: "You replaced the lead's answer",
    thread: (open, ticket, count) =>
      `${open ? 'Close' : 'Open'} the ${ticket} thread, ${count} message${count === 1 ? '' : 's'}`,
    waiting: (count) => `${count} waiting`,
    lastOf: (shown, count) => `Last ${shown} of ${count}; the rest are on the computer.`,
    rejected: 'Rejected',
    failed: 'Failed'
  },
  es: {
    justNow: 'ahora',
    typeAnswer: 'Escribe una respuesta',
    typedAnswer: 'Respuesta escrita',
    sendAnswer: 'Enviar respuesta',
    send: 'Enviar',
    answerOnDesktop: 'Responde esta desde Orca en el escritorio.',
    openLink: (link) => `Abrir ${link}`,
    answerOption: (option) => `Responder ${option}`,
    forYou: (count) => `Para ti (${count})`,
    noQuestions: 'No hay preguntas esperándote.',
    reading: 'Leyendo la Bandeja del lead…',
    updateOrca: 'Actualiza Orca en esta computadora para leer aquí la Bandeja del lead.',
    waitingOnLead: (count) => `Esperando al lead (${count})`,
    nothingWaits: 'Nada espera al lead.',
    threads: (count) => `Hilos (${count})`,
    noMemberWrote: 'Ningún miembro ha escrito todavía.',
    answered: (count) => `Respondidas (${count})`,
    kind: { question: 'Pregunta', decision_gate: 'Decisión' },
    answeredBy: (who) => `Respondida por ${who}`,
    youReplaced: 'Reemplazaste la respuesta del lead',
    thread: (open, ticket, count) =>
      `${open ? 'Cerrar' : 'Abrir'} el hilo de ${ticket}, ${count} mensaje${count === 1 ? '' : 's'}`,
    waiting: (count) => `${count} esperando`,
    lastOf: (shown, count) => `Últimos ${shown} de ${count}; el resto está en la computadora.`,
    rejected: 'Rechazado',
    failed: 'Falló'
  }
}

export const teamInboxWordsOf = (locale: SupportedUiLocale): Words => WORDS[locale]
export type TeamInboxWords = Words
