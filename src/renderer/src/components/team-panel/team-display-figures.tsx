import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'

// One seven-segment cell on a 22 x 38 grid, segments a to g.
const SEGMENTS: Record<string, string> = {
  a: '4,1 18,1 15.4,3.8 6.6,3.8',
  b: '18.9,2 21,4 21,17.8 19.6,18.8 18.2,17.4 18.2,4.6',
  c: '18.2,20.6 19.6,19.2 21,20.2 21,34 18.9,36 18.2,33.4',
  d: '6.6,34.2 15.4,34.2 18,37 4,37',
  e: '3.8,20.6 2.4,19.2 1,20.2 1,34 3.1,36 3.8,33.4',
  f: '3.1,2 1,4 1,17.8 2.4,18.8 3.8,17.4 3.8,4.6',
  g: '4,19 5.4,17.6 16.6,17.6 18,19 16.6,20.4 5.4,20.4'
}
const LIT: Record<string, string> = {
  '0': 'abcdef',
  '1': 'bc',
  '2': 'abged',
  '3': 'abgcd',
  '4': 'fgbc',
  '5': 'afgcd',
  '6': 'afgedc',
  '7': 'abc',
  '8': 'abcdefg',
  '9': 'abcdfg',
  '-': 'g',
  ' ': ''
}

export const noDataText = (): string => translate('teamPanel.display.noData', 'No data')

function Digit({ char }: { char: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 22 38" className="h-8 w-[18px] shrink-0" aria-hidden="true">
      {Object.entries(SEGMENTS).map(([key, points]) => (
        <polygon
          key={key}
          points={points}
          className={LIT[char]?.includes(key) ? 'fill-current' : 'fill-foreground/[0.06]'}
        />
      ))}
    </svg>
  )
}

/** A number drawn as segment digits; null draws dashes and reads as "No data". */
export function SegmentNumber({
  value,
  prefix = '',
  unit = '',
  alert = false
}: {
  value: number | null
  prefix?: string
  unit?: string
  alert?: boolean
}): React.JSX.Element {
  const text = value === null ? '--' : String(Math.round(value)).padStart(2, ' ')
  return (
    <span
      role="img"
      aria-label={value === null ? noDataText() : `${prefix}${Math.round(value)}${unit}`}
      className={cn(
        'flex -skew-x-[5deg] items-end gap-[3px] text-foreground',
        alert && 'text-status-attention',
        value === null && 'text-muted-foreground'
      )}
    >
      {prefix && value !== null ? (
        <em className="mr-0.5 text-sm not-italic text-muted-foreground">{prefix}</em>
      ) : null}
      {/* Why keyed by place value: ones stay ones when the number gains a digit. */}
      {[...text].map((char, index, all) => (
        <Digit key={`place-${all.length - 1 - index}`} char={char} />
      ))}
      {unit && value !== null ? (
        <em className="ml-0.5 text-sm not-italic text-muted-foreground">{unit}</em>
      ) : null}
    </span>
  )
}

/** Columns scaled to the peak; the last one, now, is lit. */
export function Bars({ values, className }: { values: number[]; className?: string }) {
  const peak = Math.max(1, ...values)
  return (
    <span className={cn('flex items-end gap-0.5', className)} aria-hidden="true">
      {values.map((value, index) => (
        <i
          key={index}
          className={cn(
            'min-w-0 flex-1 rounded-t-[1px]',
            index === values.length - 1 ? 'bg-foreground' : 'bg-muted-foreground/60'
          )}
          style={{ height: `${Math.max(6, (value / peak) * 100)}%` }}
        />
      ))}
    </span>
  )
}

export function LineChart({ values }: { values: number[] }): React.JSX.Element {
  const low = Math.min(...values)
  const high = Math.max(...values)
  const x = (index: number): number => (index / Math.max(1, values.length - 1)) * 200
  const y = (value: number): number => 42 - ((value - low) / (high - low || 1)) * 38
  const points = values.map((value, index) => `${x(index)},${y(value)}`).join(' ')
  return (
    <svg
      viewBox="0 0 200 44"
      preserveAspectRatio="none"
      className="block h-[26px] w-full"
      aria-hidden="true"
    >
      <polygon points={`0,44 ${points} 200,44`} className="fill-foreground/[0.08]" />
      <polyline
        points={points}
        className="fill-none stroke-foreground"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

/** Twelve cells for a percent; amber from 80 when `hot`. */
export function Blocks({
  percent,
  hot = false,
  className
}: {
  percent: number | null
  hot?: boolean
  className?: string
}) {
  const lit = percent === null ? 0 : percent > 0 ? Math.max(1, Math.round((percent / 100) * 12)) : 0
  return (
    <span
      data-team-display-blocks=""
      className={cn('grid h-[13px] min-w-0 grid-cols-12 gap-[1.5px]', className)}
      aria-hidden="true"
    >
      {Array.from({ length: 12 }, (_, index) => (
        <i
          key={index}
          className={
            index < lit ? (hot ? 'bg-status-warning' : 'bg-foreground') : 'bg-foreground/[0.06]'
          }
        />
      ))}
    </span>
  )
}

/** `wrap` for a note that may take two lines in a narrow panel rather than be cut. */
export function DisplayLabel({
  children,
  className,
  wrap = false
}: {
  children: React.ReactNode
  className?: string
  wrap?: boolean
}) {
  return (
    <span
      className={cn(
        'text-[11px] text-muted-foreground',
        wrap ? 'leading-4' : 'whitespace-nowrap',
        className
      )}
    >
      {children}
    </span>
  )
}

/** What a chart says in place of figures Orca does not have. */
export function NoData({ text }: { text: string }): React.JSX.Element {
  return <span className="text-[11px] leading-4 text-muted-foreground">{text}</span>
}
