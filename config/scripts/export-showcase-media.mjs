#!/usr/bin/env node
// Turns the raw clips the showcase specs record (ORCA_SHOWCASE_CLIPS=1, `<name>.showcase.mp4` under
// test-results/) into what ships: a full-resolution MP4 and WebM plus a poster PNG for the site in
// docs/assets/media/, and a lightweight GIF for the README in docs/assets/readme/.
//
//   node config/scripts/export-showcase-media.mjs [--only lead-wave,agent-grid] [--from <dir>]
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'

const SUFFIX = '.showcase.mp4'
const MEDIA_DIR = join('docs', 'assets', 'media')
const GIF_DIR = join('docs', 'assets', 'readme')
const GIF_WIDTH = 1200
const GIF_FPS = 12

function arg(name) {
  const at = process.argv.indexOf(name)
  return at === -1 ? null : process.argv[at + 1]
}

function findClips(dir) {
  const found = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      found.push(...findClips(path))
    } else if (entry.endsWith(SUFFIX)) {
      found.push(path)
    }
  }
  return found
}

const ffmpeg = (args) =>
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...args], { stdio: 'inherit' })

const root = arg('--from') ?? 'test-results'
const only = arg('--only')?.split(',') ?? null
if (!existsSync(root)) {
  console.error(`no ${root}/: record the clips first with ORCA_SHOWCASE_CLIPS=1`)
  process.exit(1)
}
const clips = findClips(root).filter((clip) => !only || only.includes(basename(clip, SUFFIX)))
if (clips.length === 0) {
  console.error(`no *${SUFFIX} under ${root}/`)
  process.exit(1)
}
mkdirSync(MEDIA_DIR, { recursive: true })
mkdirSync(GIF_DIR, { recursive: true })

for (const clip of clips) {
  const name = basename(clip, SUFFIX)
  const media = (ext) => join(MEDIA_DIR, `${name}.${ext}`)
  // Why yuv420p and faststart: Safari and GitHub's player need both to start without a full download.
  ffmpeg([
    '-i',
    clip,
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-crf',
    '24',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    '-an',
    media('mp4')
  ])
  ffmpeg([
    '-i',
    clip,
    '-c:v',
    'libvpx-vp9',
    '-crf',
    '38',
    '-b:v',
    '0',
    '-row-mt',
    '1',
    '-deadline',
    'good',
    '-cpu-used',
    '4',
    '-an',
    media('webm')
  ])
  // Why the last second: every clip ends on its outcome, which is what the poster should show.
  ffmpeg(['-sseof', '-1', '-i', clip, '-frames:v', '1', '-update', '1', media('png')])
  const gif = join(GIF_DIR, `${name}.gif`)
  ffmpeg([
    '-i',
    clip,
    '-filter_complex',
    `fps=${GIF_FPS},scale=${GIF_WIDTH}:-1:flags=lanczos,split[a][b];` +
      '[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle',
    gif
  ])
  const kb = (path) => `${Math.round(statSync(path).size / 1024)} KB`
  console.log(`${name}: mp4 ${kb(media('mp4'))}, webm ${kb(media('webm'))}, gif ${kb(gif)}`)
}
