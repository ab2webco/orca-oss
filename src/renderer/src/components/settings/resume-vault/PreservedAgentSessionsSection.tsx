import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { SettingsSubsectionHeader } from '../SettingsFormControls'
import { ResumeVaultSheet } from './ResumeVaultSheet'
import { useResumeVaultProjectGroups } from './use-resume-vault-groups'

export function PreservedAgentSessionsSection(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  // Why: mount the sheet (and its useConfirmationDialog() call) only once the user actually
  // opens it. In the running app ConfirmationDialogProvider always wraps this pane, but
  // callers that render AgentsPane standalone (e.g. its static-markup settings-search tests)
  // do not — an eagerly-mounted sheet would throw there for no product-visible benefit.
  const [hasOpened, setHasOpened] = useState(false)
  const groups = useResumeVaultProjectGroups()
  const recordCount = groups.reduce((total, group) => total + group.entries.length, 0)

  const handleOpenChange = (next: boolean): void => {
    if (next) {
      setHasOpened(true)
    }
    setOpen(next)
  }

  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={translate('resumeVault.section.title', 'Preserved Agent Sessions')}
        description={translate(
          'resumeVault.section.description',
          "Orca keeps a resume record when it can't confirm a closed session's agent actually finished its turn. Review and release the ones you don't need."
        )}
        action={
          <Button type="button" variant="outline" size="sm" onClick={() => handleOpenChange(true)}>
            {recordCount > 0
              ? translate('resumeVault.section.manageWithCount', 'Manage ({{value0}})', {
                  value0: recordCount
                })
              : translate('resumeVault.section.manage', 'Manage')}
          </Button>
        }
      />
      {hasOpened ? (
        <ResumeVaultSheet open={open} onOpenChange={handleOpenChange} groups={groups} />
      ) : null}
    </section>
  )
}
