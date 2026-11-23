// Why booked, not simulated: every trip is laid out when the round is planned, so the cab's place at
// any moment is a lookup and a frozen frame (reduced motion) still shows it at a floor.

/** One trip of the cab, in floor indexes; it eases from `from` to `to` between `start` and `end`. */
export type Office3dCabRide = {
  from: number
  to: number
  start: number
  end: number
  /** Who rides it, up to the cab's capacity; the cab coming for a caller carries nobody. */
  riders?: number
}

/** The one glass cab every floor shares, and when it is next free. */
export type Office3dCab = { rides: Office3dCabRide[]; freeAt: number; home: number }

/** How long the doors stay open while someone steps in, and after they step out. */
const BOARD = 1
const ALIGHT = 1.1

export const office3dCab = (home = 0): Office3dCab => ({ rides: [], freeAt: -Infinity, home })

/** A ride's length: a short start, then per floor; faster paces ride faster too. */
export const office3dRideDur = (from: number, to: number, speed = 1): number =>
  (0.8 + Math.abs(from - to) * 1.15) / speed

const ease = (x: number): number => {
  const k = Math.min(1, Math.max(0, x))
  return k * k * (3 - 2 * k)
}

/** Where the cab is at `t`, as a floor index that may sit between floors while it rides. */
export function office3dCabFloorAt(cab: Office3dCab, t: number): number {
  let at = cab.home
  for (const r of cab.rides) {
    if (t < r.start) {
      break
    }
    if (t <= r.end) {
      return r.from + (r.to - r.from) * ease((t - r.start) / (r.end - r.start))
    }
    at = r.to
  }
  return at
}

/**
 * How long a rider ready at `earliest` would wait for the cab beyond its own trip to `from`: the
 * time it spends serving riders booked first. Books nothing.
 */
export function office3dCabBusyFor(
  cab: Office3dCab,
  from: number,
  to: number,
  earliest: number,
  speed = 1
): number {
  const probe: Office3dCab = { ...cab, rides: cab.rides.map((r) => ({ ...r })) }
  const booked = probe.rides.length
  const { board } = bookOffice3dCab(probe, from, to, earliest, speed)
  const fetch = probe.rides.slice(booked).find((r) => r.to === from && r.from !== from)
  return Math.max(0, board - earliest - (fetch ? fetch.end - fetch.start : 0))
}

/**
 * Books the cab from floor `from` to `to`, no earlier than `earliest`: it first comes to `from` if
 * it is elsewhere, waits while the rider boards, then rides. Riders queue; a second booking starts
 * once the first has stepped out.
 */
export function bookOffice3dCab(
  cab: Office3dCab,
  from: number,
  to: number,
  earliest: number,
  speed = 1,
  capacity = 1
): { board: number; depart: number; arrive: number; seat: number } {
  // Why join a booked ride: riders queued at one door for one floor board together, in order.
  const shared = cab.rides.find(
    (r) => r.from === from && r.to === to && r.start >= earliest && (r.riders ?? 0) < capacity
  )
  if (shared) {
    const seat = shared.riders ?? 0
    shared.riders = seat + 1
    return {
      board: Math.max(earliest, shared.start - BOARD / speed),
      depart: shared.start,
      arrive: shared.end,
      seat
    }
  }
  let t = Math.max(earliest, cab.freeAt)
  const at = Math.round(office3dCabFloorAt(cab, t))
  if (at !== from) {
    const dur = office3dRideDur(at, from, speed)
    cab.rides.push({ from: at, to: from, start: t, end: t + dur, riders: 0 })
    t += dur
  }
  const board = t
  const depart = t + BOARD / speed
  const arrive = from === to ? depart : depart + office3dRideDur(from, to, speed)
  if (from !== to) {
    cab.rides.push({ from, to, start: depart, end: arrive, riders: 1 })
  }
  cab.freeAt = arrive + ALIGHT / speed
  return { board, depart, arrive, seat: 0 }
}
