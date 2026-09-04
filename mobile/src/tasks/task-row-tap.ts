type ExternalRowItem = { provider: 'gitlabTodo'; source: { targetUrl: string } }
type PlaneRowItem = { provider: 'plane'; source: { url: string } }
type ActionSheetRowItem = { provider: 'github' | 'gitlab' | 'linear' }

export type TaskRowTapItem = ExternalRowItem | PlaneRowItem | ActionSheetRowItem

export type TaskRowTap<T extends TaskRowTapItem> =
  | { kind: 'open-external'; url: string }
  | { kind: 'plane-detail'; item: Extract<T, PlaneRowItem> }
  | { kind: 'action-sheet'; item: Exclude<T, ExternalRowItem | PlaneRowItem> }

/** Why: Plane opens an in-app read-only detail whether or not the host sent a
 *  url, so a `''` url (the schema default) is never a silent no-op (ORCA-360). */
export function resolveTaskRowTap<T extends TaskRowTapItem>(item: T): TaskRowTap<T>
export function resolveTaskRowTap(item: TaskRowTapItem): TaskRowTap<TaskRowTapItem> {
  if (item.provider === 'gitlabTodo') {
    return { kind: 'open-external', url: item.source.targetUrl }
  }
  if (item.provider === 'plane') {
    return { kind: 'plane-detail', item }
  }
  return { kind: 'action-sheet', item }
}
