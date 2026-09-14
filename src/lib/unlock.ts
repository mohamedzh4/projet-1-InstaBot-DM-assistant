import type { Bindings, UserRow } from "../types"
import { brainMinEarned, isBrainUnlocked } from "./credits"

export function brainUnlockHint(user: UserRow, env: Bindings): string {
  if (isBrainUnlocked(user, env)) return "Brain is unlocked."
  const need = brainMinEarned(env)
  return `Brain save unlocks after you earn ${need} growth credit(s). You have earned ${user.credits_earned}. Send credits to see how.`
}
