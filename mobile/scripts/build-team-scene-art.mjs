// Builds the phone's Team scene band art from Orca's bundled Quest art (src/renderer/src/assets/quest-art).
// Why a build step: the desktop sheets are 1024x896 animation grids; the band draws one still frame per
// character, so shipping the grids would add ~4 MB to the app for frames it never shows. Props (desks,
// forge) are drawn by the desktop's painter and stay out of the still band.
// Run from the repo root: node mobile/scripts/build-team-scene-art.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const here = import.meta.dirname
const repo = join(here, '..', '..')
// Why the root's pngjs: mobile has no image dependency of its own, and this runs only by hand.
const { PNG } = createRequire(join(repo, 'package.json'))('pngjs')
const source = join(repo, 'src', 'renderer', 'src', 'assets', 'quest-art')
const target = join(here, '..', 'assets', 'team-scene', 'quest')
const native = JSON.parse(readFileSync(join(source, 'native.json'), 'utf8')).native

const read = (src) => PNG.sync.read(readFileSync(join(source, src)))
const write = (png, name) => {
  const file = join(target, name)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, PNG.sync.write(png, { colorType: 6 }))
}

function crop(png, x, y, width, height) {
  const out = new PNG({ width, height })
  PNG.bitblt(png, out, x, y, width, height, 0, 0)
  return out
}

// Source-over, straight alpha: the layers of one style share a size, as the desktop stacks them.
function over(base, top) {
  for (let i = 0; i < base.data.length; i += 4) {
    const a = top.data[i + 3] / 255
    const b = base.data[i + 3] / 255
    const out = a + b * (1 - a)
    for (let c = 0; c < 3; c++) {
      base.data[i + c] =
        out === 0 ? 0 : Math.round((top.data[i + c] * a + base.data[i + c] * b * (1 - a)) / out)
    }
    base.data[i + 3] = Math.round(out * 255)
  }
  return base
}

for (const style of ['figures', 'office']) {
  const art = native[style]
  const back = art.layers.filter((layer) => !layer.front)
  write(back.map((layer) => read(layer.src)).reduce(over), `${style}/backdrop.png`)
  for (const layer of art.layers.filter((one) => one.front)) {
    write(read(layer.src), `${style}/front.png`)
  }
  for (const [role, spec] of Object.entries(art.roles)) {
    const { width, height } = spec.frame
    const row = spec.animations.idle.row
    spec.sheets.forEach((sheet, index) => {
      const name = spec.sheets.length > 1 ? `${role}-${index + 1}` : role
      write(crop(read(sheet), 0, row * height, width, height), `${style}/${name}.png`)
    })
  }
}
