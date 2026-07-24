// Why: monochrome paper-plane mark (Plane's product name) so the task-tracker
// icon set (Jira/Linear) stays visually consistent via currentColor sizing.
export function PlaneIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="currentColor">
      <path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z" />
    </svg>
  )
}
