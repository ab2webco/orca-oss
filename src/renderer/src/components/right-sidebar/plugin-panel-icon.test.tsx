// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { FileText, Inbox, MessageSquare, Plug } from 'lucide-react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { sanitizePluginPanelIconSvg } from '../../../../shared/plugins/plugin-panel-icon-svg'
import { resolvePluginPanelIcon } from './plugin-panel-icon'

describe('resolvePluginPanelIcon curated names', () => {
  it('resolves a curated icon name in both lucide naming styles', () => {
    const dashed = resolvePluginPanelIcon({ icon: 'file-text' })
    // Without this, the equality below also passes when both sides fall back.
    expect(dashed).toBe(FileText)
    expect(resolvePluginPanelIcon({ icon: 'FileText' })).toBe(dashed)
  })

  it('resolves the generic icons a non-code plugin needs', () => {
    expect(resolvePluginPanelIcon({ icon: 'message-square' })).toBe(MessageSquare)
    expect(resolvePluginPanelIcon({ icon: 'inbox' })).toBe(Inbox)
  })

  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty'])(
    'falls back to Plug for the prototype member %s',
    (icon) => {
      expect(resolvePluginPanelIcon({ icon })).toBe(Plug)
    }
  )

  it('falls back to Plug for a declared svg path the host could not sanitize', () => {
    expect(resolvePluginPanelIcon({ icon: 'assets/brand.svg' })).toBe(Plug)
    expect(resolvePluginPanelIcon(undefined)).toBe(Plug)
  })

  it('reuses one component identity per sanitized icon so the surface never remounts', () => {
    const iconSvg = sanitizePluginPanelIconSvg(
      '<svg viewBox="0 0 24 24"><path d="M0 0h24"/></svg>'
    )!
    expect(resolvePluginPanelIcon({ iconSvg })).toBe(resolvePluginPanelIcon({ iconSvg }))
  })
})

describe('resolvePluginPanelIcon custom svg rendering', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  function renderIcon(raw: string, className?: string): SVGSVGElement | null {
    const iconSvg = sanitizePluginPanelIconSvg(raw)
    expect(iconSvg).not.toBeNull()
    const Icon = resolvePluginPanelIcon({ icon: 'brand.svg', iconSvg: iconSvg ?? undefined })
    act(() => {
      root.render(<Icon className={className} />)
    })
    return container.querySelector('svg')
  }

  it('scales from the surface class instead of the file width and height', () => {
    const svg = renderIcon(
      '<svg width="512" height="512" viewBox="0 0 24 24"><path d="M2 2h20"/></svg>',
      'size-4'
    )
    expect(svg?.getAttribute('width')).toBeNull()
    expect(svg?.getAttribute('height')).toBeNull()
    expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24')
    expect(svg?.getAttribute('class')).toBe('size-4')
  })

  it('repaints every declared color as currentColor so the icon follows the theme', () => {
    const svg = renderIcon(
      '<svg viewBox="0 0 24 24" fill="none"><path d="M2 2h20" fill="#25D366" stroke="rgb(1,2,3)" stroke-width="2"/></svg>'
    )
    const path = svg?.querySelector('path')
    expect(svg?.getAttribute('fill')).toBe('none')
    expect(path?.getAttribute('fill')).toBe('currentColor')
    expect(path?.getAttribute('stroke')).toBe('currentColor')
    // React only understands the camelCase spelling; a dropped mapping would
    // silently lose the stroke weight.
    expect(path?.getAttribute('stroke-width')).toBe('2')
  })

  it('renders none of the executable markup the file carried', () => {
    const iconSvg = sanitizePluginPanelIconSvg(
      '<svg viewBox="0 0 24 24" onload="alert(1)"><path d="M2 2h20" onclick="alert(2)"/></svg>'
    )
    expect(iconSvg).not.toBeNull()
    const Icon = resolvePluginPanelIcon({ iconSvg: iconSvg ?? undefined })
    act(() => {
      root.render(<Icon />)
    })
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('onload')).toBeNull()
    expect(svg?.querySelector('path')?.getAttribute('onclick')).toBeNull()
    expect(container.innerHTML).not.toContain('alert')
  })
})
