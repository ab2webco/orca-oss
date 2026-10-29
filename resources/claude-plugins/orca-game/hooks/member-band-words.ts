import type { GameLocale } from '../types'
import { gameLocale } from './game-strings'

/** The words of a member band's own menu. */
export type MemberBandWords = {
  collapse: string
  expand: string
}

const EN: MemberBandWords = { collapse: 'Collapse', expand: 'Expand' }

const ES: MemberBandWords = { collapse: 'Plegar', expand: 'Desplegar' }

const WORDS: Readonly<Record<GameLocale, MemberBandWords>> = { en: EN, es: ES }

export const memberBandWords = (): MemberBandWords => WORDS[gameLocale()]
