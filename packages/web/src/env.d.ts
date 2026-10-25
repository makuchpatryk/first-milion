/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY: string
  readonly VITE_FIREBASE_PROJECT_ID: string
  /** Worker origin for the game sockets; `http(s)` or `ws(s)`, no token in it (NFR-004). */
  readonly VITE_WORKER_URL: string
  /** Dev only: Firebase Auth emulator URL (PRD §20 #35). */
  readonly VITE_AUTH_EMULATOR_URL?: string
}

/** Release version from the root `package.json`, replaced at build time (`vite.config.ts`). */
declare const __APP_VERSION__: string

interface ImportMeta {
  readonly env: ImportMetaEnv
}
