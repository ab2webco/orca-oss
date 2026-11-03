import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ElectronApplication, TestInfo } from '@stablyai/playwright-test'

// Records the app's real composited frames for the README and site clips. Frames come from
// webContents.beginFrameSubscription in main, so a hidden test window still records at its
// device scale, and each one is laid on a 60 fps grid by the time it painted.
// Opt-in with ORCA_SHOWCASE_CLIPS=1 (macOS, ffmpeg with VideoToolbox); otherwise the showcase
// specs run as plain regression tests and `showcaseClip` records nothing.
export const RECORDING_CLIPS = process.env.ORCA_SHOWCASE_CLIPS === '1'
export const CLIP_FPS = 60
export const CLIP_ARGS = RECORDING_CLIPS ? ['--force-device-scale-factor=2'] : []
/** Suffix config/scripts/export-showcase-media.mjs looks for under test-results. */
export const CLIP_SUFFIX = '.showcase.mp4'
const FFMPEG_CANDIDATES = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg']

export function ffmpegPath(): string | null {
  return FFMPEG_CANDIDATES.find((candidate) => existsSync(candidate)) ?? null
}

export type Clip = { stop: () => Promise<{ frames: number; painted: number; seconds: number }> }

/** Starts recording the first window into `outPath` (an .mp4); `stop` waits for ffmpeg to exit. */
export async function startClip(electronApp: ElectronApplication, outPath: string): Promise<Clip> {
  const ffmpeg = ffmpegPath()
  if (!ffmpeg) {
    throw new Error('ffmpeg is not installed')
  }
  mkdirSync(dirname(outPath), { recursive: true })
  await electronApp.evaluate(
    ({ BrowserWindow }, { ffmpeg, outPath, fps }) => {
      const cp = process.getBuiltinModule('node:child_process')
      const contents = BrowserWindow.getAllWindows()[0]!.webContents
      const g = globalThis as unknown as { __showcaseClip?: unknown }
      let size: { width: number; height: number } | null = null
      let proc: ReturnType<typeof cp.spawn> | null = null
      let last: Buffer | null = null
      let written = 0
      let painted = 0
      const startedAt = performance.now()
      const exited = new Promise<void>((resolve) => {
        ;(g as { __showcaseClipExit?: () => void }).__showcaseClipExit = resolve
      })
      // Why one write at a time: Node batches queued writes into one writev, and thousands of
      // repeated frames exceed IOV_MAX (EINVAL).
      const queue: { frame: Buffer; unique: boolean }[] = []
      let pending = 0
      let pumping = false
      let drained: (() => void) | null = null
      const pump = () => {
        const next = queue.shift()
        if (!next) {
          pumping = false
          drained?.()
          return
        }
        pumping = true
        proc!.stdin!.write(next.frame, () => {
          if (next.unique) {
            pending--
          }
          pump()
        })
      }
      const write = (frame: Buffer, unique: boolean) => {
        if (unique) {
          pending++
        }
        queue.push({ frame, unique })
        written++
        if (!pumping) {
          pump()
        }
      }
      // Why the grid: a frame only arrives on a repaint, so a still screen is filled with the last
      // one. A repeat is the same Buffer queued again, so it costs no memory.
      const fill = (until: number) => {
        while (last && written < until) {
          write(last, false)
        }
      }
      contents.beginFrameSubscription(false, (image) => {
        const bitmap = image.toBitmap()
        const imageSize = image.getSize()
        if (!size) {
          size = imageSize
          proc = cp.spawn(
            ffmpeg,
            [
              '-loglevel',
              'error',
              '-y',
              '-f',
              'rawvideo',
              '-pix_fmt',
              'bgra',
              '-s',
              `${size.width}x${size.height}`,
              '-r',
              String(fps),
              '-i',
              'pipe:0',
              '-c:v',
              'h264_videotoolbox',
              '-b:v',
              '16M',
              '-pix_fmt',
              'yuv420p',
              '-movflags',
              '+faststart',
              outPath
            ],
            { stdio: ['pipe', 'ignore', 'inherit'] }
          )
          proc.on('exit', () => (g as { __showcaseClipExit?: () => void }).__showcaseClipExit?.())
        }
        // Why: a resize mid-clip would desync the raw stream, so later sizes are dropped.
        if (imageSize.width !== size.width || imageSize.height !== size.height) {
          return
        }
        painted++
        fill(Math.floor(((performance.now() - startedAt) * fps) / 1000))
        // Why the cap: an encoder that falls behind skips new frames (time stays right) instead of
        // queueing gigabytes of them.
        if (pending < 40) {
          last = bitmap
          write(bitmap, true)
        }
      })
      g.__showcaseClip = {
        stop: async () => {
          contents.endFrameSubscription()
          const seconds = (performance.now() - startedAt) / 1000
          fill(Math.round(seconds * fps))
          if (pumping) {
            await new Promise<void>((resolve) => (drained = resolve))
          }
          proc?.stdin?.end()
          if (proc) {
            const timer = setTimeout(() => proc?.kill('SIGKILL'), 60_000)
            await exited
            clearTimeout(timer)
            if (proc.exitCode !== 0) {
              throw new Error(`ffmpeg exited with ${proc.exitCode ?? proc.signalCode}`)
            }
          }
          return { frames: written, painted, seconds }
        }
      }
    },
    { ffmpeg, outPath, fps: CLIP_FPS }
  )
  return {
    stop: () =>
      electronApp.evaluate(async () => {
        const clip = (globalThis as unknown as { __showcaseClip?: Clip }).__showcaseClip
        if (!clip) {
          throw new Error('no clip is recording')
        }
        return clip.stop()
      })
  }
}

/** Records `<name>.showcase.mp4` into the test's output dir when clips are on. */
export async function showcaseClip(
  electronApp: ElectronApplication,
  testInfo: TestInfo,
  name: string
): Promise<Clip> {
  if (!RECORDING_CLIPS) {
    return { stop: async () => ({ frames: 0, painted: 0, seconds: 0 }) }
  }
  const clip = await startClip(electronApp, testInfo.outputPath(`${name}${CLIP_SUFFIX}`))
  return {
    stop: async () => {
      const stats = await clip.stop()
      await testInfo.attach(`${name} clip stats`, { body: JSON.stringify(stats) })
      return stats
    }
  }
}
