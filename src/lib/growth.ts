import type { Bindings, CreditKind } from "../types"
import { awardCredit } from "./credits"
import { getUser } from "./db"
import type { IgChangeEvent } from "./instagram"
import { sendInstagramText } from "./instagram"

const FIELD_KIND: Record<string, CreditKind> = {
  comments: "post_comment",
  live_comments: "live_comment",
  mentions: "mention",
}

export async function handleInstagramChange(
  env: Bindings,
  businessId: string | undefined,
  change: IgChangeEvent,
): Promise<void> {
  const field = change.field || ""
  const kind = FIELD_KIND[field]
  if (!kind) return

  const fromId = change.value?.from?.id
  if (!fromId || fromId === businessId) return

  const source =
    change.value?.comment_id ||
    `${field}:${fromId}:${change.value?.media?.id || "unknown"}`

  const result = await awardCredit(env, fromId, kind, `${kind}:${source}`)
  if (!result.awarded) return

  const user = await getUser(env.DB, fromId)
  if (!user?.messaged_at) return

  const label =
    kind === "mention" ? "mention" : kind === "live_comment" ? "live comment" : "comment"
  await sendInstagramText(
    env,
    fromId,
    `+${result.amount} credits for your ${label}. Balance: ${result.credits}. Send credits for more ways to earn.`,
  ).catch(() => {})
}
