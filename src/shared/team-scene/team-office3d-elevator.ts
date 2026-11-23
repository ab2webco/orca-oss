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
  /** Its doors: fully open at `from` from `open`, shut again at `to` by `shut`; `door` is one swing. */
  open?: number
  shut?: number
  door?: number
}

/** The one glass cab every floor shares, and when it is next free. */
export type Office3dCab = { rides: Office3dCabRide[]; freeAt: number; home: number }

/** One swing of the doors; how long they stay open once a rider is in, so the next in line joins it,
 * and once it steps out. */
const DOOR = 0.5
export const OFFICE3D_DOOR_SWING = DOOR
const LINGER = 0.8
const ALIGHT = 1.6

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
  return Math.max(0, board - DOOR / speed - earliest - (fetch ? fetch.end - fetch.start : 0))
}

const swing = (t: number, opens: number, shuts: number, door: number): number =>
  Math.min(1, Math.max(0, Math.min((t - opens) / door + 1, (shuts - t) / door)))

/** How open floor `floor`'s lift doors are at `t`, 0 shut to 1 open: only for the riders it serves. */
export function office3dCabDoorsAt(cab: Office3dCab, floor: number, t: number): number {
  let open = 0
  for (const r of cab.rides) {
    if (!r.riders || r.open === undefined || r.shut === undefined || !r.door) {
      continue
    }
    if (r.from === floor) {
      open = Math.max(open, swing(t, r.open, r.start, r.door))
    }
    if (r.to === floor) {
      open = Math.max(open, swing(t, r.end + r.door, r.shut, r.door))
    }
  }
  return open
}

/**
 * Books the cab from floor `from` to `to` for a rider at its door from `earliest`: the cab first
 * comes to `from` if it is elsewhere, and the rider steps in only once the doors are fully open
 * (`board`), takes `walkIn` to reach its spot, and the doors shut before it departs. At `to` it
 * steps out at `out`, once they are open again. Riders queue; a second booking waits for the first.
 */
export function bookOffice3dCab(
  cab: Office3dCab,
  from: number,
  to: number,
  earliest: number,
  speed = 1,
  capacity = 1,
  walkIn = 0
): { board: number; depart: number; arrive: number; out: number; seat: number } {
  const door = DOOR / speed
  // Why join a booked ride: riders queued at one door for one floor board together, in order.
  const shared = cab.rides.find(
    (r) =>
      r.from === from &&
      r.to === to &&
      (r.riders ?? 0) < capacity &&
      r.open !== undefined &&
      Math.max(earliest, r.open) + walkIn <= r.start - door
  )
  if (shared) {
    const seat = shared.riders ?? 0
    shared.riders = seat + 1
    return {
      board: Math.max(earliest, shared.open!),
      depart: shared.start,
      arrive: shared.end,
      out: shared.end + door,
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
  const board = t + door
  const depart = board + walkIn + (LINGER + DOOR) / speed
  const arrive = from === to ? depart : depart + office3dRideDur(from, to, speed)
  const shut = arrive + door + ALIGHT / speed
  if (from !== to) {
    cab.rides.push({ from, to, start: depart, end: arrive, riders: 1, open: board, shut, door })
  }
  cab.freeAt = shut
  return { board, depart, arrive, out: arrive + door, seat: 0 }
}

/**
 * Cuts the cab's bookings at `now` for a building whose floors changed: a ride under way goes on
 * from `at` to its floor, doors already opening stay open a moment for whoever is in them, and
 * nothing later stays booked. Returns when the ride under way, if any, now ends.
 */
export function office3dCabCut(
  cab: Office3dCab,
  now: number,
  at: number,
  speed = 1
): number | null {
  const door = DOOR / speed
  const rides = cab.rides.filter((r) => r.end < now)
  const going = cab.rides.find((r) => r.start <= now && now <= r.end)
  const opening = cab.rides.find(
    (r) => r.start > now && r.riders && r.open !== undefined && r.open - (r.door ?? door) < now
  )
  let end: number | null = null
  if (going) {
    end = now + office3dRideDur(at, going.to, speed)
    const shut = going.shut === undefined ? undefined : end + door + ALIGHT / speed
    rides.push({ ...going, from: at, start: now, end, shut })
  } else if (opening) {
    // Why a ride that goes nowhere: it holds those doors open until whoever is in them is out.
    const s = Math.max(now, opening.open!) + 2.5 / speed
    rides.push({ ...opening, to: opening.from, start: s, end: s, shut: s })
  }
  cab.rides = rides
  cab.freeAt = Math.max(now, ...rides.map((r) => r.shut ?? r.end))
  return end
}

/** The highest floor the cab stands at or is booked to from `t` on. */
export const office3dCabHighest = (cab: Office3dCab | null, t: number): number =>
  cab
    ? Math.max(
        office3dCabFloorAt(cab, t),
        ...cab.rides.filter((r) => r.end >= t).flatMap((r) => [r.from, r.to])
      )
    : 0
