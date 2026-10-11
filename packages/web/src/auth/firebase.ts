import { initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth } from 'firebase/auth'

const app = initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: `${import.meta.env.VITE_FIREBASE_PROJECT_ID}.firebaseapp.com`,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
})

export const auth = getAuth(app)

// Double guard: the emulator URL can never reach a production build (PRD §20 #35).
const emulatorUrl = import.meta.env.VITE_AUTH_EMULATOR_URL
if (import.meta.env.DEV && emulatorUrl) {
  connectAuthEmulator(auth, emulatorUrl, { disableWarnings: true })
}
