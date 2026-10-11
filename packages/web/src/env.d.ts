/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY: string
  readonly VITE_FIREBASE_PROJECT_ID: string
  /** Dev only: Firebase Auth emulator URL (PRD §20 #35). */
  readonly VITE_AUTH_EMULATOR_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
