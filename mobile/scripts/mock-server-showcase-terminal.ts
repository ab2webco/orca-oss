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

const CHECKOUT: TerminalScript = {
  scrollback: [
    `${DIM}~/code/acme-web/checkout-summary${RESET}\n`,
    `${MAGENTA}>${RESET} ACME-212: redesign the checkout\n`,
    '  summary card\n',
    '\n',
    say('Plan: totals row, then tests.')
  ].join(''),
  chunks: [
    tool('Read', 'SummaryCard.tsx'),
    out('212 lines'),
    tool('Read', 'checkout/totals.ts'),
    out('88 lines'),
    say('Totals render in three places.'),
    say('Moving them into one TotalsRow.'),
    tool('Update', 'SummaryCard.tsx'),
    `  ${GREEN}+ <TotalsRow label="Shipping" />${RESET}\n`,
    `  ${GREEN}+ <TotalsRow label="Total" bold />${RESET}\n`,
    `  ${RED}- <div className="totals">${RESET}\n`,
    tool('Bash', 'pnpm test checkout'),
    out(`${GREEN}✓${RESET} totals.test.ts ${DIM}(14)${RESET}`),
    out(`${GREEN}✓${RESET} SummaryCard.test.tsx ${DIM}(9)${RESET}`),
    say('Tests pass. Pushing to PR #412.'),
    `\n${MAGENTA}>${RESET} `
  ],
  reply: [
    say('Adding a tax line under Shipping.'),
    tool('Update', 'SummaryCard.tsx'),
    `  ${GREEN}+ <TotalsRow label="Tax" />${RESET}\n`,
    tool('Bash', 'pnpm test checkout'),
    out(`${GREEN}✓${RESET} 24 tests passed`),
    say('Done. Tax shows above Total.'),
    `\n${MAGENTA}>${RESET} `
  ]
}

const LEAD: TerminalScript = {
  scrollback: [
    `${DIM}~/code/acme-web${RESET}\n`,
    `${BOLD}Lead${RESET} · acme-web · 5 members\n`,
    '\n',
    say('Maya is on ACME-212, PR #412.'),
    say('Leo: ACME-214 CI is red on'),
    '  the payment sandbox timeout.\n',
    say('Asked you about the timeout.')
  ].join(''),
  chunks: [
    tool('Plane', 'ACME-216 → In Progress'),
    say('Iris is waiting on a retry'),
    '  policy for ACME-216.\n',
    tool('CI', `#409 ${GREEN}passed${RESET}`),
    say('Theo: ACME-205 ready to merge.'),
    `\n${MAGENTA}>${RESET} `
  ],
  reply: [say('Noted. Relaying to the team.'), `\n${MAGENTA}>${RESET} `]
}

export function showcaseTerminalScript(handle: string): TerminalScript {
  return handle === 'term-lead' ? LEAD : CHECKOUT
}

/** The lines the lead's terminal prints when the owner answers from the phone. */
export function showcaseAnswerChunks(ticket: string | null, answer: string): string[] {
  const about = ticket ? ` ${ticket}` : ''
  return [
    `\n${YELLOW}◆ Owner answered${about}:${RESET} ${BOLD}${answer}${RESET}\n`,
    say(`Relaying "${answer}" to Iris.`),
    tool('Send', `Iris · ${ticket ?? 'team'}`),
    `\n${MAGENTA}>${RESET} `
  ]
}
