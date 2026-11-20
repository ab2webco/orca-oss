import { z } from 'zod'
import { parseGameLead } from '../../../../shared/orchestrator-game-lead'
import { memberRosterSchema } from '../../../../shared/orchestrator-game-member-names'

// Why parseGameLead: the phone's lead name obeys the same rule as orca.yaml's and Settings'.
const LeadName = z
  .string()
  .superRefine((label, ctx) => {
    for (const message of parseGameLead({ label }).warnings) {
      ctx.addIssue({ code: 'custom', message })
    }
  })
  .transform((label) => label.trim())

/** The names a paired phone may set; advertised by mobile.agent-teams-names.v1 (ORCA-1304). */
export const AgentTeamsNamesUpdateField = {
  agentTeamsNames: z
    .object({
      leadName: LeadName.nullable().optional(),
      memberNames: memberRosterSchema.pipe(z.array(z.string())).nullable().optional()
    })
    .strict()
    .optional()
}
