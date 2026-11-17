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
  const pico = [
    message(
      'm-14-1',
      'LUM-14',
      'lead',
      'status',
      'Started',
      'Reading the feed store and its cache table.',
      52
    ),
    message(
      'm-14-2',
      'LUM-14',
      'lead',
      'decision_gate',
      'Cache size for the offline feed',
      'Keep the last 200 posts, or everything from the past 7 days?',
      6
    )
  ]
  const nova = [
    message(
      'm-25-1',
      'LUM-25',
      'lead',
      'escalation',
      'Upload sandbox missing on CI',
      'The photo upload job has no UPLOAD_SANDBOX_URL secret, so every run fails at setup.',
      41
    ),
    message(
      'm-25-2',
      'lead',
      'LUM-25',
      'reply',
      'Re: Upload sandbox missing on CI',
      'Use the sandbox URL from the vault entry lumen-uploads and mark the job required.',
      35
    ),
    message(
      'm-25-3',
      'LUM-25',
      'lead',
      'status',
      'CI rerun',
      'Rerunning with the URL; two flaky specs left.',
      12
    )
  ]
  const vega = [
    message(
      'm-21-1',
      'LUM-21',
      'lead',
      'question',
      'Card border in dark mode',
      'Keep the brand border on cards in dark mode, or switch to the neutral grey?',
      95
    ),
    message(
      'm-21-2',
      'lead',
      'LUM-21',
      'answer',
      'Re: Card border in dark mode',
      'Neutral grey; the brand border stays in light mode.',
      90
    ),
    message(
      'm-21-3',
      'LUM-21',
      'lead',
      'worker_done',
      'Dark mode ready for review',
      'PR 45 is green with screenshots at four widths.',
      30
    )
  ]
  return {
    threads: [
      { ticket: 'LUM-14', messages: pico, last: pico[1].at, waiting: 1 },
      { ticket: 'LUM-25', messages: nova, last: nova[2].at, waiting: 0 },
      { ticket: 'LUM-21', messages: vega, last: vega[2].at, waiting: 0 }
    ],
    waiting: [
      {
        id: 'm-14-2',
        ticket: 'LUM-14',
        kind: 'decision_gate',
        subject: pico[1].subject,
        body: pico[1].body,
        at: pico[1].at,
        answerer: 'lead'
      }
    ],
    answered: [
      {
        id: 'm-21-1',
        ticket: 'LUM-21',
        kind: 'question',
        question: vega[0].body,
        answer: vega[1].body,
        askedAt: vega[0].at,
        answeredAt: vega[1].at
      }
    ]
  }
}
