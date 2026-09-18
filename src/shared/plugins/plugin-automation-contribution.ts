import { z } from 'zod'
import {
  AUTOMATION_CRON_EXPRESSION_MAX_BYTES,
  isValidAutomationCronSchedule
} from '../automation-schedules'
import { isTuiAgent } from '../tui-agent-config'
import { pluginIdSchema, pluginRelativePathSchema } from './plugin-manifest-fields'

/**
 * `contributes.automations`: scheduled work a plugin declares, created for the
 * user when the plugin is enabled and removed when it is disabled or
 * uninstalled.
 *
 * Declarativo como `panels`: el plugin NO puede crear automatizaciones por API.
 * Nacen deshabilitadas y sin workspace — encender trabajo automatico y elegir
 * donde corre son decisiones del usuario, no del plugin.
 */
export const PLUGIN_AUTOMATION_LIMIT = 16

/** The prompt body lives in a file inside the plugin, never inline: so the
 *  reviewer reads the same bytes the content hash covers. */
export const PLUGIN_AUTOMATION_PROMPT_MAX_BYTES = 128 * 1024

export const pluginAutomationContributionSchema = z
  .object({
    id: pluginIdSchema,
    title: z.string().min(1).max(256),
    /** Cron expression; automations store cron and RRULE in the same field. */
    trigger: z
      .string()
      .min(1)
      .max(AUTOMATION_CRON_EXPRESSION_MAX_BYTES)
      .refine(isValidAutomationCronSchedule, 'must be a cron expression with a possible run'),
    /** IANA zone the cron expression is evaluated in. */
    timezone: z.string().min(1).max(64).refine(isSupportedTimezone, 'must be an IANA time zone'),
    /** Shell command that decides whether the run is worth dispatching. */
    precheck: z.string().min(1).max(1024).optional(),
    prompt: pluginRelativePathSchema,
    provider: z.string().refine(isTuiAgent, 'must be an agent Orca can launch')
  })
  .strict()

export type PluginAutomationContribution = z.infer<typeof pluginAutomationContributionSchema>

function isSupportedTimezone(value: string): boolean {
  try {
    // Intl is the only authority available in main, renderer and the CLI alike.
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}
