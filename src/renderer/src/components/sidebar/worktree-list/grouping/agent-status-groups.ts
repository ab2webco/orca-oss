import { CircleAlert, LoaderCircle, Moon } from 'lucide-react'
import type React from 'react'
import type { WorktreeAttention } from '../../smart-attention'
import { translate } from '@/i18n/i18n'

// V30's Estado grouping: who needs the person, who is working, who is at rest.
export type AgentStatusGroupKey = 'needs-you' | 'working' | 'idle'

export const AGENT_STATUS_GROUP_ORDER: AgentStatusGroupKey[] = ['needs-you', 'working', 'idle']

export const AGENT_STATUS_GROUP_META: Record<
  AgentStatusGroupKey,
  { label: string; icon: React.ComponentType<{ className?: string }>; tone: string }
> = {
  'needs-you': {
    get label() {
      return translate(
        'auto.components.sidebar.worktree.list.grouping.agent.status.groups.48df8d3cb4',
        'Needs you'
      )
    },
    icon: CircleAlert,
    tone: 'text-status-attention'
  },
  working: {
    get label() {
      return translate(
        'auto.components.sidebar.worktree.list.grouping.agent.status.groups.f64325a5d9',
        'Working'
      )
    },
    icon: LoaderCircle,
    tone: 'text-status-info'
  },
  idle: {
    get label() {
      return translate(
        'auto.components.sidebar.worktree.list.grouping.agent.status.groups.60f96eed0b',
        'Idle'
      )
    },
    icon: Moon,
    tone: 'text-status-idle'
  }
}

export function getAgentStatusGroupHeaderKey(group: AgentStatusGroupKey): string {
  return `agent-status:${group}`
}

// Smart-sort classes: 1 blocked/waiting, 2 done, 3 working, 4 idle; a finished agent is at rest.
export function getAgentStatusGroupKey(
  attention: WorktreeAttention | undefined
): AgentStatusGroupKey {
  if (attention?.cls === 1) {
    return 'needs-you'
  }
  return attention?.cls === 3 ? 'working' : 'idle'
}

export function buildAgentStatusGroupByWorktree(
  attentionByWorktree: ReadonlyMap<string, WorktreeAttention>
): Map<string, AgentStatusGroupKey> {
  const result = new Map<string, AgentStatusGroupKey>()
  for (const [worktreeId, attention] of attentionByWorktree) {
    result.set(worktreeId, getAgentStatusGroupKey(attention))
  }
  return result
}
