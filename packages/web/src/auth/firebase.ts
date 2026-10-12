import { initializeApp } from 'firebase/app'
import {
  browserLocalPersistence,
  browserSessionPersistence,
  connectAuthEmulator,
  indexedDBLocalPersistence,
  initializeAuth,
} from 'firebase/auth'

const app = initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: `${import.meta.env.VITE_FIREBASE_PROJECT_ID}.firebaseapp.com`,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
})

// Same persistence as `getAuth` (the session stays across reloads), but no popup/redirect
// resolver: `getAuth` adds one, and with it a Google script and an auth iframe on every first
// visit (NFR-005: LCP of the login page). Email/password only, so no resolver is needed.
export const auth = initializeAuth(app, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence],
})

// Double guard: the emulator URL can never reach a production build (PRD §20 #35).
const emulatorUrl = import.meta.env.VITE_AUTH_EMULATOR_URL
if (import.meta.env.DEV && emulatorUrl) {
  connectAuthEmulator(auth, emulatorUrl, { disableWarnings: true })
}
