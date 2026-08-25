import type { SkillDiscoveryResult, SkillDiscoveryTarget } from '../../shared/skills'
import type {
  SkillFreshnessInventory,
  SkillRepairPreview,
  SkillRepairResult,
  SkillUpdateRun,
  SkillUpdateStartResult
} from '../../shared/skill-freshness'

export type SkillsApi = {
  previewRepair: (placementId: string) => Promise<SkillRepairPreview>
  repairUnrecognized: (request: {
    placementId: string
    expectedObservedPackageDigest: string
  }) => Promise<SkillRepairResult>
  discover: (target?: SkillDiscoveryTarget) => Promise<SkillDiscoveryResult>
  freshnessInventory: () => Promise<SkillFreshnessInventory>
  startUpdateRun: (names: string[]) => Promise<SkillUpdateStartResult>
  cancelUpdateRun: () => Promise<void>
  acknowledgeUpdateRun: () => Promise<void>
  getUpdateRun: () => Promise<SkillUpdateRun>
  onUpdateRun: (callback: (run: SkillUpdateRun) => void) => () => void
}
