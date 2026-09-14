import type { Bindings } from "../types"

type EnvWithBag = Bindings & { __replies?: string[] }

export function wrapEnv(env: Bindings): Bindings {
  const wrapped = Object.create(env) as EnvWithBag
  wrapped.__replies = []
  return wrapped
}

export function repliesOf(env: Bindings): string[] {
  return (env as EnvWithBag).__replies ?? []
}

export function recordReply(env: unknown, text: string): void {
  const bag = (env as EnvWithBag).__replies
  bag?.push(text)
}
