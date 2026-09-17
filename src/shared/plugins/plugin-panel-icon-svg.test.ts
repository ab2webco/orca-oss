import { describe, expect, it } from 'vitest'
import { sanitizePluginPanelIconSvg } from './plugin-panel-icon-svg'

describe('sanitizePluginPanelIconSvg', () => {
  it('keeps the geometry of a plausible brand icon', () => {
    const node = sanitizePluginPanelIconSvg(
      `<!-- exported -->
       <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
         <g transform="translate(1 1)">
           <path d="M16 0a16 16 0 100 32" fill="#25D366"/>
           <circle cx="8" cy="8" r="3" stroke="#fff" stroke-width="1.5"/>
         </g>
       </svg>`
    )

    expect(node).toEqual({
      tag: 'svg',
      attributes: { viewBox: '0 0 32 32', fill: 'currentColor' },
      children: [
        {
          tag: 'g',
          attributes: { transform: 'translate(1 1)' },
          children: [
            {
              tag: 'path',
              attributes: { d: 'M16 0a16 16 0 100 32', fill: 'currentColor' },
              children: []
            },
            {
              tag: 'circle',
              attributes: {
                cx: '8',
                cy: '8',
                r: '3',
                stroke: 'currentColor',
                'stroke-width': '1.5'
              },
              children: []
            }
          ]
        }
      ]
    })
  })

  it('preserves an explicit fill of none instead of repainting it', () => {
    expect(
      sanitizePluginPanelIconSvg(
        '<svg viewBox="0 0 24 24" fill="none"><path d="M1 1" stroke="#000"/></svg>'
      )
    ).toEqual({
      tag: 'svg',
      attributes: { viewBox: '0 0 24 24', fill: 'none' },
      children: [{ tag: 'path', attributes: { d: 'M1 1', stroke: 'currentColor' }, children: [] }]
    })
  })

  it.each([
    ['script', '<svg viewBox="0 0 1 1"><script>alert(1)</script></svg>'],
    ['foreignObject', '<svg viewBox="0 0 1 1"><foreignObject><b/></foreignObject></svg>'],
    ['remote image', '<svg viewBox="0 0 1 1"><image href="https://evil.test/x.png"/></svg>'],
    ['use reference', '<svg viewBox="0 0 1 1"><use href="#x"/></svg>'],
    ['style element', '<svg viewBox="0 0 1 1"><style>*{}</style></svg>'],
    ['doctype', '<!DOCTYPE svg SYSTEM "x.dtd"><svg viewBox="0 0 1 1"/>'],
    ['processing instruction', '<?xml-stylesheet href="x.css"?><svg viewBox="0 0 1 1"/>'],
    ['non-svg root', '<html><svg viewBox="0 0 1 1"/></html>'],
    ['missing viewBox', '<svg width="24" height="24"><path d="M1 1"/></svg>'],
    ['malformed viewBox', '<svg viewBox="url(javascript:alert(1))"><path d="M1 1"/></svg>'],
    ['unterminated element', '<svg viewBox="0 0 1 1"><path d="M1 1"'],
    ['mismatched close', '<svg viewBox="0 0 1 1"><g></svg>'],
    ['not markup at all', 'just some text'],
    ['empty file', '']
  ])('refuses %s so the surface falls back to its default icon', (_label, raw) => {
    expect(sanitizePluginPanelIconSvg(raw)).toBeNull()
  })

  it('drops event handlers, references and styling rather than failing the icon', () => {
    const node = sanitizePluginPanelIconSvg(
      '<svg viewBox="0 0 1 1" onload="alert(1)" id="brand" class="x" style="fill:url(#e)">' +
        '<path d="M1 1" onclick="alert(2)" xlink:href="https://evil.test" href="https://evil.test"/></svg>'
    )

    expect(node).toEqual({
      tag: 'svg',
      attributes: { viewBox: '0 0 1 1', fill: 'currentColor' },
      children: [{ tag: 'path', attributes: { d: 'M1 1' }, children: [] }]
    })
  })

  it('refuses a tree bomb the byte cap alone would let through', () => {
    const deep = `${'<g>'.repeat(64)}<path d="M1 1"/>${'</g>'.repeat(64)}`
    expect(sanitizePluginPanelIconSvg(`<svg viewBox="0 0 1 1">${deep}</svg>`)).toBeNull()

    const wide = '<circle cx="1" cy="1" r="1"/>'.repeat(600)
    expect(sanitizePluginPanelIconSvg(`<svg viewBox="0 0 1 1">${wide}</svg>`)).toBeNull()
  })
})
