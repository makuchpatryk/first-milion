import { readonly, ref } from 'vue'

const admin = ref(false)

/** Whether the server called this user an admin (`auth.ok`); false until a game socket says so. */
export const isAdmin = readonly(admin)

/** The only writer: the game sockets on `auth.ok`, and sign-out (always false). */
export function setAdmin(value: boolean): void {
  admin.value = value
}
