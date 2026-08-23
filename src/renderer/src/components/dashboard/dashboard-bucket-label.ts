import { translate } from '@/i18n/i18n'
import type { DashboardBucket } from '../../../../shared/dashboard-snapshot'

/**
 * The one place the buckets are named.
 *
 * Why shared: the board sorts cards into these columns, the grid counts them in
 * a strip and names one per cell. Naming them twice let a cell say "Working"
 * while the strip counted it under Needs You (ORCA-234).
 */
export function dashboardBucketLabel(bucket: DashboardBucket): string {
  switch (bucket) {
    case 'attention':
      return translate('dashboardPopout.bucket.attention', 'Needs You')
    case 'working':
      return translate('dashboardPopout.bucket.working', 'Working')
    case 'done':
      return translate('dashboardPopout.bucket.done', 'Done')
    case 'idle':
      return translate('dashboardPopout.bucket.idle', 'Idle')
  }
}
