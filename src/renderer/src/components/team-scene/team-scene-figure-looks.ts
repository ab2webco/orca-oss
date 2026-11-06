import type { TeamSceneActor } from '../../../../shared/team-scene/team-scene-types'

export type FigureHat = 'crown' | 'helm' | 'cap' | 'band' | 'wizard'
export type FigureTool = 'sword' | 'shield' | 'hammer' | 'staff'

export type FigureLook = {
  body: string
  trim: string
  cape: string
  leg: string
  skin: string
  hat: FigureHat
  tool: FigureTool
}

// Scene art, not UI: these never carry a status meaning, which the emotes alone draw.
const LEAD: FigureLook = {
  body: '#2f5fb3',
  trim: '#f2c94c',
  cape: '#b3263a',
  leg: '#28324a',
  skin: '#f1c6a0',
  hat: 'crown',
  tool: 'sword'
}
const ADVISOR: FigureLook = {
  body: '#c79a2e',
  trim: '#fff1c2',
  cape: '#8c6a18',
  leg: '#4a3a18',
  skin: '#f1c6a0',
  hat: 'wizard',
  tool: 'staff'
}
const OUTFITS: readonly Pick<FigureLook, 'body' | 'trim' | 'cape' | 'leg'>[] = [
  { body: '#aab4c4', trim: '#6d7a90', cape: '#3a5b8c', leg: '#59647a' },
  { body: '#3f8f5b', trim: '#c9a24b', cape: '#2b6143', leg: '#5b4630' },
  { body: '#8a5a34', trim: '#3b2a1e', cape: '#5c3b22', leg: '#3b3029' },
  { body: '#5b3fa8', trim: '#c7b3ff', cape: '#3e2a7a', leg: '#2e2452' },
  { body: '#b5332e', trim: '#f2c94c', cape: '#7a1f1c', leg: '#3a2424' },
  { body: '#2f7d86', trim: '#d8efe9', cape: '#1d4f55', leg: '#29393c' }
]
const SKINS = ['#f1c6a0', '#e6b48c', '#d9a077', '#c98f66', '#8a5a3c'] as const
const HATS: readonly FigureHat[] = ['helm', 'cap', 'band', 'wizard']
const TOOLS: readonly FigureTool[] = ['sword', 'shield', 'hammer', 'staff']

// FNV-1a: stable across hosts and runs, so a character keeps its look everywhere.
function hashOf(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  }
  return h >>> 0
}

/** The lead wears the crown; a member's look follows its persistent character, not its pane. */
export function figureLookOf(
  actor: Pick<TeamSceneActor, 'role' | 'key' | 'characterKey'>
): FigureLook {
  if (actor.role === 'lead') {
    return LEAD
  }
  if (actor.role === 'advisor') {
    return ADVISOR
  }
  const h = hashOf(actor.characterKey ?? actor.key)
  return {
    ...OUTFITS[h % OUTFITS.length]!,
    skin: SKINS[(h >>> 4) % SKINS.length]!,
    hat: HATS[(h >>> 8) % HATS.length]!,
    tool: TOOLS[(h >>> 12) % TOOLS.length]!
  }
}
