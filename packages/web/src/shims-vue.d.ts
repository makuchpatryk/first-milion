// typescript-eslint (type-aware) cannot resolve `.vue` imports; vue-tsc does, this shim serves lint.
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent
  export default component
}
