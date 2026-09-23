import '@testing-library/jest-dom/vitest'
import { configure } from '@testing-library/react'

/**
 * `findBy*` / `waitFor` give up after Testing Library's own
 * `asyncUtilTimeout`, which defaults to 1000 ms and is separate from Vitest's
 * `testTimeout`. Commit 00077c5 raised `testTimeout` to 15 s in
 * vite.config.ts because a loaded machine failed tests with nothing wrong with
 * them — but that only widened the outer hang detector. The ~130 `findBy*` /
 * `waitFor` calls in this suite were still bounded at 1 s, and single tests
 * have been measured at up to 3.2 s under load, so the same flake survived one
 * layer down: an element that would have appeared at 1.2 s fails as "Unable to
 * find", which reads as a real defect.
 *
 * 5 s is comfortably above that worst case and still well inside the 15 s
 * test budget, so a genuinely missing element still fails fast enough to name
 * itself rather than being reported as a whole-test timeout. Like
 * `testTimeout`, this is a patience setting, not an assertion — raising it
 * costs no coverage.
 */
configure({ asyncUtilTimeout: 5000 })

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
