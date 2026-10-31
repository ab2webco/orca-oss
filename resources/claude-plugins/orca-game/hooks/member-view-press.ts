import type { EngineInterface } from 'claude-code'

import type { GameAgent } from '../types'
import { focusTerminal, refresh, refreshSoon, resumeMemberTicket } from './fleet-sync'
import { gameStrings } from './game-strings'
import {
  remoteRecoveryOf,
  remoteRecoveryTextOf,
  remoteViewNoticeOf,
  resumeToastOf,
  type RemoteRecovery
} from './remote-member-view'

export { viewLabelOf } from './remote-member-view'

/** Resume wakes a member its host slept; Reconnect asks its silent host again right away. */
async function recoverMember(
  $: EngineInterface,
  agent: GameAgent,
  recovery: RemoteRecovery
): Promise<void> {
  const host = agent.remote?.host ?? ''
  const text = remoteRecoveryTextOf()
  if (recovery.action === 'reconnect' || recovery.ticket === null) {
    $.ui.toast(text.reconnecting(host))
    await refresh($)
    return
  }
  $.ui.toast(text.waking(agent.displayName, host))
  const out = await resumeMemberTicket($, recovery.ticket)
  $.ui.toast(resumeToastOf(agent.displayName, host, recovery.ticket, out))
  await refreshSoon($)
}

/** View on a member: a remote one says where it runs; a local one focuses its pane or toasts why not. */
export function viewMember($: EngineInterface, agent: GameAgent, handle: string): void {
  const recovery = remoteRecoveryOf(agent)
  if (recovery !== null) {
    void recoverMember($, agent, recovery).catch(() => undefined)
    return
  }
  const notice = remoteViewNoticeOf(agent)
  if (notice !== null) {
    $.ui.toast(notice)
    return
  }
  void focusTerminal($, handle).then((isFocused) => {
    if (!isFocused) {
      $.ui.toast(gameStrings().text.couldNotOpen(agent.displayName))
    }
  })
}
