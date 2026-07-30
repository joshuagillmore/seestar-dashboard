import '@testing-library/jest-dom/vitest'

/**
 * Node 22+'s own experimental `globalThis.localStorage` (gated behind
 * `--localstorage-file`, see the startup warning it prints) shadows jsdom's
 * working implementation in this environment: the property exists and its
 * getter runs without throwing, but returns `undefined` rather than a real
 * Storage object — confirmed directly against this repo's pinned jsdom
 * (30.0.0) and vitest (4.1.10) versions, where constructing a `JSDOM`
 * instance by hand gives a functional `localStorage`, but the one vitest's
 * jsdom environment exposes to test code does not. A small in-memory
 * polyfill sidesteps the conflict entirely rather than depending on how a
 * future Node/vitest/jsdom combination resolves it — real browsers (and this
 * app's actual runtime) are unaffected, since this file only runs for tests.
 */
class MemoryStorage implements Storage {
  private store = new Map<string, string>()

  get length(): number {
    return this.store.size
  }

  clear(): void {
    this.store.clear()
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null
  }

  removeItem(key: string): void {
    this.store.delete(key)
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value))
  }
}

function installMemoryLocalStorage(): void {
  const storage = new MemoryStorage()
  const targets: object[] = [globalThis]
  if (typeof window !== 'undefined') targets.push(window)
  for (const target of targets) {
    try {
      Object.defineProperty(target, 'localStorage', {
        value: storage,
        configurable: true,
        writable: true,
      })
    } catch {
      // Best-effort — if a target's descriptor is truly non-configurable,
      // the other target still gets a working polyfill.
    }
  }
}

installMemoryLocalStorage()
