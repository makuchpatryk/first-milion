// Types for `import { env, exports } from 'cloudflare:workers'` in the integration tests.
declare namespace Cloudflare {
  interface GlobalProps {
    mainModule: typeof import('../../src/index')
  }
  interface Env {
    ROOM: DurableObjectNamespace
    LOBBY: DurableObjectNamespace
  }
}
