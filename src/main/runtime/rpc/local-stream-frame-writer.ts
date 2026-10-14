import type { LocalStreamWrite } from './transport'

/** Writes stream frames, counting the ones a slow reader lost and announcing them first. */
export function createLocalStreamFrameWriter(
  send: (frame: string) => LocalStreamWrite,
  droppedNotice: (count: number) => string
): (frame: string) => void {
  let dropped = 0
  return (frame) => {
    if (dropped > 0 && send(droppedNotice(dropped)) === 'written') {
      dropped = 0
    }
    if (send(frame) === 'dropped') {
      dropped += 1
    }
  }
}
