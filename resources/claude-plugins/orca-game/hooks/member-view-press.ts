import type { EngineInterface } from 'claude-code'

import type { GameAgent } from '../types'
import { focusTerminal } from './fleet-sync'
import { gameStrings } from './game-strings'
import { remoteViewNoticeOf } from './remote-member-view'

/** View on a member: a remote one says where it runs; a local one focuses its pane or toasts why not. */
export function viewMember($: EngineInterface, agent: GameAgent, handle: string): void {
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
