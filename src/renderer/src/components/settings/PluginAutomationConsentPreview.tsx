import type { PluginHostListEntry } from '../../../../preload/api-types'
import { translate } from '@/i18n/i18n'

type AutomationPreview = NonNullable<PluginHostListEntry['automations']>[number]

export function PluginAutomationConsentPreview({
  automations
}: {
  automations: readonly AutomationPreview[]
}): React.JSX.Element | null {
  if (automations.length === 0) {
    return null
  }
  return (
    <section className="space-y-3" aria-labelledby="plugin-automation-consent-heading">
      <h3
        id="plugin-automation-consent-heading"
        className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground"
      >
        {translate(
          'auto.components.settings.PluginAutomationConsentPreview.heading',
          'Scheduled automations'
        )}
      </h3>
      {automations.map((automation) => (
        <div key={automation.id} className="space-y-2 rounded-md border border-border p-3">
          <p className="text-sm font-medium">{automation.title}</p>
          <dl className="space-y-2">
            <div>
              <dt className="mb-1 text-xs text-muted-foreground">
                {translate(
                  'auto.components.settings.PluginAutomationConsentPreview.schedule',
                  'Schedule'
                )}
              </dt>
              <dd className="font-mono text-xs leading-5">{automation.trigger}</dd>
            </div>
            {automation.command ? (
              <div>
                <dt className="mb-1 text-xs text-muted-foreground">
                  {translate(
                    'auto.components.settings.PluginAutomationConsentPreview.command',
                    'Command'
                  )}
                </dt>
                <dd>
                  <pre
                    tabIndex={0}
                    aria-label={translate(
                      'auto.components.settings.PluginAutomationConsentPreview.commandLabel',
                      '{{value0}} · command',
                      { value0: automation.title }
                    )}
                    className="max-h-40 overflow-auto scrollbar-sleek whitespace-pre-wrap break-all rounded-md bg-muted px-2.5 py-2 font-mono text-xs leading-5 text-foreground"
                  >
                    {automation.command}
                  </pre>
                </dd>
              </div>
            ) : (
              <div>
                <dt className="mb-1 text-xs text-muted-foreground">
                  {translate(
                    'auto.components.settings.PluginAutomationConsentPreview.runs',
                    'Runs'
                  )}
                </dt>
                <dd className="text-xs leading-5">
                  {translate(
                    'auto.components.settings.PluginAutomationConsentPreview.agentRun',
                    'Launches a coding agent with the prompt shipped inside the plugin.'
                  )}
                </dd>
              </div>
            )}
          </dl>
        </div>
      ))}
    </section>
  )
}
