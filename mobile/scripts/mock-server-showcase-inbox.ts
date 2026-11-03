// The showcase lead's Inbox for the Team drawer's Inbox tab (ORCA-961); every name is made up.
import type {
  GameInboxThreads,
  GameThreadMessage
} from '../../src/shared/orchestrator-game-inbox-threads'

const minutesAgo = (minutes: number): string =>
  new Date(Date.now() - minutes * 60_000).toISOString()

const message = (
  id: string,
  from: string,
  to: string,
  kind: string,
  subject: string,
  body: string,
  minutes: number
): GameThreadMessage => ({
  id,
  at: minutesAgo(minutes),
  from,
  to,
  kind,
  subject,
  body,
  failure: null
})

export function createShowcaseInboxThreads(): GameInboxThreads {
  const iris = [
    message(
      'm-216-1',
      'ACME-216',
      'lead',
      'status',
      'Started',
      'Reading the webhook worker and its retry table.',
      52
    ),
    message(
      'm-216-2',
      'ACME-216',
      'lead',
      'decision_gate',
      'Retry ceiling for failed webhooks',
      'Stop at 8 attempts with exponential backoff, or keep retrying for 24 hours?',
      6
    )
  ]
  const leo = [
    message(
      'm-214-1',
      'ACME-214',
      'lead',
      'escalation',
      'Sandbox key missing on CI',
      'The payment sandbox job has no SANDBOX_KEY secret, so every run fails at setup.',
      41
    ),
    message(
      'm-214-2',
      'lead',
      'ACME-214',
      'reply',
      'Re: Sandbox key missing on CI',
      'Use the test key from the vault entry acme-sandbox and mark the job required.',
      35
    ),
    message(
      'm-214-3',
      'ACME-214',
      'lead',
      'status',
      'CI rerun',
      'Rerunning with the key; two flaky specs left.',
      12
    )
  ]
  const theo = [
    message(
      'm-205-1',
      'ACME-205',
      'lead',
      'question',
      'Invoice footer colour',
      'Keep the brand footer in dark mode or switch to the neutral grey?',
      95
    ),
    message(
      'm-205-2',
      'lead',
      'ACME-205',
      'answer',
      'Re: Invoice footer colour',
      'Neutral grey; the brand footer stays for print.',
      90
    ),
    message(
      'm-205-3',
      'ACME-205',
      'lead',
      'worker_done',
      'Dark mode ready for review',
      'PR 409 is green with screenshots at four widths.',
      30
    )
  ]
  return {
    threads: [
      { ticket: 'ACME-216', messages: iris, last: iris[1].at, waiting: 1 },
      { ticket: 'ACME-214', messages: leo, last: leo[2].at, waiting: 0 },
      { ticket: 'ACME-205', messages: theo, last: theo[2].at, waiting: 0 }
    ],
    waiting: [
      {
        id: 'm-216-2',
        ticket: 'ACME-216',
        kind: 'decision_gate',
        subject: iris[1].subject,
        body: iris[1].body,
        at: iris[1].at,
        answerer: 'lead'
      }
    ],
    answered: [
      {
        id: 'm-205-1',
        ticket: 'ACME-205',
        kind: 'question',
        question: theo[0].body,
        answer: theo[1].body,
        askedAt: theo[0].at,
        answeredAt: theo[1].at
      }
    ]
  }
}
