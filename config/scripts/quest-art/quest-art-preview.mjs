// Places the generated art as a stage would, so it is looked at together, at the panel's widths.
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const WIDTHS = [320, 390, 768]
const POSES = ['work', 'idle', 'raise', 'walk', 'give', 'wave', 'cheer', 'work']

export async function previewQuestArt({ browser, out, previewDir, native, readFile }) {
  await mkdir(previewDir, { recursive: true })
  const url = async (src) =>
    `data:image/png;base64,${(await readFile(join(out, src))).toString('base64')}`
  const page = await browser.newPage({
    deviceScaleFactor: 2,
    viewport: { width: 1000, height: 900 }
  })
  for (const [style, art] of Object.entries(native)) {
    const layers = await Promise.all(
      art.layers.map(async (one) => ({ ...one, url: await url(one.src) }))
    )
    const station = await url(art.props.station)
    const lead = await url(art.roles.lead.sheets[0])
    const advisor = await url(art.roles.advisor.sheets[0])
    const members = await Promise.all(art.roles.member.sheets.map(url))
    const { frame, size } = art.roles.lead
    const css = size / frame.height
    const sprite = (sheet, pose, frameAt, x, feet, flip = 1) => {
      const { row, frames } = art.roles.lead.animations[pose]
      const at = frameAt % frames
      return `<i style="left:${x - (frame.width * css) / 2}px;top:${feet - art.roles.lead.feet.y * css}px;width:${frame.width * css}px;height:${size}px;background:url(${sheet}) ${-at * frame.width * css}px ${-row * size}px/${8 * frame.width * css}px auto;transform:scaleX(${flip})"></i>`
    }
    const stageOf = (width) => {
      const feet = style === 'figures' ? 156 : 150
      const seats = members.slice(0, width < 400 ? 4 : 6).map((sheet, at, list) => {
        const x = width * (0.1 + (0.62 * at) / Math.max(1, list.length - 1))
        const tall = style === 'figures' ? 44 : 60
        const desk = `<img class="prop" src="${station}" style="left:${x - 60}px;top:${feet - tall}px;width:120px">`
        return `${desk}${sprite(sheet, POSES[at % POSES.length], at + 2, x, feet)}`
      })
      const bg = layers
        .filter((one) => !one.front)
        .map((one) => `<img src="${one.url}">`)
        .join('')
      const fg = layers
        .filter((one) => one.front)
        .map((one) => `<img src="${one.url}">`)
        .join('')
      return `<p>${style} ${width}</p><div class="stage" style="width:${width}px">${bg}${seats.join('')}${sprite(lead, 'idle', 0, width * 0.82, feet + 8)}${sprite(advisor, 'idle', 1, width * 0.93, feet - 4, -1)}${fg}</div>`
    }
    const strip = (sheet, name) => {
      const cells = Object.entries(art.roles.lead.animations)
        .map(([pose, { frames }]) =>
          Array.from({ length: frames }, (_, at) =>
            sprite(sheet, pose, at, 0, 0).replace(/left:[^;]+;top:[^;]+;/, '')
          ).join('')
        )
        .join('')
      return `<p>${name}</p><div class="strip">${cells}</div>`
    }
    await page.setContent(
      `<!doctype html><style>body{margin:8px;background:#222;color:#ddd;font:12px Menlo,monospace}p{margin:8px 0 3px}
.stage{position:relative;height:176px;overflow:hidden;background:#000}.stage>img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:bottom}
.stage>img.prop{inset:auto;height:auto;object-fit:initial}.stage i{position:absolute;display:block;background-repeat:no-repeat}
.strip{display:flex;flex-wrap:wrap;gap:1px;width:1200px;background:#6b7280}.strip i{display:block;background-repeat:no-repeat}</style><div id="s">${WIDTHS.map(stageOf).join('')}${strip(lead, 'lead')}${strip(advisor, 'advisor')}${members.map((one, at) => strip(one, `member ${at + 1}`)).join('')}</div>`
    )
    await page.evaluate(() => Promise.all([...document.images].map((one) => one.decode())))
    await page.locator('#s').screenshot({ path: join(previewDir, `quest-${style}.png`) })
  }
  await writeFile(join(previewDir, 'index.txt'), 'quest-figures.png\nquest-office.png\n')
}
