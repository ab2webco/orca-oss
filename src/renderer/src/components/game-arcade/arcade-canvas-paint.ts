import type { ArcadeRun, ArcadeScreen } from './arcade-run-state'
import type { ArcadeWords } from './arcade-words'
import { arcadeTokens } from './arcade-theme-tokens'

// Draws one frame of the arcade tab: the game's baked backdrop, its run, then the score, the hint
// and the game-over or paused card in the theme's colours, with the caller's translated words.

export type ArcadePaintSize = { width: number; height: number; scale: number }

/** `text` split at spaces into at most `max` lines that fit `width`; the last takes the rest. */
export function arcadeLinesOf(
  text: string,
  width: number,
  measure: (line: string) => number,
  max = 2
): string[] {
  const lines: string[] = []
  let line = ''
  const words = text.split(' ')
  for (const [i, word] of words.entries()) {
    const longer = line ? `${line} ${word}` : word
    if (!line || measure(longer) <= width) {
      line = longer
      continue
    }
    lines.push(line)
    if (lines.length === max - 1) {
      return [...lines, words.slice(i).join(' ')]
    }
    line = word
  }
  return [...lines, line]
}

/** `px`, shrunk until a line `widest` px wide at `px` fits `room`, but never below `floor`. */
export const arcadeFitPxOf = (px: number, widest: number, room: number, floor: number): number =>
  widest <= room ? px : Math.max(floor, Math.floor((px * room) / widest))

type TextLook = { px: number; floor: number; fontOf: (px: number) => string }

// Why wrap, then shrink: a narrow center tab (both side panels open at 768) is ~140 px wide, and
// maxWidth alone squeezes the glyphs into a smear.
function fittedLinesOf(
  g: CanvasRenderingContext2D,
  text: string,
  room: number,
  look: TextLook
): { lines: string[]; px: number } {
  g.font = look.fontOf(look.px)
  const lines = arcadeLinesOf(text, room, (line) => g.measureText(line).width)
  const widest = Math.max(...lines.map((line) => g.measureText(line).width))
  const px = arcadeFitPxOf(look.px, widest, room, look.floor)
  g.font = look.fontOf(px)
  return { lines, px }
}

const HINT: TextLook = { px: 12, floor: 9, fontOf: (px) => `${px}px "Geist Mono", monospace` }
const TITLE: TextLook = { px: 22, floor: 12, fontOf: (px) => `600 ${px}px Geist, sans-serif` }

function paintText(
  g: CanvasRenderingContext2D,
  run: { screen: ArcadeScreen },
  words: ArcadeWords,
  w: number,
  h: number
): void {
  const t = arcadeTokens()
  const room = w - 32
  g.fillStyle = t.css('foreground')
  g.font = '600 15px "Geist Mono", monospace'
  g.fillText(words.score, 16, 26, room)
  g.fillStyle = t.css('mutedForeground')
  const hint = fittedLinesOf(g, run.screen === 'held' ? words.held : words.hint, room, HINT)
  hint.lines.forEach((line, i) => g.fillText(line, 16, 44 + i * hint.px * 1.35, room))
  if (run.screen !== 'over' && run.screen !== 'held') {
    return
  }
  g.fillStyle = t.css('background', 0.78)
  g.fillRect(0, 0, w, h)
  g.textAlign = 'center'
  g.fillStyle = t.css('foreground')
  const title = fittedLinesOf(g, run.screen === 'over' ? words.over : words.held, room, TITLE)
  const step = title.px * 1.2
  const top = h / 2 - 6 - ((title.lines.length - 1) * step) / 2
  title.lines.forEach((line, i) => g.fillText(line, w / 2, top + i * step, room))
  g.font = '14px Geist, sans-serif'
  g.fillStyle = t.css('mutedForeground')
  if (run.screen === 'over') {
    g.fillText(words.overHint, w / 2, top + (title.lines.length - 1) * step + 24, room)
  }
  g.textAlign = 'left'
}

export function paintArcadeFrame(
  g: CanvasRenderingContext2D,
  backdrop: HTMLCanvasElement,
  run: ArcadeRun,
  words: ArcadeWords,
  size: ArcadePaintSize
): void {
  g.setTransform(1, 0, 0, 1, 0, 0)
  g.drawImage(backdrop, 0, 0)
  g.setTransform(size.scale, 0, 0, size.scale, 0, 0)
  run.play.paint(g, size, run.screen === 'running')
  paintText(g, run, words, size.width, size.height)
}
