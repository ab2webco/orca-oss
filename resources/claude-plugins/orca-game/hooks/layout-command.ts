import type { EngineInterface, On } from 'claude-code'

import { viewOf } from './fleet-sync'
import { LAYOUT_COMMAND } from './game-commands'
import { gameStrings } from './game-strings'
import {
  DEFAULT_FLEET_LAYOUT,
  PANEL_SECTIONS,
  hideSection,
  moveSection,
  panelSectionOf,
  projectKeyOf,
  showSection,
  type FleetLayout,
  type MoveDirection,
  type PanelSection
} from './panel-layout'
import { changeFleetLayout, readFleetLayout } from './panel-layout-store'
import { ready } from './quest-runtime'

type Verb = 'reset' | 'show' | 'hide' | 'move'

export type LayoutRequest =
  | { kind: 'list' }
  | { kind: 'change'; change: (layout: FleetLayout) => FleetLayout }
  | { kind: 'unknownSection'; asked: string }
  | { kind: 'usage' }

const VERBS: Readonly<Record<string, Verb>> = {
  reset: 'reset',
  restablecer: 'reset',
  show: 'show',
  mostrar: 'show',
  hide: 'hide',
  ocultar: 'hide',
  move: 'move',
  mover: 'move'
}

const DIRECTIONS: Readonly<Record<string, MoveDirection>> = {
  up: 'up',
  arriba: 'up',
  down: 'down',
  abajo: 'down'
}

/** What `/orca-game:layout <args>` asks for, in English or Spanish words. */
export const layoutRequestOf = (args: string): LayoutRequest => {
  const [verbWord = '', sectionWord = '', directionWord = '', ...rest] = args
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((one) => one !== '')
  if (verbWord === '') {
    return { kind: 'list' }
  }
  const verb = VERBS[verbWord]
  if (verb === 'reset') {
    return sectionWord === ''
      ? { kind: 'change', change: () => DEFAULT_FLEET_LAYOUT }
      : { kind: 'usage' }
  }
  if (verb === undefined || sectionWord === '' || rest.length > 0) {
    return { kind: 'usage' }
  }
  const section = panelSectionOf(sectionWord)
  if (section === null) {
    return { kind: 'unknownSection', asked: sectionWord }
  }
  if (verb === 'move') {
    const direction = DIRECTIONS[directionWord]
    return direction === undefined
      ? { kind: 'usage' }
      : { kind: 'change', change: (now) => moveSection(now, section, direction) }
  }
  if (directionWord !== '') {
    return { kind: 'usage' }
  }
  return {
    kind: 'change',
    change: (now) => (verb === 'show' ? showSection(now, section) : hideSection(now, section))
  }
}

const listingOf = (layout: FleetLayout): string => {
  const text = gameStrings().text
  const stateOf = (section: PanelSection) =>
    layout.hidden.includes(section)
      ? text.layoutStates.hidden
      : layout.collapsed.includes(section)
        ? text.layoutStates.collapsed
        : text.layoutStates.shown
  return [
    text.layoutHeading,
    ...layout.order.map(
      (section, at) =>
        `${at + 1}. ${text.layoutSections[section]} (${section}): ${stateOf(section)}`
    ),
    text.layoutUsage
  ].join('\n')
}

async function layoutText($: EngineInterface, args: string): Promise<string> {
  await ready($)
  const text = gameStrings().text
  const { state } = await viewOf($)
  const project = projectKeyOf(state?.worktree?.id)
  const request = layoutRequestOf(args)
  switch (request.kind) {
    case 'usage':
      return text.layoutUsage
    case 'unknownSection':
      return text.layoutUnknownSection(request.asked, PANEL_SECTIONS.join(', '))
    case 'change':
      if (!(await changeFleetLayout($, project, request.change))) {
        return text.layoutNewer
      }
      break
    case 'list':
      break
  }
  return listingOf(await readFleetLayout($, project))
}

export const registerLayoutCommand = (on: On): void => {
  // Why the mod answers: a layout change needs no model turn.
  on('command.run', { command: LAYOUT_COMMAND }, async ($, e) => {
    const text = await layoutText($, e.args)
    return { text, context: [text] }
  })
}
