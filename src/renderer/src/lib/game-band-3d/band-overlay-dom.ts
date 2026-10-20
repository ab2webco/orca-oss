// The overlay's DOM: canvas host, name tags, life deltas, the member card and the POC chip.
import type { BandMember, BandModel, MemberRect } from './band-scene'

export type OverlayDom = {
  root: HTMLDivElement
  host: HTMLDivElement
  chip: HTMLButtonElement
  setTags(model: BandModel, rects: readonly MemberRect[]): void
  showCard(member: BandMember | null, rect: MemberRect | null, ci: string): void
  dispose(): void
}

const STYLE_ID = 'game-band-3d-style'

const CSS = `
.game-band-3d { position: absolute; z-index: 4; pointer-events: none; overflow: hidden; }
.game-band-3d canvas { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: auto; }
.game-band-3d-tag { position: absolute; transform: translateX(-50%); font: 600 10px/1.1 var(--font-sans);
  color: #fff; text-shadow: 0 1px 2px rgb(0 0 0 / 0.8); white-space: nowrap; pointer-events: none; }
.game-band-3d-tag[data-state='waiting']::after { content: ' · needs you'; color: #ffd34d; }
.game-band-3d-delta { position: absolute; transform: translateX(-50%); font: 700 12px/1 var(--font-sans);
  pointer-events: none; text-shadow: 0 1px 2px rgb(0 0 0 / 0.8); }
.game-band-3d-delta[data-sign='+'] { color: #7bf29a; }
.game-band-3d-delta[data-sign='-'] { color: #ff6b81; }
.game-band-3d-chip { position: absolute; right: 4px; top: 3px; pointer-events: auto; cursor: pointer;
  font: 500 10px/1 var(--font-sans); padding: 3px 6px; border-radius: var(--radius-sm);
  border: 1px solid var(--border); background: var(--popover); color: var(--popover-foreground); opacity: 0.85; }
.game-band-3d-card { position: absolute; z-index: 5; pointer-events: auto; min-width: 150px; padding: 6px 8px;
  font: 400 11px/1.4 var(--font-sans); border-radius: var(--radius-md); border: 1px solid var(--border);
  background: var(--popover); color: var(--popover-foreground); box-shadow: 0 4px 14px rgb(0 0 0 / 0.25); }
.game-band-3d-card b { font-weight: 600; }
`

const ensureStyle = (): void => {
  if (document.getElementById(STYLE_ID) !== null) {
    return
  }
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
}

const element = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  node.className = className
  return node
}

export const createOverlayDom = (parent: HTMLElement): OverlayDom => {
  ensureStyle()
  const root = element('div', 'game-band-3d')
  root.dataset.testid = 'game-band-3d'
  root.style.display = 'none'
  const host = element('div', 'game-band-3d-host')
  host.style.cssText = 'position:absolute;inset:0'
  const tags = element('div', 'game-band-3d-tags')
  const chip = element('button', 'game-band-3d-chip')
  chip.type = 'button'
  const card = element('div', 'game-band-3d-card')
  card.style.display = 'none'
  root.append(host, tags, chip)
  parent.append(root, card)

  const tagNodes = new Map<string, { name: HTMLDivElement; delta: HTMLDivElement }>()
  const nodesOf = (key: string): { name: HTMLDivElement; delta: HTMLDivElement } => {
    const existing = tagNodes.get(key)
    if (existing !== undefined) {
      return existing
    }
    const nodes = {
      name: element('div', 'game-band-3d-tag'),
      delta: element('div', 'game-band-3d-delta')
    }
    tags.append(nodes.name, nodes.delta)
    tagNodes.set(key, nodes)
    return nodes
  }

  return {
    root,
    host,
    chip,
    setTags(model, rects) {
      const byKey = new Map(rects.map((rect) => [rect.key, rect]))
      for (const member of model.members) {
        const rect = byKey.get(member.key)
        const nodes = nodesOf(member.key)
        if (rect === undefined) {
          continue
        }
        nodes.name.textContent = member.benched ? `${member.name} · benched` : member.name
        nodes.name.dataset.state = member.state
        nodes.name.style.left = `${rect.x + rect.width / 2}px`
        nodes.name.style.top = `${Math.min(rect.y + rect.height + 1, root.clientHeight - 12)}px`
        const change = member.lifeChange
        const live = change !== null && change.ageMs < 1600
        nodes.delta.style.display = live ? 'block' : 'none'
        if (live) {
          nodes.delta.dataset.sign = change.delta > 0 ? '+' : '-'
          nodes.delta.textContent = `${change.delta > 0 ? '+' : '−'}${Math.abs(change.delta)} ♥`
          nodes.delta.style.left = `${rect.x + rect.width / 2}px`
          nodes.delta.style.top = `${Math.max(0, rect.y - 4 - (change.ageMs / 1600) * 14)}px`
          nodes.delta.style.opacity = String(1 - change.ageMs / 1600)
        }
      }
    },
    showCard(member, rect, ci) {
      if (member === null || rect === null) {
        card.style.display = 'none'
        return
      }
      card.replaceChildren()
      const line = (label: string, value: string): void => {
        const row = document.createElement('div')
        const strong = document.createElement('b')
        strong.textContent = `${label} `
        row.append(strong, value)
        card.append(row)
      }
      line(member.isLead ? 'Lead' : 'Member', member.name)
      line('Ticket', member.ticket)
      line('PR', member.review)
      line('CI', ci)
      line('Lives', `${'♥'.repeat(member.lives)}${member.benched ? ' (benched)' : ''}`)
      card.style.display = 'block'
      const rootRect = root.getBoundingClientRect()
      const parentRect = parent.getBoundingClientRect()
      card.style.left = `${Math.max(0, rootRect.left - parentRect.left + rect.x)}px`
      card.style.top = `${Math.max(0, rootRect.top - parentRect.top - 92)}px`
    },
    dispose() {
      root.remove()
      card.remove()
    }
  }
}

export type MemberHit = { member: BandMember; rect: MemberRect }

export const memberAt = (
  root: HTMLElement,
  event: MouseEvent,
  rects: readonly MemberRect[],
  members: readonly BandMember[]
): MemberHit | null => {
  const box = root.getBoundingClientRect()
  const x = event.clientX - box.left
  const y = event.clientY - box.top
  const rect = rects.find(
    (one) => x >= one.x && x <= one.x + one.width && y >= one.y && y <= one.y + one.height
  )
  const member = rect === undefined ? undefined : members.find((one) => one.key === rect.key)
  return rect === undefined || member === undefined ? null : { member, rect }
}
