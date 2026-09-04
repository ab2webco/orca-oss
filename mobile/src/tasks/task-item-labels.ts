type GitHubLabelItem = { provider: 'github'; source: { type: 'issue' | 'pr'; state: string } }
type GitLabLabelItem = { provider: 'gitlab'; source: { type: 'issue' | 'mr'; state: string } }
type GitLabTodoLabelItem = { provider: 'gitlabTodo'; source: { targetType: string } }
type PlaneLabelItem = { provider: 'plane' }
type LinearLabelItem = { provider: 'linear' }

export type TaskLabelItem =
  | GitHubLabelItem
  | GitLabLabelItem
  | GitLabTodoLabelItem
  | PlaneLabelItem
  | LinearLabelItem

export type ActionableTaskLabelItem = GitHubLabelItem | GitLabLabelItem | LinearLabelItem

export function gitLabTodoTargetLabel(todo: { targetType: string }): string {
  if (todo.targetType === 'MergeRequest') {
    return 'Merge request'
  }
  if (todo.targetType === 'Issue') {
    return 'Issue'
  }
  return 'GitLab todo'
}

export function taskKindLabel(item: TaskLabelItem): string {
  if (item.provider === 'github') {
    return item.source.type === 'pr' ? 'Pull request' : 'Issue'
  }
  if (item.provider === 'gitlab') {
    return item.source.type === 'mr' ? 'Merge request' : 'Issue'
  }
  if (item.provider === 'gitlabTodo') {
    return `${gitLabTodoTargetLabel(item.source)} todo`
  }
  if (item.provider === 'plane') {
    return 'Plane work item'
  }
  return 'Linear ticket'
}

export function taskExternalOpenLabel(item: ActionableTaskLabelItem): string {
  if (item.provider === 'github') {
    return 'Open in GitHub'
  }
  if (item.provider === 'gitlab') {
    return 'Open in GitLab'
  }
  return 'Open in Linear'
}

export function taskStatusActionLabel(item: ActionableTaskLabelItem): string {
  const verb =
    item.provider === 'github' || item.provider === 'gitlab'
      ? item.source.state === 'closed'
        ? 'Reopen'
        : 'Close'
      : ''
  return verb ? `${verb} ${taskKindLabel(item).toLowerCase()}` : ''
}
