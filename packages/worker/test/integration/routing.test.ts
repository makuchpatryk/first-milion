import { exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { upgrade } from './helpers'

describe('Worker routing (FR-007)', () => {
  it('FR-007 AC: a foreign Origin gets 403 before the upgrade', async () => {
    const response = await upgrade('/ws/lobby', { Origin: 'https://evil.example' })
    expect(response.status).toBe(403)
  })

  it('FR-007: a missing Origin gets 403', async () => {
    expect((await upgrade('/ws/lobby', {})).status).toBe(403)
  })

  it('FR-007: an allowed Origin is upgraded', async () => {
    const response = await upgrade('/ws/lobby')
    expect(response.status).toBe(101)
    response.webSocket?.accept()
    response.webSocket?.close(1000)
  })

  it('a plain HTTP request gets 426', async () => {
    const response = await exports.default.fetch('http://worker.test/ws/lobby')
    expect(response.status).toBe(426)
  })

  it('unknown paths and other methods get 404', async () => {
    expect((await upgrade('/nope')).status).toBe(404)
    const post = await exports.default.fetch('http://worker.test/ws/lobby', { method: 'POST' })
    expect(post.status).toBe(404)
  })

  it('an invalid room id gets 404', async () => {
    expect((await upgrade('/ws/room/not-a-hex-id')).status).toBe(404)
  })

  it('internal Lobby and Room paths are not reachable from outside', async () => {
    for (const path of ['/register', '/deregister', '/init', '/close', '/ws']) {
      const response = await exports.default.fetch(`http://worker.test${path}`, {
        method: 'POST',
        body: '{}',
      })
      expect(response.status).toBe(404)
    }
  })
})
