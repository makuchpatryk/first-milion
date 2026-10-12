import { describe, expect, it, vi } from 'vitest'
import { closeKey } from '../room/error-map'
import { NO_CONNECTION, unreachableSocket } from './unreachable'

describe('unreachableSocket (no VITE_WORKER_URL)', () => {
  it('reports a network loss at once and never opens a socket', () => {
    const onStatus = vi.fn()
    unreachableSocket({ onStatus })
    expect(onStatus).toHaveBeenCalledTimes(1)
    expect(onStatus).toHaveBeenCalledWith('closed', NO_CONNECTION)
    expect(closeKey(NO_CONNECTION)).toBe('close.network')
  })

  it('drops sends and tolerates close and refresh', () => {
    const handle = unreachableSocket({ onStatus: () => undefined })
    expect(() => {
      handle.send({ type: 'room.leave' })
      handle.refreshToken()
      handle.close()
      handle.close()
    }).not.toThrow()
  })
})
