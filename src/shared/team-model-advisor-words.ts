// The one core place that names the advisor plugin (Jev) for a model credit (ORCA-1005, ORCA-851).
// A credit by the advisor is built only from its report, so without Jev nothing here is drawn.

export const TEAM_ADVISOR_NAME = 'Jev'

const NAMED = new RegExp(`\\b${TEAM_ADVISOR_NAME}\\b`, 'i')

/** Whether the advisor's own reason already names it, as `code floor (Jev: code)` does. */
export const advisorReasonNamesIt = (reason: string): boolean => NAMED.test(reason)
