// Every signal that the band is off screen: pane scrolled away, page hidden, window hidden or
// minimised. Why the main signal: macOS keeps visibilityState 'visible' and rAF running when minimised.
export const watchBandVisibility = (
  container: HTMLElement,
  onChange: (shown: boolean, why: string) => void
): (() => void) => {
  let paneVisible = true
  let windowShown = true
  const report = (why: string): void =>
    onChange(paneVisible && windowShown && document.visibilityState === 'visible', why)
  const intersection = new IntersectionObserver((entries) => {
    paneVisible = entries.some((entry) => entry.isIntersecting)
    report(paneVisible ? 'pane visible' : 'pane off screen')
  })
  intersection.observe(container)
  const onVisibility = (): void => report(`page ${document.visibilityState}`)
  document.addEventListener('visibilitychange', onVisibility)
  const stopShown = window.api?.ui?.onShownChanged?.((shown) => {
    windowShown = shown
    report(shown ? 'window shown' : 'window hidden or minimised')
  })
  return () => {
    intersection.disconnect()
    document.removeEventListener('visibilitychange', onVisibility)
    stopShown?.()
  }
}
