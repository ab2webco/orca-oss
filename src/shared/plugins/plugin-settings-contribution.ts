import { z, type RefinementCtx } from 'zod'

/**
 * Declarative plugin settings: the manifest names the keys a plugin needs, and
 * Orca renders the form. Values persist through the SAME per-plugin stores the
 * `settings:own` capability already reads — plain keys in `settings.json`,
 * `secret` keys in the encrypted vault — so a plugin sees what the user typed
 * without any new host API.
 *
 * Lives in its own file (not `plugin-manifest.ts`) because this is a fork-only
 * surface: keeping it out of the shared manifest object holds the sync conflict
 * to the four lines that wire it in.
 */

export const PLUGIN_SETTINGS_CONTRIBUTION_LIMIT = 32

const settingKeySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, 'must start with a letter and use only letters, digits, and _')

const settingLabelSchema = z.string().min(1).max(128)
const settingDescriptionSchema = z.string().max(512).optional()

const stringSettingSchema = z.object({
  key: settingKeySchema,
  type: z.literal('string'),
  label: settingLabelSchema,
  description: settingDescriptionSchema,
  /** Stored in the plugin's encrypted vault instead of plaintext settings.json. */
  secret: z.boolean().optional(),
  placeholder: z.string().max(128).optional(),
  default: z.string().max(4096).optional(),
  required: z.boolean().optional()
})

const booleanSettingSchema = z.object({
  key: settingKeySchema,
  type: z.literal('boolean'),
  label: settingLabelSchema,
  description: settingDescriptionSchema,
  default: z.boolean().optional(),
  required: z.boolean().optional()
})

const numberSettingSchema = z.object({
  key: settingKeySchema,
  type: z.literal('number'),
  label: settingLabelSchema,
  description: settingDescriptionSchema,
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  default: z.number().finite().optional(),
  required: z.boolean().optional()
})

const settingContributionSchema = z.discriminatedUnion('type', [
  stringSettingSchema,
  booleanSettingSchema,
  numberSettingSchema
])

export type PluginSettingContribution = z.infer<typeof settingContributionSchema>
export type PluginSettingType = PluginSettingContribution['type']
export type PluginSettingValue = string | number | boolean

export const pluginSettingsContributionSchema = z
  .array(settingContributionSchema)
  .max(PLUGIN_SETTINGS_CONTRIBUTION_LIMIT)
  .superRefine((settings, ctx) => {
    const seen = new Set<string>()
    for (const [index, setting] of settings.entries()) {
      if (seen.has(setting.key)) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'key'],
          message: `duplicate setting key: ${setting.key}`
        })
      }
      seen.add(setting.key)
      // Why: a required setting that ships a default can never be unconfigured,
      // so the "needs setup" state it exists to produce would be unreachable.
      if (setting.required === true && setting.default !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'required'],
          message: 'a required setting cannot declare a default'
        })
      }
      if (setting.type === 'string' && setting.secret === true && setting.default !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'default'],
          message: 'a secret setting cannot declare a default'
        })
      }
      if (
        setting.type === 'number' &&
        setting.min !== undefined &&
        setting.max !== undefined &&
        setting.min > setting.max
      ) {
        ctx.addIssue({ code: 'custom', path: [index, 'min'], message: 'min must not exceed max' })
      }
    }
  })
  .default([])

type SettingsCapabilitySubject = {
  contributes: { settings?: readonly { type: string; secret?: boolean }[] }
  capabilities: readonly { kind: string }[]
}

/** Chained onto the manifest schema so the manifest-wide validator stays untouched. */
export function validatePluginSettingsContributions(
  manifest: SettingsCapabilitySubject,
  ctx: RefinementCtx
): void {
  const settings = manifest.contributes.settings ?? []
  if (settings.length === 0) {
    return
  }
  const kinds = new Set(manifest.capabilities.map((capability) => capability.kind))
  if (!kinds.has('settings:own')) {
    ctx.addIssue({
      code: 'custom',
      path: ['capabilities'],
      message: 'settings:own capability required when contributes.settings is non-empty'
    })
  }
  if (
    settings.some((setting) => setting.type === 'string' && setting.secret === true) &&
    !kinds.has('secrets')
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['capabilities'],
      message: 'secrets capability required when a contributed setting is marked secret'
    })
  }
}

export function isSecretPluginSetting(setting: PluginSettingContribution): boolean {
  return setting.type === 'string' && setting.secret === true
}

/**
 * The effective value shown in the form: what the user stored, else the
 * declared default. Secrets never resolve here — their value stays in main.
 */
export function effectivePluginSettingValue(
  setting: PluginSettingContribution,
  stored: unknown
): PluginSettingValue | undefined {
  if (setting.type === 'string') {
    return typeof stored === 'string' ? stored : setting.default
  }
  if (setting.type === 'boolean') {
    return typeof stored === 'boolean' ? stored : setting.default
  }
  return typeof stored === 'number' && Number.isFinite(stored) ? stored : setting.default
}

/**
 * A string counts as unconfigured when it is blank, not just absent: clearing a
 * field is exactly the state the webhook plugin was silently stuck in.
 */
export function isPluginSettingConfigured(
  setting: PluginSettingContribution,
  stored: unknown,
  hasStoredSecret: boolean
): boolean {
  if (isSecretPluginSetting(setting)) {
    return hasStoredSecret
  }
  const value = effectivePluginSettingValue(setting, stored)
  if (value === undefined) {
    return false
  }
  return typeof value === 'string' ? value.trim().length > 0 : true
}

/** Keys of `required` settings with no usable value — the "needs setup" input. */
export function listUnconfiguredPluginSettings(
  declared: readonly PluginSettingContribution[],
  stored: Readonly<Record<string, unknown>>,
  storedSecretKeys: readonly string[]
): string[] {
  const secrets = new Set(storedSecretKeys)
  return declared
    .filter(
      (setting) =>
        setting.required === true &&
        !isPluginSettingConfigured(setting, stored[setting.key], secrets.has(setting.key))
    )
    .map((setting) => setting.key)
}

export type PluginSettingWriteRejection = { ok: false; error: string }

/** Type gate for an incoming write; the caller owns persistence. */
export function coercePluginSettingWrite(
  setting: PluginSettingContribution,
  value: unknown
): { ok: true; value: PluginSettingValue } | PluginSettingWriteRejection {
  if (setting.type === 'string') {
    return typeof value === 'string'
      ? { ok: true, value }
      : { ok: false, error: `setting ${setting.key} expects a string` }
  }
  if (setting.type === 'boolean') {
    return typeof value === 'boolean'
      ? { ok: true, value }
      : { ok: false, error: `setting ${setting.key} expects a boolean` }
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { ok: false, error: `setting ${setting.key} expects a number` }
  }
  if (setting.min !== undefined && value < setting.min) {
    return { ok: false, error: `setting ${setting.key} must be at least ${setting.min}` }
  }
  if (setting.max !== undefined && value > setting.max) {
    return { ok: false, error: `setting ${setting.key} must be at most ${setting.max}` }
  }
  return { ok: true, value }
}
