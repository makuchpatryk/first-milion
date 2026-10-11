import { createRouter, createWebHistory, type RouterHistory } from 'vue-router'
import { ready, session } from '../auth/session'
import { routeFor } from './guards'

/**
 * Screens are lazy chunks so the login page does not pay for the game (NFR-005). There is no
 * `/rooms` route until M5; unknown paths fall through to `/menu`, and the guard sends them on.
 */
export function createAppRouter(
  history: RouterHistory = createWebHistory(import.meta.env.BASE_URL),
) {
  const router = createRouter({
    history,
    routes: [
      { path: '/', redirect: '/menu' },
      { path: '/login', component: () => import('../views/LoginView.vue') },
      { path: '/verify', component: () => import('../views/VerifyView.vue') },
      { path: '/menu', component: () => import('../views/MenuView.vue') },
      { path: '/single', component: () => import('../views/SinglePlayView.vue') },
      { path: '/privacy', component: () => import('../views/PrivacyView.vue') },
      { path: '/:pathMatch(.*)*', redirect: '/menu' },
    ],
  })

  router.beforeEach(async (to) => {
    await ready
    return routeFor(session.status, to.path) ?? true
  })

  return router
}
