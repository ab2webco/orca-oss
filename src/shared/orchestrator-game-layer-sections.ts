import { parseGameActions } from './orchestrator-game-actions'
import { parseGameActivityRules, parseGameLinkTemplates } from './orchestrator-game-integrations'
import { parseGameLead } from './orchestrator-game-lead'
import { parseGameOrcaActions } from './orchestrator-game-orca-actions'
import { parseGamePanel } from './orchestrator-game-panel'
import { parseGameReviewsSource, parseGameTodoSource } from './orchestrator-game-project-work'
import { parseGameRewardWeights } from './orchestrator-game-reward-weights'

/** The layer's nested sections, each parsed on its own and dropped when it yields nothing. */
export const ORCHESTRATOR_GAME_SECTION_PARSERS = {
  links: parseGameLinkTemplates,
  activity: parseGameActivityRules,
  actions: parseGameActions,
  orcaActions: parseGameOrcaActions,
  orchestrator: parseGameLead,
  rewardWeights: parseGameRewardWeights,
  panel: parseGamePanel,
  reviews: parseGameReviewsSource,
  todo: parseGameTodoSource
} satisfies Record<string, (raw: unknown) => { value: unknown; warnings: string[] }>
