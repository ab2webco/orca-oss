// Why: the full Plane slice is composed from smaller per-concern fragments
// (connection, work-item detail/list caches, work-item actions, projects) so
// none of them needs a max-lines exception; this file is pure wiring.
import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import { createPlaneConnectionSlice, type PlaneConnectionSlice } from './plane-connection'
import {
  createPlaneWorkItemDetailSlice,
  type PlaneWorkItemDetailSlice
} from './plane-work-item-detail'
import { createPlaneWorkItemListSlice, type PlaneWorkItemListSlice } from './plane-work-item-lists'
import {
  createPlaneWorkItemActionSlice,
  type PlaneWorkItemActionSlice
} from './plane-work-item-actions'
import { createPlaneProjectSlice, type PlaneProjectSlice } from './plane-projects'

export type PlaneSlice = PlaneConnectionSlice &
  PlaneWorkItemDetailSlice &
  PlaneWorkItemListSlice &
  PlaneWorkItemActionSlice &
  PlaneProjectSlice

export type { PlaneWorkItemReadArgs, PlaneFetchOptions } from './plane-work-item-lists'

export const createPlaneSlice: StateCreator<AppState, [], [], PlaneSlice> = (set, get, api) => ({
  ...createPlaneConnectionSlice(set, get, api),
  ...createPlaneWorkItemDetailSlice(set, get, api),
  ...createPlaneWorkItemListSlice(set, get, api),
  ...createPlaneWorkItemActionSlice(set, get, api),
  ...createPlaneProjectSlice(set, get, api)
})
