// In-memory AsyncStorage for tests: what `vi.mock('@react-native-async-storage/async-storage')`
// returns. Kept import-free so a mock factory can load it without cycling into the app modules.
export const deviceStorage = {
  entries: new Map<string, string>(),
  getItem: async (key: string): Promise<string | null> => deviceStorage.entries.get(key) ?? null,
  setItem: async (key: string, value: string): Promise<void> => {
    deviceStorage.entries.set(key, value)
  },
  removeItem: async (key: string): Promise<void> => {
    deviceStorage.entries.delete(key)
  }
}

export default deviceStorage
