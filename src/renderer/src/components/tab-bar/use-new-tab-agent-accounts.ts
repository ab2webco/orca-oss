import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '@/store'
import { useAgentDetectionTargetForWorktree } from '@/hooks/useAgentDetectionTarget'
import { isWebRuntimeSessionActive } from '@/runtime/web-runtime-session'
import {
  fetchProviderAccountsSnapshot,
  type ProviderAccountsSnapshot
} from '@/runtime/runtime-provider-accounts-client'
import { useTeamPanelMembers } from '@/components/team-panel/use-team-panel-model'
import type { NewTabTeamMemberOnAccount } from '../../../../shared/new-tab-account-options'
import { newTabAgentProvidersOf } from './new-tab-agent-providers'
import type { QuickLaunchAgentAccounts } from './QuickLaunchButton'

/** The + menu's account context for this worktree; reads the accounts once per menu open. */
export function useNewTabAgentAccounts(worktreeId: string): QuickLaunchAgentAccounts {
  const target = useAgentDetectionTargetForWorktree(worktreeId)
  const activeRuntimeEnvironmentId = useAppStore((s) => s.settings?.activeRuntimeEnvironmentId)
  const local = target?.kind === 'local' && !isWebRuntimeSessionActive(activeRuntimeEnvironmentId)
  const rateLimits = useAppStore((s) => s.rateLimits)
  const claudePin = useAppStore((s) => s.getKnownWorktreeById(worktreeId)?.claudeAccountId ?? null)
  const codexPin = useAppStore((s) => s.getKnownWorktreeById(worktreeId)?.codexAccountId ?? null)
  const members = useTeamPanelMembers()
  const [snapshot, setSnapshot] = useState<ProviderAccountsSnapshot | null>(null)

  useEffect(() => {
    if (!local) {
      return
    }
    let live = true
    fetchProviderAccountsSnapshot({ activeRuntimeEnvironmentId })
      .then((next) => {
        if (live) {
          setSnapshot(next)
        }
      })
      // Why: a failed read leaves the rows without an account line, never a guessed one.
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [local, activeRuntimeEnvironmentId])

  return useMemo(() => {
    const onAccounts: NewTabTeamMemberOnAccount[] = members.flatMap((member) =>
      member.account
        ? [
            {
              provider: member.account.provider,
              email: member.account.email,
              ticket: member.ticket?.identifier ?? member.name
            }
          ]
        : []
    )
    if (!snapshot) {
      return {
        local,
        providers: { claude: null, codex: null },
        labelOf: (_provider, accountId) => accountId ?? ''
      }
    }
    const built = newTabAgentProvidersOf({
      // Why: a local snapshot carries no rate limits; the renderer's slice holds them.
      snapshot: { ...snapshot, rateLimits: snapshot.rateLimits ?? rateLimits },
      ...(snapshot.failedProviders ? { failedProviders: snapshot.failedProviders } : {}),
      pins: { claude: claudePin, codex: codexPin },
      members: onAccounts,
      now: Date.now()
    })
    return { local, ...built }
  }, [claudePin, codexPin, local, members, rateLimits, snapshot])
}
