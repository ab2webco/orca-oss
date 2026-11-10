import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'

// Minimal states for the shell; ORCA-1070's shared state component replaces them.

export function TeamPanelLoadingState({ rows }: { rows: number }): React.JSX.Element {
  return (
    <div
      className="flex flex-col gap-1.5 px-3 py-2"
      aria-busy="true"
      aria-label={translate('teamPanel.state.loading', 'Loading')}
    >
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="h-9 animate-pulse rounded-md bg-sidebar-accent motion-reduce:animate-none"
        />
      ))}
    </div>
  )
}

export function TeamPanelMessageState({
  title,
  text,
  tone = 'quiet',
  action
}: {
  title: string
  text: string | null
  tone?: 'quiet' | 'error'
  action?: { label: string; onClick: () => void } | null
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-start gap-2 px-3 py-6 text-xs text-muted-foreground">
      <p
        className={cn(
          'text-[13px] font-medium',
          tone === 'error' ? 'text-destructive' : 'text-foreground'
        )}
      >
        {title}
      </p>
      {text ? <p className="break-words">{text}</p> : null}
      {action ? (
        <Button variant="outline" size="xs" onClick={action.onClick}>
          {action.label}
        </Button>
      ) : null}
    </div>
  )
}

export function TeamPanelUnavailableState({ title }: { title: string }): React.JSX.Element {
  return (
    <TeamPanelMessageState
      title={title}
      text={translate('teamPanel.state.unavailableText', 'This Orca host does not publish it yet.')}
    />
  )
}
