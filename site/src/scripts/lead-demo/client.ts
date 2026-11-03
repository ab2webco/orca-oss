// Plays the hero timeline while the Panel is on screen. People who prefer reduced
// motion keep the server-rendered still frame; nothing here runs for them.
import { type Frame, initialFrame, timeline } from './data'
import { type DemoCopy, renderPanel } from './render'

function start(root: HTMLElement): void {
  const copy = JSON.parse(root.dataset.copy ?? '{}') as DemoCopy
  let frame: Frame = initialFrame
  let stepIndex = 0
  let timer: number | undefined
  let visible = false

  const paint = (next: Frame, previous?: Frame): void => {
    root.innerHTML = renderPanel(next, copy, previous)
  }

  const schedule = (): void => {
    window.clearTimeout(timer)
    if (!visible || document.hidden) {
      return
    }
    const step = timeline[stepIndex]
    timer = window.setTimeout(() => {
      const previous = frame
      frame = step.apply(frame)
      paint(frame, previous)
      stepIndex = (stepIndex + 1) % timeline.length
      schedule()
    }, step.delay)
  }

  paint(frame)
  new IntersectionObserver((entries) => {
    visible = entries.some((entry) => entry.isIntersecting)
    schedule()
  }).observe(root)
  document.addEventListener('visibilitychange', schedule)
}

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')
if (!reduce.matches) {
  document.querySelectorAll<HTMLElement>('[data-lead-demo]').forEach(start)
}
