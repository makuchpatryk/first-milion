// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('firebase/auth', () => ({ onAuthStateChanged: vi.fn() }))
vi.mock('../auth/firebase', () => ({ auth: { currentUser: null } }))

import { session } from '../auth/session'
import en from '../i18n/en.json'
import pl from '../i18n/pl.json'
import { mountWithApp } from '../test-support'
import PrivacyView from './PrivacyView.vue'

beforeEach(() => {
  session.status = 'out'
  session.user = null
})

describe('PrivacyView', () => {
  it('FR-018: the Polish policy shows account data, infrastructure, results and deletion', async () => {
    const { wrapper } = await mountWithApp(PrivacyView, 'pl')
    for (const body of [pl.privacy.dataBody, pl.privacy.infraBody, pl.privacy.gameBody]) {
      expect(wrapper.text()).toContain(body)
    }
    expect(wrapper.text()).toContain(pl.privacy.deleteBody)
  })

  it('FR-018 / FR-019: the English policy shows the same sections', async () => {
    const { wrapper } = await mountWithApp(PrivacyView, 'en')
    for (const body of [en.privacy.dataBody, en.privacy.infraBody, en.privacy.gameBody]) {
      expect(wrapper.text()).toContain(body)
    }
    expect(wrapper.text()).toContain(en.privacy.deleteBody)
  })

  it('FR-018: the way back follows the visitor status', async () => {
    const back = async () => {
      const { wrapper } = await mountWithApp(PrivacyView, 'pl')
      return wrapper.find('a').attributes('href')
    }
    expect(await back()).toBe('/login')

    session.status = 'unverified'
    expect(await back()).toBe('/verify')

    session.status = 'verified'
    expect(await back()).toBe('/menu')
  })
})
