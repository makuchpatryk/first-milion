export interface Env {
  ROOM: DurableObjectNamespace
  LOBBY: DurableObjectNamespace
  FIREBASE_PROJECT_ID: string
  ALLOWED_ORIGINS: string
  /** Comma-separated admin UIDs (BR-017). A secret or `.dev.vars`, never public. */
  ADMIN_UIDS: string
  /** Dev only (`.dev.vars`): accept unsigned emulator tokens. Only the exact string `"true"` counts. */
  AUTH_EMULATOR?: string
}

export interface WorkerConfig {
  projectId: string
  adminUids: ReadonlySet<string>
  emulator: boolean
}

export function splitList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '')
}

export function parseEnv(env: Env): WorkerConfig {
  return {
    projectId: env.FIREBASE_PROJECT_ID,
    adminUids: new Set(splitList(env.ADMIN_UIDS)),
    emulator: env.AUTH_EMULATOR === 'true',
  }
}
