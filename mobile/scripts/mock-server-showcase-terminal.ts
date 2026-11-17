// Scripted agent output for MOCK_SCENARIO=showcase; lines stay under ~40 columns for a phone.
const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const GREEN = '\x1b[32m'
const CYAN = '\x1b[36m'
const MAGENTA = '\x1b[35m'
const YELLOW = '\x1b[33m'
const RED = '\x1b[31m'
const RESET = '\x1b[0m'

const tool = (name: string, arg: string) => `${GREEN}●${RESET} ${BOLD}${name}${RESET} ${arg}\n`
const say = (text: string) => `${CYAN}●${RESET} ${text}\n`
const out = (text: string) => `  ${DIM}⎿${RESET} ${text}\n`

type TerminalScript = { scrollback: string; chunks: string[]; reply: string[] }

const FEED: TerminalScript = {
  scrollback: [
    `${DIM}~/code/lumen-app/offline-feed${RESET}\n`,
    `${MAGENTA}>${RESET} LUM-14: cache the feed for\n`,
    '  offline reading\n',
    '\n',
    say('Plan: one cache, then tests.')
  ].join(''),
  chunks: [
    tool('Read', 'FeedStore.ts'),
    out('146 lines'),
    tool('Read', 'feed/cache.ts'),
    out('64 lines'),
    say('The feed hits the network twice.'),
    say('Moving reads behind FeedCache.'),
    tool('Update', 'FeedStore.ts'),
    `  ${GREEN}+ const cache = new FeedCache(db)${RESET}\n`,
    `  ${GREEN}+ return cache.read(page)${RESET}\n`,
    `  ${RED}- return api.feed(page)${RESET}\n`,
    tool('Bash', 'pnpm test feed-cache'),
    out(`${GREEN}✓${RESET} cache.test.ts ${DIM}(12)${RESET}`),
    out(`${GREEN}✓${RESET} FeedStore.test.ts ${DIM}(8)${RESET}`),
    say('Tests pass. Pushing to PR #42.'),
    `\n${MAGENTA}>${RESET} `
  ],
  reply: [
    say('Adding a 7-day expiry.'),
    tool('Update', 'feed/cache.ts'),
    `  ${GREEN}+ const MAX_AGE = 7 * DAY${RESET}\n`,
    tool('Bash', 'pnpm test feed-cache'),
    out(`${GREEN}✓${RESET} 21 tests passed`),
    say('Done. Old posts drop after 7 days.'),
    `\n${MAGENTA}>${RESET} `
  ]
}

const LEAD: TerminalScript = {
  scrollback: [
    `${DIM}~/code/lumen-app${RESET}\n`,
    `${BOLD}Atlas${RESET} · lumen-app · 5 members\n`,
    '\n',
    say('Pico is on LUM-14, PR #42.'),
    say('Nova: LUM-25 CI is red on'),
    '  the upload sandbox.\n',
    say('Asked you about push opt-in.')
  ].join(''),
  chunks: [
    tool('Plane', 'LUM-23 → In Progress'),
    say('Orin is building the push'),
    '  opt-in screen on render-01.\n',
    tool('CI', `#45 ${GREEN}passed${RESET}`),
    say('Vega: LUM-21 ready to merge.'),
    `\n${MAGENTA}>${RESET} `
  ],
  reply: [say('Noted. Relaying to the team.'), `\n${MAGENTA}>${RESET} `]
}

export function showcaseTerminalScript(handle: string): TerminalScript {
  return handle === 'term-lead' ? LEAD : FEED
}

/** The lines the lead's terminal prints when the owner answers from the phone. */
export function showcaseAnswerChunks(
  ticket: string | null,
  answer: string,
  memberName: string | null
): string[] {
  const about = ticket ? ` ${ticket}` : ''
  const to = memberName ?? 'the team'
  return [
    `\n${YELLOW}◆ Owner answered${about}:${RESET} ${BOLD}${answer}${RESET}\n`,
    say(`Relaying "${answer}" to ${to}.`),
    tool('Send', `${to} · ${ticket ?? 'team'}`),
    `\n${MAGENTA}>${RESET} `
  ]
}
