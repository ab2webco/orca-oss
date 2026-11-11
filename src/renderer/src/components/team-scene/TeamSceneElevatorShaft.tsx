import React, { useEffect, useState } from 'react'

type Props = {
  /** The floor keys drawn, top to bottom. */
  rows: string[]
  rowHeight: number
  /** Where the car stands: the lead's floor, or the one it rides to. */
  carAt: string
  /** A report travelling up the tube from this floor to the lead's, or none. */
  envelope: { from: string; id: number } | null
  leadFloor: string
}

/** The building's side: an elevator the lead rides, and a tube that carries reports up. */
export function TeamSceneElevatorShaft({
  rows,
  rowHeight,
  carAt,
  envelope,
  leadFloor
}: Props): React.JSX.Element {
  const car = rows.indexOf(carAt)
  return (
    <div
      aria-hidden="true"
      className="relative w-4 flex-none overflow-hidden bg-muted"
      style={{ height: rows.length * rowHeight }}
    >
      {/* The tube along the shaft's inner wall. */}
      <div className="absolute inset-y-0 left-0.5 w-px bg-border" />
      {car !== -1 ? (
        <div
          data-team-elevator-car={carAt}
          // Why transform: the ride eases between floors without animating layout.
          className="absolute inset-x-1 top-0 rounded-sm bg-scene-bubble ring-1 ring-ring motion-safe:transition-transform motion-safe:duration-700 motion-safe:ease-in-out"
          style={{ height: rowHeight - 16, transform: `translateY(${car * rowHeight + 8}px)` }}
        />
      ) : null}
      {envelope ? (
        <TubeEnvelope
          key={envelope.id}
          from={envelope.from}
          fromRow={rows.indexOf(envelope.from)}
          toRow={rows.indexOf(leadFloor)}
          rowHeight={rowHeight}
        />
      ) : null}
    </div>
  )
}

function TubeEnvelope({
  from,
  fromRow,
  toRow,
  rowHeight
}: {
  from: string
  fromRow: number
  toRow: number
  rowHeight: number
}): React.JSX.Element | null {
  const [arrived, setArrived] = useState(false)
  useEffect(() => {
    const frame = requestAnimationFrame(() => setArrived(true))
    return () => cancelAnimationFrame(frame)
  }, [])
  if (fromRow === -1 || toRow === -1) {
    return null
  }
  const row = arrived ? toRow : fromRow
  return (
    <div
      data-team-tube-envelope={from}
      className="absolute left-0 top-0 h-2 w-1.5 rounded-[1px] bg-card ring-1 ring-ring transition-transform duration-1000 ease-in-out"
      style={{ transform: `translateY(${row * rowHeight + rowHeight / 2}px)` }}
    />
  )
}
