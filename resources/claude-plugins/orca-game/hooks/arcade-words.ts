import type { GameLocale } from '../types'
import { gameLocale } from './game-strings'

/** The words of the arcade's pane and of `/orca-game:demo arcade`. */
export type ArcadeWords = {
  opened: string
  offered: string
  title: string
  jump: string
  ready: string
  paused: string
  held: string
  offerTitle: string
  unlocked: string
  offerLeft: (seconds: number) => string
  offerHeld: (seconds: number) => string
  /** How to give the offer the keyboard while the prompt holds it. */
  offerReach: string
  play: string
  pass: string
  over: (score: number) => string
}

const EN: ArcadeWords = {
  opened:
    'Arcade: practice run in its own pane. j jumps; it earns no points or XP and closes with q or Esc.',
  offered:
    'Arcade: a demo offer of a run. j plays, n passes; it closes by itself when the countdown ends and keeps no points.',
  title: 'Arcade · practice',
  jump: 'jump',
  ready: 'j to run',
  paused: 'Paused · j to go on',
  held: 'On hold · someone needs you',
  offerTitle: 'Arcade · unlocked',
  unlocked: 'Arcade unlocked!',
  offerLeft: (seconds) => `A run is yours · ${seconds}s to choose`,
  offerHeld: (seconds) => `On hold · someone needs you · ${seconds}s left`,
  offerReach: 'ctrl+x tab, then j',
  play: 'play',
  pass: 'pass',
  over: (score) => `Game over · ${score} · j to run again`
}

const ES: ArcadeWords = {
  opened:
    'Arcade: partida de práctica en su propio panel. j salta; no da puntos ni XP y se cierra con q o Esc.',
  offered:
    'Arcade: oferta de prueba de una partida. j juega, n pasa; se cierra sola al acabar la cuenta y no guarda puntos.',
  title: 'Arcade · práctica',
  jump: 'saltar',
  ready: 'j para correr',
  paused: 'En pausa · j para seguir',
  held: 'En espera · alguien te necesita',
  offerTitle: 'Arcade · desbloqueado',
  unlocked: '¡Arcade desbloqueado!',
  offerLeft: (seconds) => `Te ganaste una partida · ${seconds}s para elegir`,
  offerHeld: (seconds) => `En espera · alguien te necesita · quedan ${seconds}s`,
  offerReach: 'ctrl+x tab y luego j',
  play: 'jugar',
  pass: 'pasar',
  over: (score) => `Fin · ${score} · j para otra`
}

const WORDS: Readonly<Record<GameLocale, ArcadeWords>> = { en: EN, es: ES }

export const arcadeWords = (): ArcadeWords => WORDS[gameLocale()]
