// A tablist's selection: click or arrow keys pick a tab, and only its panel shows.
export function wireTabList(tabs: HTMLButtonElement[]): void {
  const select = (tab: HTMLButtonElement): void => {
    for (const one of tabs) {
      const on = one === tab
      one.setAttribute('aria-selected', String(on))
      one.tabIndex = on ? 0 : -1
      const panel = document.getElementById(one.getAttribute('aria-controls') ?? '')
      if (panel) {
        panel.hidden = !on
      }
    }
  }
  for (const [i, tab] of tabs.entries()) {
    tab.addEventListener('click', () => select(tab))
    tab.addEventListener('keydown', (event) => {
      const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
      if (step) {
        const next = tabs[(i + step + tabs.length) % tabs.length]
        next?.focus()
        if (next) {
          select(next)
        }
      }
    })
  }
  const first = tabs.find((tab) => tab.getAttribute('aria-selected') === 'true') ?? tabs[0]
  if (first) {
    select(first)
  }
}
