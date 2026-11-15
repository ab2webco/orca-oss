/** settings.get's result: the host nests every client setting under `settings`. */
export type SettingsGetResult<T> = { settings: T }

// Why a function: paired clients' tests build their fixtures with it, so a shape change fails them.
export const settingsGetResultOf = <T>(settings: T): SettingsGetResult<T> => ({ settings })
