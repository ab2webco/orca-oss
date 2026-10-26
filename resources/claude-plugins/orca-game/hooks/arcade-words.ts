import type { GameLocale } from '../types'
import { gameLocale } from './game-strings'

/** The words of the arcade's pane and of `/orca-game:demo arcade`. */
export type ArcadeWords = {
  opened: string
  title: string
  jump: string
  ready: string
  paused: string
  over: (score: number) => string
}

const EN: ArcadeWords = {
  opened:
    'Arcade: practice run in its own pane. j jumps; it earns no points or XP and closes with q or Esc.',
  title: 'Arcade · practice',
  jump: 'jump',
  ready: 'j to run',
  paused: 'Paused · j to go on',
  over: (score) => `Game over · ${score} · j to run again`
}

const ES: ArcadeWords = {
  opened:
    'Arcade: partida de práctica en su propio panel. j salta; no da puntos ni XP y se cierra con q o Esc.',
  title: 'Arcade · práctica',
  jump: 'saltar',
  ready: 'j para correr',
  paused: 'En pausa · j para seguir',
  over: (score) => `Fin · ${score} · j para otra`
}

const WORDS: Readonly<Record<GameLocale, ArcadeWords>> = { en: EN, es: ES }

export const arcadeWords = (): ArcadeWords => WORDS[gameLocale()]
