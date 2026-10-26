import type { QuestCommand } from './quest-policy'
import { arcadeCommandOf, isQuestMode, questCommandOf } from './quest-policy'
import { gameStrings } from './game-strings'

// Why skills: the engine refuses a `:` in a name a mod registers, and plugin skills get `orca-game:`.

/** Answered by the mod from a fresh `orca game state`. */
export const STATE_COMMAND = 'orca-game:state'

/** Lists and changes the Panel's sections; answered by the mod. */
export const LAYOUT_COMMAND = 'orca-game:layout'

/** Lists the game's views and switches this pane, this project or every project; answered by the mod. */
export const VIEW_COMMAND = 'orca-game:view'

/** The game's commands under `/orca-game:`, each a plugin skill the mod answers itself. */
export const GAME_COMMANDS = [
  'orca-game:quest',
  'orca-game:mode',
  'orca-game:render',
  'orca-game:demo'
] as const

/** The short form the mod registers; unlike a skill it also runs while a turn streams. */
export const QUEST_ALIAS = 'quest'

export type GameCommand = (typeof GAME_COMMANDS)[number] | typeof QUEST_ALIAS

/** What one of the game's commands asks for: `mode` and `render` take only their own words. */
export const gameCommandOf = (command: GameCommand, args: string): QuestCommand => {
  const asked = args.trim().toLowerCase().split(/\s+/)[0] ?? ''
  switch (command) {
    case 'orca-game:demo':
      return arcadeCommandOf(asked) ?? { demo: true }
    case 'orca-game:mode':
      if (asked === '' || isQuestMode(asked)) {
        return questCommandOf(asked)
      }
      return { error: gameStrings().text.unknownMode(asked) }
    case 'orca-game:render':
      return asked === '' ? { show: true } : questCommandOf(`render ${asked}`)
    case 'orca-game:quest':
    case QUEST_ALIAS:
      return questCommandOf(args)
  }
}
