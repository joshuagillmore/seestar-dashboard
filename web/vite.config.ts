import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // The dev proxy must point at whatever port the sidecar is actually on.
  // Reading SEESTAR_PORT here — the same variable launcher.py reads — means
  // one change moves both, instead of a working API and a dev server quietly
  // proxying to nothing.
  //
  // loadEnv with a '' prefix picks up SEESTAR_PORT from the repo-root .env
  // (where the rest of the machine's config already lives) as well as the
  // real environment; Vite only exposes VITE_-prefixed vars to client code,
  // so this stays server-side config and nothing leaks into the bundle.
  //
  // 8787 is the default, matching launcher.py. It was 8000 until that
  // collided with Docker Desktop and an unrelated local app.
  const env = loadEnv(mode, '..', '')
  const port = env.SEESTAR_PORT || '8787'

  return {
    plugins: [react()],
    server: {
      proxy: { '/api': `http://127.0.0.1:${port}` },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      globals: true,
    },
  }
})
