type RendererTerminalCreateFailureActions = {
  reply: (failure: { requestId: string; tabId: string; error: string }) => void
  closeTab: (tabId: string) => void
}

const pendingRequestIdsByTabId = new Map<string, string>()

export function registerRendererBackedTerminalCreate(tabId: string, requestId: string): void {
  pendingRequestIdsByTabId.set(tabId, requestId)
}

export function completeRendererBackedTerminalCreate(tabId: string): void {
  pendingRequestIdsByTabId.delete(tabId)
}

export function failRendererBackedTerminalCreate(
  tabId: string,
  error: string,
  actions: RendererTerminalCreateFailureActions
): boolean {
  const requestId = pendingRequestIdsByTabId.get(tabId)
  if (!requestId) {
    return false
  }
  pendingRequestIdsByTabId.delete(tabId)
  actions.reply({ requestId, tabId, error })
  actions.closeTab(tabId)
  return true
}
