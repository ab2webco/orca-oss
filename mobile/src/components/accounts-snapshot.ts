import { z } from 'zod'

const TimestampSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const AccountIdSchema = z.string().min(1)

const RateLimitWindowSchema = z
  .object({
    usedPercent: z.number().finite().min(0).max(100),
    windowMinutes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    resetsAt: TimestampSchema.nullable(),
    resetDescription: z.string().nullable()
  })
  .passthrough()

const RateLimitResetCreditSchema = z
  .object({
    status: z.string().min(1),
    expiresAt: TimestampSchema.nullable(),
    grantedAt: TimestampSchema.nullable()
  })
  .passthrough()

const RateLimitResetCreditsSchema = z
  .object({
    availableCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    totalEarnedCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    nextExpiresAt: TimestampSchema.nullable().optional(),
    credits: z.array(RateLimitResetCreditSchema).optional()
  })
  .passthrough()

export const ProviderRateLimitsSchema = z
  .object({
    provider: z.enum([
      'claude',
      'codex',
      'gemini',
      'opencode-go',
      'kimi',
      'minimax',
      'grok',
      'antigravity'
    ]),
    session: RateLimitWindowSchema.nullable(),
    weekly: RateLimitWindowSchema.nullable(),
    fableWeekly: RateLimitWindowSchema.nullable().optional(),
    monthly: RateLimitWindowSchema.nullable().optional(),
    buckets: z
      .array(RateLimitWindowSchema.extend({ name: z.string().min(1) }).passthrough())
      .optional(),
    rateLimitResetCredits: RateLimitResetCreditsSchema.nullable().optional(),
    updatedAt: TimestampSchema,
    error: z.string().nullable(),
    status: z.enum(['idle', 'fetching', 'ok', 'error', 'unavailable'])
  })
  .passthrough()

const InactiveAccountUsageSchema = z
  .object({
    accountId: AccountIdSchema,
    rateLimits: ProviderRateLimitsSchema.nullable(),
    updatedAt: TimestampSchema,
    isFetching: z.boolean()
  })
  .passthrough()

const RuntimeSelectionSchema = z
  .object({
    host: AccountIdSchema.nullable(),
    wsl: z.record(z.string().min(1), AccountIdSchema.nullable())
  })
  .passthrough()

export const RateLimitRuntimeTargetSchema = z
  .object({
    runtime: z.enum(['host', 'wsl']),
    wslDistro: z.string().min(1).nullable()
  })
  .passthrough()
  .superRefine((target, context) => {
    if (target.runtime === 'host' && target.wslDistro !== null) {
      context.addIssue({
        code: 'custom',
        message: 'Host rate-limit targets cannot name a WSL distro',
        path: ['wslDistro']
      })
    }
    if (
      target.runtime === 'wsl' &&
      target.wslDistro !== null &&
      target.wslDistro.trim() !== target.wslDistro
    ) {
      context.addIssue({
        code: 'custom',
        message: 'WSL rate-limit targets require an exact distro',
        path: ['wslDistro']
      })
    }
  })

const HostRateLimitRuntimeTarget = {
  runtime: 'host' as const,
  wslDistro: null
}

const ClaudeAccountSummarySchema = z
  .object({
    id: AccountIdSchema,
    email: z.string().min(1),
    managedAuthRuntime: z.enum(['host', 'wsl']).optional(),
    wslDistro: z.string().nullable().optional(),
    // Why `catch` and not just the third value: the host union already had
    // 'custom-endpoint', and rejecting it blanked every account on the phone. A client
    // must never require an enum value it does not know — the next one upstream adds
    // would blank the roster again. Unknown degrades to 'unknown'.
    authMethod: z
      .enum(['subscription-oauth', 'custom-endpoint', 'unknown'])
      .catch('unknown')
      .optional(),
    organizationUuid: z.string().nullable().optional(),
    organizationName: z.string().nullable().optional(),
    createdAt: TimestampSchema.optional(),
    updatedAt: TimestampSchema.optional(),
    lastAuthenticatedAt: TimestampSchema.optional()
  })
  .passthrough()

const CodexAccountSummarySchema = z
  .object({
    id: AccountIdSchema,
    email: z.string().min(1),
    managedHomeRuntime: z.enum(['host', 'wsl']).optional(),
    wslDistro: z.string().nullable().optional(),
    providerAccountId: z.string().nullable().optional(),
    workspaceLabel: z.string().nullable().optional(),
    workspaceAccountId: z.string().nullable().optional(),
    createdAt: TimestampSchema.optional(),
    updatedAt: TimestampSchema,
    lastAuthenticatedAt: TimestampSchema.optional()
  })
  .passthrough()
  .superRefine((account, context) => {
    const runtime = account.managedHomeRuntime ?? 'host'
    if (runtime === 'host' && account.wslDistro != null) {
      context.addIssue({
        code: 'custom',
        message: 'Host Codex accounts cannot name a WSL distro',
        path: ['wslDistro']
      })
    }
    if (
      runtime === 'wsl' &&
      account.wslDistro != null &&
      account.wslDistro.trim() !== account.wslDistro
    ) {
      context.addIssue({
        code: 'custom',
        message: 'WSL Codex accounts require an exact distro',
        path: ['wslDistro']
      })
    }
  })

export const AccountsSnapshotSchema = z
  .object({
    claude: z
      .object({
        accounts: z.array(ClaudeAccountSummarySchema),
        activeAccountId: AccountIdSchema.nullable(),
        activeAccountIdsByRuntime: RuntimeSelectionSchema.optional()
      })
      .passthrough(),
    codex: z
      .object({
        accounts: z.array(CodexAccountSummarySchema),
        activeAccountId: AccountIdSchema.nullable(),
        activeAccountIdsByRuntime: RuntimeSelectionSchema.optional()
      })
      .passthrough(),
    rateLimits: z
      .object({
        claude: ProviderRateLimitsSchema.nullable(),
        codex: ProviderRateLimitsSchema.nullable(),
        // Why: protocol-compatible hosts from before runtime targeting omit
        // these fields; their account selection semantics were host-only.
        claudeTarget: RateLimitRuntimeTargetSchema.default(HostRateLimitRuntimeTarget),
        codexTarget: RateLimitRuntimeTargetSchema.default(HostRateLimitRuntimeTarget),
        inactiveClaudeAccounts: z.array(InactiveAccountUsageSchema),
        inactiveCodexAccounts: z.array(InactiveAccountUsageSchema)
      })
      .passthrough()
  })
  .passthrough()
  .superRefine((snapshot, context) => {
    if (snapshot.rateLimits.claude && snapshot.rateLimits.claude.provider !== 'claude') {
      context.addIssue({
        code: 'custom',
        message: 'Claude limits use the wrong provider identity',
        path: ['rateLimits', 'claude', 'provider']
      })
    }
    if (snapshot.rateLimits.codex && snapshot.rateLimits.codex.provider !== 'codex') {
      context.addIssue({
        code: 'custom',
        message: 'Codex limits use the wrong provider identity',
        path: ['rateLimits', 'codex', 'provider']
      })
    }
    for (const [index, entry] of snapshot.rateLimits.inactiveClaudeAccounts.entries()) {
      if (entry.rateLimits && entry.rateLimits.provider !== 'claude') {
        context.addIssue({
          code: 'custom',
          message: 'Inactive Claude limits use the wrong provider identity',
          path: ['rateLimits', 'inactiveClaudeAccounts', index, 'rateLimits', 'provider']
        })
      }
    }
    for (const [index, entry] of snapshot.rateLimits.inactiveCodexAccounts.entries()) {
      if (entry.rateLimits && entry.rateLimits.provider !== 'codex') {
        context.addIssue({
          code: 'custom',
          message: 'Inactive Codex limits use the wrong provider identity',
          path: ['rateLimits', 'inactiveCodexAccounts', index, 'rateLimits', 'provider']
        })
      }
    }
  })

export type RateLimitWindow = z.infer<typeof RateLimitWindowSchema>
export type ProviderRateLimits = z.infer<typeof ProviderRateLimitsSchema>
export type InactiveAccountUsage = z.infer<typeof InactiveAccountUsageSchema>
export type RateLimitRuntimeTarget = z.infer<typeof RateLimitRuntimeTargetSchema>
export type ClaudeAccountSummary = z.infer<typeof ClaudeAccountSummarySchema>
export type CodexAccountSummary = z.infer<typeof CodexAccountSummarySchema>
export type AccountsSnapshot = z.infer<typeof AccountsSnapshotSchema>

const invalidSnapshotErrors = new WeakSet<Error>()

/** The rejected-field detail when this error came from decodeAccountsSnapshot,
 *  else null. Identity, not message text: the text carries the field and grew a
 *  suffix in ORCA-348, which silently killed an equality check against it. */
export function invalidAccountsSnapshotDetail(error: unknown): string | null {
  return error instanceof Error && invalidSnapshotErrors.has(error) ? error.message : null
}

export function decodeAccountsSnapshot(value: unknown): AccountsSnapshot {
  const result = AccountsSnapshotSchema.safeParse(value)
  if (!result.success) {
    // Why the paths: a bare message left a schema drift between host and client
    // indistinguishable from a host with no accounts, and the field is what tells
    // you which side to fix.
    const where = result.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ')
    const error = new Error(`Invalid accounts snapshot from host — ${where}`)
    invalidSnapshotErrors.add(error)
    throw error
  }
  return result.data
}
