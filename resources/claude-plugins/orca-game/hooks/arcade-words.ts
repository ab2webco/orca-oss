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
  /** The scene's line when a perfect merge saves a play. */
  saved: string
  over: (score: number) => string
  /** A run that ended above the best before it. */
  best: (score: number) => string
  level: (level: number) => string
  /** The top line's left end: the best so far and the level. */
  hud: (best: number, level: number) => string
}

const EN: ArcadeWords = {
  opened:
    'Arcade: practice run in its own pane. j jumps; it earns no points or XP and closes with q or Esc.',
  offered:
    'Arcade: a demo of a perfect merge. A real one saves a play you start from the Team panel; the demo saves none.',
  title: 'Arcade · practice',
  jump: 'jump',
  ready: 'j to run',
  paused: 'Paused · j to go on',
  held: 'On hold · someone needs you',
  saved: 'Play saved · start it from the Team panel',
  over: (score) => `Game over · ${score} · j to run again`,
  best: (score) => `New best · ${score} · j to run again`,
  level: (level) => `Level ${level} · faster`,
  hud: (best, level) => (best > 0 ? `best ${best} · lv ${level}` : `lv ${level}`)
}

const ES: ArcadeWords = {
  opened:
    'Arcade: partida de práctica en su propio panel. j salta; no da puntos ni XP y se cierra con q o Esc.',
  offered:
    'Arcade: prueba de un merge perfecto. Uno real guarda una partida que inicias desde el panel de Equipo; la prueba no guarda ninguna.',
  title: 'Arcade · práctica',
  jump: 'saltar',
  ready: 'j para correr',
  paused: 'En pausa · j para seguir',
  held: 'En espera · alguien te necesita',
  saved: 'Partida guardada · iníciala desde el panel de Equipo',
  over: (score) => `Fin · ${score} · j para otra`,
  best: (score) => `Nuevo récord · ${score} · j para otra`,
  level: (level) => `Nivel ${level} · más rápido`,
  hud: (best, level) => (best > 0 ? `récord ${best} · nv ${level}` : `nv ${level}`)
}

const WORDS: Readonly<Record<GameLocale, ArcadeWords>> = { en: EN, es: ES }

export const arcadeWords = (): ArcadeWords => WORDS[gameLocale()]
