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
 * Nacen deshabilitadas — encender trabajo automatico es decision del usuario.
 *
 * Que hace cuando corre: o lanza un agente (`provider` + `prompt`), o corre un
 * comando (`command`). Una u otra, nunca las dos ni ninguna — de ahi la union
 * de dos objetos `.strict()` en vez de dos opcionales sueltos. Sincronizar una
 * carpeta cada 5 minutos no necesita un agente de codigo, y pedir uno quema
 * tokens y ocupa un terminal para invocar un proceso.
 *
 * Donde corre: por defecto nacen sin proyecto y lo elige el usuario, porque un
 * plugin no puede adivinar en que repo del usuario trabajar. `workspace:
 * 'plugin-owned'` NO levanta esa regla: pide una carpeta que Orca crea PARA el
 * plugin, fuera de todo proyecto del usuario, y el plugin sigue sin poder
 * nombrar una ruta ni apuntar a un repo ajeno — de ahi que sea un literal y no
 * un string. El esquema es `.strict()`: una clave que no este declarada aca
 * invalida el manifiesto entero, asi que un campo nuevo se agrega aca o no
 * existe.
 */
export const PLUGIN_AUTOMATION_LIMIT = 16

/** The prompt body lives in a file inside the plugin, never inline: so the
 *  reviewer reads the same bytes the content hash covers. */
export const PLUGIN_AUTOMATION_PROMPT_MAX_BYTES = 128 * 1024

/** Unico valor aceptado por `workspace`: el plugin pide "mi carpeta", no una
 *  ruta. Orca decide cual es y la crea. */
export const PLUGIN_OWNED_AUTOMATION_WORKSPACE = 'plugin-owned'

/** Techo del comando declarado, igual que el del precheck. */
export const PLUGIN_AUTOMATION_COMMAND_MAX_CHARS = 1024

const sharedAutomationFields = {
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
  /** Opt-in: corre en la carpeta que Orca crea para este plugin en vez de en
   *  un proyecto del usuario. Ausente = comportamiento de siempre (sin
   *  proyecto hasta que el usuario elija). */
  workspace: z.literal(PLUGIN_OWNED_AUTOMATION_WORKSPACE).optional()
}

const pluginAgentAutomationSchema = z
  .object({
    ...sharedAutomationFields,
    prompt: pluginRelativePathSchema,
    provider: z.string().refine(isTuiAgent, 'must be an agent Orca can launch')
  })
  .strict()

const pluginCommandAutomationSchema = z
  .object({
    ...sharedAutomationFields,
    /** El comando ES la corrida. Sin agente, sin terminal, sin modelo. */
    command: z.string().min(1).max(PLUGIN_AUTOMATION_COMMAND_MAX_CHARS)
  })
  .strict()

export const pluginAutomationContributionSchema = z.union([
  pluginAgentAutomationSchema,
  pluginCommandAutomationSchema
])

export type PluginAutomationContribution = z.infer<typeof pluginAutomationContributionSchema>
export type PluginAgentAutomationContribution = z.infer<typeof pluginAgentAutomationSchema>
export type PluginCommandAutomationContribution = z.infer<typeof pluginCommandAutomationSchema>

/** True cuando la declaracion pide la carpeta del propio plugin. */
export function usesPluginOwnedWorkspace(contribution: PluginAutomationContribution): boolean {
  return contribution.workspace === PLUGIN_OWNED_AUTOMATION_WORKSPACE
}

export function isPluginCommandAutomation(
  contribution: PluginAutomationContribution
): contribution is PluginCommandAutomationContribution {
  return 'command' in contribution
}

function isSupportedTimezone(value: string): boolean {
  try {
    // Intl is the only authority available in main, renderer and the CLI alike.
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

/** Wire preview of a contributed automation. `command` present = command-only:
 *  that shell string IS the run, so consent has to show it verbatim. */
export type PluginAutomationPreview = {
  id: string
  title: string
  trigger: string
  command?: string
}

export function previewPluginAutomations(
  contributions: readonly PluginAutomationContribution[]
): PluginAutomationPreview[] {
  return contributions.map((contribution) => ({
    id: contribution.id,
    title: contribution.title,
    trigger: contribution.trigger,
    ...(isPluginCommandAutomation(contribution) ? { command: contribution.command } : {})
  }))
}
