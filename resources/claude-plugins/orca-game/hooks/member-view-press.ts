import type { EngineInterface } from 'claude-code'

import type { GameAgent } from '../types'
import { focusTerminal } from './fleet-sync'
import { gameStrings } from './game-strings'
import { remoteOpenFailedOf, remoteOpenOf, remoteViewNoticeOf } from './remote-member-view'

/** View on a member: a live remote one opens through its host, others say where they are; a local one focuses its pane. */
export function viewMember($: EngineInterface, agent: GameAgent, handle: string): void {
  const paired = remoteOpenOf(agent)
  if (paired !== null) {
    void focusTerminal($, paired.handle, paired.environmentId).then((isOpened) => {
      if (!isOpened) {
        $.ui.toast(remoteOpenFailedOf(agent))
      }
    })
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
