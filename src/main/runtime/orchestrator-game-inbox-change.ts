/** Tells an open Inbox that orchestration mail arrived; a burst of messages is one refresh. */
export class GameInboxChangeSignal {
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly emit: () => void,
    private readonly delayMs = 250
  ) {}

  mailArrived(messageType?: string): void {
    if (messageType === 'heartbeat' || this.timer) {
      return
    }
    this.timer = setTimeout(() => {
      this.timer = null
      this.emit()
    }, this.delayMs)
    this.timer.unref?.()
  }
}
