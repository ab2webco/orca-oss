import type { GameLocale, ScenePhase } from '../types'
import { gameLocale } from './game-strings'

/** One kind of call a collapsed tool line counts. */
export type ToolKind = 'read' | 'command' | 'search' | 'web' | 'other'

/** The words of a message's heading row and of a collapsed tool line. */
export type MessageHeadingWords = {
  /** The phase a message was written in, as in "Castillo · reviewing". */
  phases: Readonly<Record<ScenePhase, string>>
  /** In place of the phase, for a question to the person. */
  asksYou: string
  /** One kind's count, lower case; the line capitalises its first. */
  toolCounts: Readonly<Record<ToolKind, (count: number) => string>>
}

const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`

const EN: MessageHeadingWords = {
  phases: {
    working: 'working',
    docs: 'writing docs',
    build: 'building',
    verify: 'reviewing',
    pr: 'opening the PR',
    handoff: 'handing off'
  },
  asksYou: 'asks you',
  toolCounts: {
    read: (count) => `read ${plural(count, 'file', 'files')}`,
    command: (count) => `ran ${plural(count, 'command', 'commands')}`,
    search: (count) => `searched ${plural(count, 'pattern', 'patterns')}`,
    web: (count) => `looked up ${plural(count, 'page', 'pages')}`,
    other: (count) => `used ${plural(count, 'tool', 'tools')}`
  }
}

const ES: MessageHeadingWords = {
  phases: {
    working: 'trabajando',
    docs: 'documentando',
    build: 'construyendo',
    verify: 'revisando',
    pr: 'abriendo el PR',
    handoff: 'entregando'
  },
  asksYou: 'te pregunta',
  toolCounts: {
    read: (count) => `leyó ${plural(count, 'archivo', 'archivos')}`,
    command: (count) => `ejecutó ${plural(count, 'comando', 'comandos')}`,
    search: (count) => `buscó ${plural(count, 'patrón', 'patrones')}`,
    web: (count) => `consultó ${plural(count, 'página', 'páginas')}`,
    other: (count) => `usó ${plural(count, 'herramienta', 'herramientas')}`
  }
}

export const MESSAGE_HEADING_WORDS: Readonly<Record<GameLocale, MessageHeadingWords>> = {
  en: EN,
  es: ES
}

export const messageHeadingWords = (): MessageHeadingWords => MESSAGE_HEADING_WORDS[gameLocale()]
