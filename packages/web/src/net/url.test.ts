import { describe, expect, it } from 'vitest'
import { lobbyPath, roomPath, socketUrl } from './url'

describe('socketUrl (FR-007, NFR-004)', () => {
  it('maps http to ws and https to wss', () => {
    expect(socketUrl('http://localhost:8787', lobbyPath())).toBe('ws://localhost:8787/ws/lobby')
    expect(socketUrl('https://api.example.com', lobbyPath())).toBe('wss://api.example.com/ws/lobby')
  })

  it('keeps an already websocket base', () => {
    expect(socketUrl('wss://api.example.com', lobbyPath())).toBe('wss://api.example.com/ws/lobby')
  })

  it('NFR-004: carries no query string or fragment, so no token can ride in the URL', () => {
    const url = socketUrl('https://api.example.com/?token=abc#x', roomPath('r1'))
    expect(url).toBe('wss://api.example.com/ws/room/r1')
    expect(new URL(url).search).toBe('')
  })

  it('escapes the room id as one path segment', () => {
    expect(socketUrl('https://a.b', roomPath('a/b'))).toBe('wss://a.b/ws/room/a%2Fb')
  })

  it('rejects a base that is not http or ws', () => {
    expect(() => socketUrl('ftp://a.b', lobbyPath())).toThrow()
  })
})
