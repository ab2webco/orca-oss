import { ciLineOf, noticeLineOf, type Advisor } from './allies'

export type JevAlert = { key: string; tone: 'failure' | 'warn'; text: string }

/** Jev's lines the text layer keeps: failed CI, stops and escalations; the rest is in the Team panel. */
export const jevAlertsOf = (advisor: Advisor | null): JevAlert[] => {
  if (advisor === null) {
    return []
  }
  const failed = advisor.ci
    .filter((run) => run.status === 'failure')
    .map((run): JevAlert => ({ key: `jev-ci-${run.id}`, tone: 'failure', text: ciLineOf(run) }))
  const notice = advisor.notices.at(-1)
  const raised =
    notice === undefined || notice.level === 'info'
      ? []
      : [
          {
            key: 'jev-notice',
            tone: notice.level === 'block' ? 'failure' : 'warn',
            text: noticeLineOf(notice)
          } satisfies JevAlert
        ]
  return [...failed, ...raised]
}
