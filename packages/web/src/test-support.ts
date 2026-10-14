import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, type Component } from 'vue'
import { createMemoryHistory, createRouter, RouterView, type Router } from 'vue-router'
import { createAppI18n } from './i18n'
import type { Locale } from './i18n/locale'

const Blank = defineComponent({ render: () => null })

const PATHS = [
  '/',
  '/login',
  '/verify',
  '/single',
  '/settings',
  '/privacy',
  '/rooms',
  '/rooms/new',
  '/rooms/:id',
]

/** Mounts `component` with the real i18n messages and a memory router (component tests only). */
export async function mountWithApp(
  component: Component,
  locale: Locale = 'pl',
  /** Route the component sees while it mounts (`useRoute()` params). */
  path = '/',
): Promise<{ wrapper: VueWrapper; router: Router }> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: PATHS.map((path) => ({ path, component: Blank })),
  })
  await router.push(path)
  await router.isReady()
  // `mount` types the wrapper's component as `any` for a plain `Component`; narrow it once here.
  const wrapper = mount(component, {
    global: { plugins: [createAppI18n(locale), router] },
  }) as VueWrapper
  return { wrapper, router }
}

/**
 * Like `mountWithApp`, but the component is the route at `path` and renders through a
 * `RouterView`, so route guards (`onBeforeRouteLeave`) see it. Other paths are blank.
 */
export async function mountAsRoute(
  component: Component,
  path: string,
  locale: Locale = 'pl',
): Promise<{ wrapper: VueWrapper; router: Router }> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      ...PATHS.filter((p) => p !== path).map((p) => ({ path: p, component: Blank })),
      { path, component },
    ],
  })
  await router.push(path)
  await router.isReady()
  const host = defineComponent({ render: () => h(RouterView) })
  const wrapper = mount(host, { global: { plugins: [createAppI18n(locale), router] } }) as VueWrapper
  return { wrapper, router }
}

/** Finds a button by its visible text; throws so a missing button fails the test clearly. */
export function buttonByText(wrapper: VueWrapper, text: string) {
  const found = wrapper.findAll('button').find((b) => b.text() === text)
  if (!found) throw new Error(`no button with text "${text}"`)
  return found
}
