import type { GameLocale } from '../types'
import { gameLocale } from './game-strings'
import type { GameViewCost, GameViewId } from './game-view'

/** Where a view goes: this pane's session, this repo on this machine, or every project. */
export type ViewScope = 'pane' | 'project' | 'global'

/** The words of `/orca-game:view` and the Panel's view selector. */
export type ViewWords = {
  names: Readonly<Record<GameViewId, string>>
  costs: Readonly<Record<GameViewCost, string>>
  scopes: Readonly<Record<ViewScope, string>>
  listTitle: string
  /** The pick line, naming only the scopes this Orca can store a view in. */
  help: (scopes: readonly ViewScope[]) => string
  setPane: (view: string) => string
  stored: (view: string, scope: ViewScope) => string
  /** Stored for every project while this project's own layer keeps `shown`. */
  storedShadowed: (view: string, shown: string) => string
  notStored: (view: string, scope: ViewScope) => string
  unknownView: (asked: string) => string
  unknownScope: (asked: string) => string
  /** The Panel's chip that opens the selector, with the view shown now. */
  menu: (view: string) => string
  /** Before the Panel's scope chips. */
  where: string
  /** Why the Panel offers this pane only. */
  paneOnly: string
}

const IDS = 'off, flat, zen, 2d-classic or 2d-hd'

const EN: ViewWords = {
  names: { off: 'Off', flat: 'Flat', zen: 'Zen', '2d-classic': '2D classic', '2d-hd': '2D hd' },
  costs: { light: 'light', medium: 'medium', heavy: 'heavy' },
  scopes: { pane: 'this pane', project: 'this project', global: 'every project' },
  listTitle: 'Game views (● now, ★ suggested for this machine):',
  help: (scopes) => {
    if (scopes.length === 1) {
      return '/orca-game:view <view>: changes this pane only; this Orca cannot store a view for a project or every project.'
    }
    const parts = [
      'pane (the default) changes this pane only',
      ...(scopes.includes('project') ? ['project stores it for this project on this machine'] : []),
      ...(scopes.includes('global') ? ['global for every project'] : [])
    ]
    return `/orca-game:view <view> [${scopes.join('|')}]: ${parts.join(', ')}.`
  },
  setPane: (view) => `View: ${view}, this pane only.`,
  stored: (view, scope) =>
    `View: ${view}, saved for ${scope === 'project' ? 'this project on this machine' : 'every project'}.`,
  storedShadowed: (view, shown) =>
    `View: ${view}, saved for every project; this project's own setting keeps ${shown} here.`,
  notStored: (view, scope) =>
    `View: ${view}, this pane only: this Orca could not store it for ${EN.scopes[scope]}.`,
  unknownView: (asked) => `Unknown view "${asked}". Use /orca-game:view ${IDS}.`,
  unknownScope: (asked) => `Unknown scope "${asked}". Use pane, project or global.`,
  menu: (view) => `View: ${view}`,
  where: 'For',
  paneOnly: 'This Orca can change this pane only.'
}

const ES: ViewWords = {
  names: {
    off: 'Apagado',
    flat: 'Plano',
    zen: 'Zen',
    '2d-classic': '2D clásico',
    '2d-hd': '2D hd'
  },
  costs: { light: 'ligera', medium: 'media', heavy: 'pesada' },
  scopes: { pane: 'este panel', project: 'este proyecto', global: 'todos los proyectos' },
  listTitle: 'Vistas del juego (● ahora, ★ sugerida para esta máquina):',
  help: (scopes) => {
    if (scopes.length === 1) {
      return '/orca-game:view <vista>: cambia solo este panel; este Orca no puede guardar una vista para un proyecto ni para todos.'
    }
    const parts = [
      'pane (por defecto) cambia solo este panel',
      ...(scopes.includes('project')
        ? ['project la guarda para este proyecto en esta máquina']
        : []),
      ...(scopes.includes('global') ? ['global la guarda para todos los proyectos'] : [])
    ]
    const last = parts.pop()
    return `/orca-game:view <vista> [${scopes.join('|')}]: ${parts.join(', ')} y ${last}.`
  },
  setPane: (view) => `Vista: ${view}, solo este panel.`,
  stored: (view, scope) =>
    `Vista: ${view}, guardada para ${scope === 'project' ? 'este proyecto en esta máquina' : 'todos los proyectos'}.`,
  storedShadowed: (view, shown) =>
    `Vista: ${view}, guardada para todos los proyectos; la configuración propia de este proyecto mantiene ${shown} aquí.`,
  notStored: (view, scope) =>
    `Vista: ${view}, solo este panel: este Orca no pudo guardarla para ${ES.scopes[scope]}.`,
  unknownView: (asked) =>
    `Vista desconocida "${asked}". Usa /orca-game:view ${IDS.replace(' or ', ' o ')}.`,
  unknownScope: (asked) => `Alcance desconocido "${asked}". Usa pane, project o global.`,
  menu: (view) => `Vista: ${view}`,
  where: 'Para',
  paneOnly: 'Este Orca solo puede cambiar este panel.'
}

const CATALOG: Readonly<Record<GameLocale, ViewWords>> = { en: EN, es: ES }

export const viewWords = (locale: GameLocale = gameLocale()): ViewWords => CATALOG[locale]
