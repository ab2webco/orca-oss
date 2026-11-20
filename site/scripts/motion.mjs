// Watches the landing's moving parts with motion on, at 1440/768/390/320 in dark and light, en and es:
// each clip plays only while on screen, Pause/Play, the style tabs by click and arrow keys, the run
// map's 4 s advance, hold and resume, its pulses, and a run map whose height never changes per step.
// Writes one contact sheet per run into .shots/motion/; --video also records each run there.
// Exits 1 when any check fails. Arguments keep only the runs whose name contains one (e.g. es-light-390).
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import sharp from 'sharp'
import { serveDist, SITE_DIR } from './dist-server.mjs'

const require = createRequire(path.join(SITE_DIR, '..', 'package.json'))
const { chromium } = require('@playwright/test')

const OUT = path.join(SITE_DIR, '.shots', 'motion')
const WIDTHS = [1440, 768, 390, 320]
const THEMES = ['dark', 'light']
const PAGES = [
  { lang: 'en', path: '/', words: { pause: 'Pause', play: 'Play' } },
  { lang: 'es', path: '/es/', words: { pause: 'Pausa', play: 'Reproducir' } }
]
const ADVANCE_MS = 4000
// Why 60rem: RunMap shows the diagram and its stepper from this width; below it every caption shows.
const WIDE = 960
const VIEW_HEIGHT = 900
const HEADER = 80

const args = process.argv.slice(2)
const recordVideo = args.includes('--video')
const only = args.filter((arg) => !arg.startsWith('--'))

function sampleClips() {
  return [...document.querySelectorAll('[data-clip]')].map((figure) => {
    const video = figure.querySelector('video')
    const toggle = figure.querySelector('[data-clip-toggle]')
    const rect = figure.getBoundingClientRect()
    const visible = Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0)
    return {
      name: /clips\/([\w-]+)\./.exec(video?.querySelector('source')?.src ?? '')?.[1] ?? '?',
      paused: video?.paused ?? true,
      time: video?.currentTime ?? 0,
      // Why the margins: right at an edge the observer and this sample can disagree for a frame.
      onScreen: rect.width > 0 && visible > 40,
      offScreen: rect.width === 0 || visible < -40,
      toggle: toggle?.textContent?.trim() ?? '',
      toggleShown: toggle ? !toggle.hidden && toggle.getBoundingClientRect().width > 0 : false
    }
  })
}

/** Every clip's state; "playing" needs two samples so it means the frame actually moved. */
async function clipStates(page) {
  const first = await page.evaluate(sampleClips)
  await page.waitForTimeout(900)
  const second = await page.evaluate(sampleClips)
  return second.map((clip, i) => ({
    ...clip,
    playing: !clip.paused && clip.time > (first[i]?.time ?? 0)
  }))
}

function runState() {
  const run = document.querySelector('[data-run]')
  const controls = run?.querySelector('[data-run-controls]')
  const pulses = [...(run?.querySelectorAll('.pulse.lit') ?? [])].flatMap((p) => p.getAnimations())
  return {
    step: Number(run?.querySelector('[aria-current="step"]')?.dataset.pick ?? 0),
    controlsShown: controls ? !controls.hidden : false,
    stageShown: run ? getComputedStyle(run.querySelector('.stage')).display !== 'none' : false,
    captions: [...(run?.querySelectorAll('[data-step]') ?? [])]
      .filter((li) => !li.hidden)
      .map((li) => Number(li.dataset.step)),
    toggle: run?.querySelector('[data-run-toggle]')?.textContent?.trim() ?? '',
    height: Math.round((run?.getBoundingClientRect().height ?? 0) * 10) / 10,
    pulses: pulses.map((a) => a.playState),
    live: run?.querySelector('.captions')?.getAttribute('aria-live') ?? ''
  }
}

async function watch(browser, origin, job) {
  const checks = []
  const frames = []
  const check = (name, ok, detail = '') => checks.push({ name, ok: Boolean(ok), detail })
  const context = await browser.newContext({
    viewport: { width: job.width, height: VIEW_HEIGHT },
    colorScheme: job.theme,
    reducedMotion: 'no-preference',
    ...(recordVideo
      ? {
          recordVideo: {
            dir: path.join(OUT, 'video', job.name),
            size: { width: job.width, height: VIEW_HEIGHT }
          }
        }
      : {})
  })
  await context.addInitScript((theme) => localStorage.setItem('starlight-theme', theme), job.theme)
  const page = await context.newPage()
  const frame = async (label) => frames.push({ label, png: await page.screenshot() })
  // Why a burst: a flash (a blank poster, a panel drawn empty) lives for a frame or two after the change.
  const burst = async (label) => {
    await frame(`${label} +0ms`)
    await page.waitForTimeout(150)
    await frame(`${label} +150ms`)
    await page.waitForTimeout(250)
    await frame(`${label} +400ms`)
  }
  const centre = async (selector) => {
    await page.evaluate((sel) => {
      const el = document.querySelector(sel)
      el?.scrollIntoView({ block: 'center', behavior: 'instant' })
    }, selector)
    await page.waitForTimeout(600)
  }
  const atTop = async (selector) => {
    await page.evaluate(
      ([sel, head]) => {
        const el = document.querySelector(sel)
        if (el) {
          window.scrollTo({
            top: el.getBoundingClientRect().top + window.scrollY - head,
            behavior: 'instant'
          })
        }
      },
      [selector, HEADER]
    )
    await page.waitForTimeout(600)
  }
  // The named clip must be on screen and moving, and every clip off screen must be paused.
  const expectPlaying = async (where, name) => {
    const clips = await clipStates(page)
    const clip = clips.find((c) => c.name === name)
    check(`${where}: ${name} on screen`, clip?.onScreen, JSON.stringify(clip))
    check(`${where}: ${name} plays`, clip?.playing, `paused=${clip?.paused} t=${clip?.time}`)
    check(
      `${where}: ${name} shows Pause`,
      clip?.toggleShown && clip.toggle === job.words.pause,
      clip?.toggle
    )
    for (const other of clips.filter((c) => c.offScreen)) {
      check(`${where}: ${other.name} paused off screen`, other.paused, `t=${other.time}`)
    }
    return clips
  }

  await page.goto(`${origin}${job.path}`, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(1200)
  const theme = await page.evaluate(() => document.documentElement.dataset.theme)
  check(`page renders the ${job.theme} theme`, theme === job.theme, theme)

  // Hero clip: plays at load, Pause stops it, Play resumes it.
  await expectPlaying('load', 'team-office-building')
  await frame('Hero, playing at load')
  const heroToggle = page.locator('[data-clip] [data-clip-toggle]').first()
  await heroToggle.click()
  let hero = (await clipStates(page))[0]
  check('hero Pause stops the clip', hero.paused && !hero.playing, `paused=${hero.paused}`)
  check('hero toggle reads Play once paused', hero.toggle === job.words.play, hero.toggle)
  await frame('Hero, paused')
  await heroToggle.click()
  hero = (await clipStates(page))[0]
  check('hero Play resumes the clip', hero.playing, `paused=${hero.paused}`)
  check('hero toggle reads Pause again', hero.toggle === job.words.pause, hero.toggle)

  // Merge clip starts when scrolled to; the hero, now off screen, stops.
  await page.evaluate(() =>
    document
      .querySelectorAll('[data-clip]')[1]
      ?.scrollIntoView({ block: 'center', behavior: 'instant' })
  )
  await page.waitForTimeout(300)
  await burst('Merge clip, first play')
  await expectPlaying('merge', 'team-merge')

  // Style tabs: by click and by arrow keys both ways with wrap; only the shown panel's clip plays.
  const tabs = () =>
    page.evaluate(() => {
      const list = document.querySelector('[data-styles]')
      return {
        tab: list?.querySelector('[aria-selected="true"]')?.id ?? '',
        focused: document.activeElement?.id ?? '',
        // Why the prefix: the toolbox and the CLI have tab panels of their own.
        panels: [...document.querySelectorAll('[role="tabpanel"][id^="style-panel-"]')]
          .filter((p) => !p.hidden)
          .map((p) => p.id),
        inOrder: [...(list?.querySelectorAll('[role="tab"]') ?? [])].filter((t) => t.tabIndex === 0)
          .length
      }
    })
  const expectTab = async (how, id) => {
    const state = await tabs()
    check(
      `${how} selects ${id}`,
      state.tab === `style-tab-${id}` &&
        state.panels.join() === `style-panel-${id}` &&
        state.inOrder === 1,
      JSON.stringify(state)
    )
    return state
  }
  await atTop('#styles-title')
  await frame('Styles, Office at first')
  await centre('#style-panel-office [data-clip]')
  await expectPlaying('styles', 'team-style-office')
  await atTop('[data-styles]')
  await page.locator('#style-tab-figures').click()
  await burst('Styles, Figures by click')
  await expectTab('click', 'figures')
  await centre('#style-panel-figures [data-clip]')
  await expectPlaying('styles', 'team-style-figures')
  await page.locator('#style-tab-figures').focus()
  await page.keyboard.press('ArrowRight')
  let state = await expectTab('ArrowRight', 'pixel')
  check('ArrowRight moves focus to Pixel', state.focused === 'style-tab-pixel', state.focused)
  await centre('#style-panel-pixel [data-clip]')
  await expectPlaying('styles', 'team-style-pixel')
  await frame('Styles, Pixel by ArrowRight')
  await page.locator('#style-tab-pixel').focus()
  await page.keyboard.press('ArrowRight')
  state = await expectTab('ArrowRight wrap', 'office')
  check('ArrowRight wraps focus to Office', state.focused === 'style-tab-office', state.focused)
  await page.keyboard.press('ArrowLeft')
  state = await expectTab('ArrowLeft wrap', 'pixel')
  check('ArrowLeft wraps focus to Pixel', state.focused === 'style-tab-pixel', state.focused)
  await page.keyboard.press('ArrowLeft')
  await expectTab('ArrowLeft', 'figures')
  await page.locator('#style-tab-office').click()
  await page.waitForTimeout(500)
  check(
    'hidden panels keep their clips paused',
    (await page.evaluate(sampleClips))
      .filter((c) => /team-style-(figures|pixel)/.test(c.name))
      .every((c) => c.paused)
  )

  // Run map.
  await atTop('#run-title')
  let run = await page.evaluate(runState)
  if (job.width >= WIDE) {
    check('run map shows its stepper', run.controlsShown && run.stageShown, JSON.stringify(run))
    check('running run map keeps its captions quiet', run.live === 'off', run.live)
    check(
      'run map shows one caption',
      run.captions.length === 1 && run.captions[0] === run.step,
      JSON.stringify(run)
    )
    // Why step 3 is exempt: it has no pulse.
    const pulsing =
      run.step === 3 || (run.pulses.length > 0 && run.pulses.every((p) => p === 'running'))
    check('run map pulses run while it plays', pulsing, run.pulses.join())
    await frame(`Run map, step ${run.step}`)
    const heights = new Map([[run.step, run.height]])
    for (let i = 0; i < 2; i += 1) {
      const from = run.step
      await page.waitForTimeout(ADVANCE_MS + 300)
      run = await page.evaluate(runState)
      check(
        `run map advances by itself (${from})`,
        run.step === (from % 6) + 1,
        `${from} -> ${run.step}`
      )
      heights.set(run.step, run.height)
    }
    await frame(`Run map, advanced to ${run.step}`)
    // Why record order: the region must turn polite before the picked caption shows, or it is not read.
    await page.evaluate(() => {
      window.__runOrder = []
      const list = document.querySelector('[data-run] .captions')
      new MutationObserver((records) => {
        for (const r of records) {
          if (r.attributeName === 'aria-live') {
            window.__runOrder.push('live')
          } else if (r.attributeName === 'hidden' && !r.target.hidden) {
            window.__runOrder.push('reveal')
          }
        }
      }).observe(list, {
        subtree: true,
        attributes: true,
        attributeFilter: ['hidden', 'aria-live']
      })
    })
    await page.locator(`[data-run] [data-pick="${(run.step % 6) + 1}"]`).click()
    const order = await page.evaluate(() => window.__runOrder)
    check(
      'a click on a running map turns its captions polite before the step shows',
      order.includes('live') && order.indexOf('live') < order.indexOf('reveal'),
      order.join()
    )
    await page.locator('[data-run] [data-pick="3"]').click()
    await page.waitForTimeout(ADVANCE_MS + 500)
    run = await page.evaluate(runState)
    check('a click holds step 3', run.step === 3, `step=${run.step}`)
    check('held run map offers Play', run.toggle === job.words.play, run.toggle)
    check('held run map reads its captions', run.live === 'polite', run.live)
    await frame('Run map, held on 3')
    await page.locator('[data-run] [data-pick="4"]').click()
    run = await page.evaluate(runState)
    check(
      'held run map pauses its pulses',
      run.pulses.length > 0 && run.pulses.every((p) => p === 'paused'),
      run.pulses.join()
    )
    await page.locator('[data-run] [data-run-toggle]').click()
    await page.waitForTimeout(ADVANCE_MS + 300)
    run = await page.evaluate(runState)
    check(
      'Play resumes the run map',
      run.step === 5 && run.toggle === job.words.pause,
      JSON.stringify(run)
    )
    check(
      'resumed run map runs its pulses',
      run.pulses.every((p) => p === 'running'),
      run.pulses.join()
    )
    await frame(`Run map, resumed to ${run.step}`)
    for (const step of [1, 2, 3, 4, 5, 6]) {
      await page.locator(`[data-run] [data-pick="${step}"]`).click()
      heights.set(step, (await page.evaluate(runState)).height)
    }
    check(
      'run map keeps one height on every step',
      new Set(heights.values()).size === 1,
      JSON.stringify([...heights])
    )
    await page.locator('[data-run] [data-run-toggle]').click()
    const parked = (await page.evaluate(runState)).step
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
    await page.waitForTimeout(ADVANCE_MS * 2)
    run = await page.evaluate(runState)
    check('run map stays put off screen', run.step === parked, `${parked} -> ${run.step}`)
  } else {
    check(
      'narrow run map hides the stepper and diagram',
      !run.controlsShown && !run.stageShown,
      JSON.stringify(run)
    )
    check(
      'narrow run map shows every caption',
      run.captions.join() === '1,2,3,4,5,6',
      run.captions.join()
    )
    await frame('Run map, every caption')
  }

  // Machines clip, last on the page.
  await page.evaluate(() =>
    [...document.querySelectorAll('[data-clip]')]
      .at(-1)
      ?.scrollIntoView({ block: 'center', behavior: 'instant' })
  )
  await page.waitForTimeout(300)
  await expectPlaying('machines', 'team-machines')
  await frame('Machines clip, playing')

  await context.close()
  return { checks, frames }
}

async function contactSheet(file, title, frames, width) {
  const tile = 480
  const tileHeight = Math.round((VIEW_HEIGHT * tile) / width)
  const label = 28
  const cols = 3
  const head = 40
  const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const text = (w, h, y, size, weight, value) =>
    Buffer.from(
      `<svg width="${w}" height="${h}"><text x="8" y="${y}" font-family="sans-serif" font-size="${size}" font-weight="${weight}" fill="#111">${escape(value)}</text></svg>`
    )
  const layers = [{ input: text(tile * cols, head, 26, 18, 'bold', title), left: 0, top: 0 }]
  for (const [i, f] of frames.entries()) {
    const left = (i % cols) * tile
    const top = head + Math.floor(i / cols) * (tileHeight + label)
    layers.push({ input: text(tile, label, 19, 14, 'normal', `${i + 1}. ${f.label}`), left, top })
    layers.push({
      input: await sharp(f.png).resize({ width: tile }).png().toBuffer(),
      left,
      top: top + label
    })
  }
  const rows = Math.ceil(frames.length / cols)
  await sharp({
    create: {
      width: tile * cols,
      height: head + rows * (tileHeight + label),
      channels: 3,
      background: '#f2f2f2'
    }
  })
    .composite(layers)
    .png()
    .toFile(file)
}

mkdirSync(OUT, { recursive: true })
const server = await serveDist()
const browser = await chromium.launch()
const jobs = PAGES.flatMap((p) =>
  THEMES.flatMap((theme) =>
    WIDTHS.map((width) => ({ ...p, theme, width, name: `${p.lang}-${theme}-${width}` }))
  )
).filter((job) => !only.length || only.some((part) => job.name.includes(part)))
let failed = 0
try {
  for (const job of jobs) {
    const { checks, frames } = await watch(browser, server.origin, job)
    const file = path.join(OUT, `${job.name}.png`)
    await contactSheet(file, `${job.name}, motion on`, frames, job.width)
    const bad = checks.filter((c) => !c.ok)
    failed += bad.length
    process.stdout.write(
      `${bad.length ? 'FAIL' : 'ok  '} ${job.name} ${checks.length - bad.length}/${checks.length} -> ${path.relative(SITE_DIR, file)}\n`
    )
    for (const c of bad) {
      process.stdout.write(`     x ${c.name}: ${c.detail}\n`)
    }
  }
} finally {
  await browser.close()
  server.close()
}
process.stdout.write(`motion: ${jobs.length} runs, ${failed} failed checks\n`)
process.exit(failed ? 1 : 0)
