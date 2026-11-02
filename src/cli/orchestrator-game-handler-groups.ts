import type { HandlerGroup } from './handler-group-manifest'

/** The Agent Teams game's `orca game …` commands, one group per handler module. */
export const ORCHESTRATOR_GAME_HANDLER_GROUPS: readonly HandlerGroup[] = [
  {
    name: 'orchestrator-game',
    keys: ['game state', 'game lead', 'game open-link'],
    load: async () => (await import('./handlers/orchestrator-game.js')).ORCHESTRATOR_GAME_HANDLERS
  },
  {
    name: 'orchestrator-game-launch',
    keys: ['game launch'],
    load: async () =>
      (await import('./handlers/orchestrator-game-launch.js')).ORCHESTRATOR_GAME_LAUNCH_HANDLERS
  },
  {
    name: 'orchestrator-game-fleet',
    keys: ['game fleet', 'game wave', 'game sweep', 'game push', 'game stop'],
    load: async () =>
      (await import('./handlers/orchestrator-game-fleet.js')).ORCHESTRATOR_GAME_FLEET_HANDLERS
  },
  {
    name: 'orchestrator-game-watch',
    keys: ['game watch'],
    load: async () =>
      (await import('./handlers/orchestrator-game-watch.js')).ORCHESTRATOR_GAME_WATCH_HANDLERS
  },
  {
    name: 'orchestrator-game-view',
    keys: ['game view'],
    load: async () =>
      (await import('./handlers/orchestrator-game-view.js')).ORCHESTRATOR_GAME_VIEW_HANDLERS
  },
  {
    name: 'orchestrator-game-move',
    keys: ['game move'],
    load: async () =>
      (await import('./handlers/orchestrator-game-move.js')).ORCHESTRATOR_GAME_MOVE_HANDLERS
  },
  {
    name: 'orchestrator-game-rebind',
    keys: ['game rebind'],
    load: async () =>
      (await import('./handlers/orchestrator-game-rebind.js')).ORCHESTRATOR_GAME_REBIND_HANDLERS
  },
  {
    name: 'orchestrator-game-accounts',
    keys: ['game accounts'],
    load: async () =>
      (await import('./handlers/orchestrator-game-accounts.js')).ORCHESTRATOR_GAME_ACCOUNTS_HANDLERS
  },
  {
    name: 'orchestrator-game-member',
    keys: ['game member'],
    load: async () =>
      (await import('./handlers/orchestrator-game-member.js')).ORCHESTRATOR_GAME_MEMBER_HANDLERS
  },
  {
    name: 'orchestrator-game-history',
    keys: ['game history'],
    load: async () =>
      (await import('./handlers/orchestrator-game-history.js')).ORCHESTRATOR_GAME_HISTORY_HANDLERS
  },
  {
    name: 'orchestrator-game-metrics',
    keys: ['game metrics'],
    load: async () =>
      (await import('./handlers/orchestrator-game-metrics.js')).ORCHESTRATOR_GAME_METRICS_HANDLERS
  },
  {
    name: 'orchestrator-game-events',
    keys: ['game events', 'game event'],
    load: async () =>
      (await import('./handlers/orchestrator-game-events.js')).ORCHESTRATOR_GAME_EVENT_HANDLERS
  },
  {
    name: 'orchestrator-game-hold',
    keys: ['game resume'],
    load: async () =>
      (await import('./handlers/orchestrator-game-hold.js')).ORCHESTRATOR_GAME_HOLD_HANDLERS
  },
  {
    name: 'orchestrator-game-resume-members',
    keys: ['game resume-members'],
    load: async () =>
      (await import('./handlers/orchestrator-game-resume-members.js'))
        .ORCHESTRATOR_GAME_RESUME_MEMBERS_HANDLERS
  },
  {
    name: 'orchestrator-game-inbox',
    keys: ['game inbox'],
    load: async () =>
      (await import('./handlers/orchestrator-game-inbox.js')).ORCHESTRATOR_GAME_INBOX_HANDLERS
  },
  {
    name: 'orchestrator-game-owner-questions',
    keys: ['game ask-owner', 'game owner-questions', 'game answer-owner'],
    load: async () =>
      (await import('./handlers/orchestrator-game-owner-questions.js'))
        .ORCHESTRATOR_GAME_OWNER_QUESTION_HANDLERS
  },
  {
    name: 'orchestrator-game-leads',
    keys: ['game leads'],
    load: async () =>
      (await import('./handlers/orchestrator-game-leads.js')).ORCHESTRATOR_GAME_LEADS_HANDLERS
  },
  {
    name: 'orchestrator-game-scenes',
    keys: ['game scene new', 'game scene validate', 'game scene list'],
    load: async () =>
      (await import('./handlers/orchestrator-game-scenes.js')).ORCHESTRATOR_GAME_SCENE_HANDLERS
  },
  {
    name: 'orchestrator-game-arcade',
    keys: ['game game validate'],
    load: async () =>
      (await import('./handlers/orchestrator-game-arcade.js')).ORCHESTRATOR_GAME_ARCADE_HANDLERS
  }
]
