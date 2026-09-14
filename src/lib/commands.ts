import type { Command, NoteKind, StorageMode } from "../types"

const HELP = /^(help|aide|start|commencer|\?|hi|hello|hey|salut|bonjour)$/i
const SETTINGS = /^(settings|setting|reglages|réglages|setup|notion|key|cle|clé)$/i
const INVITE = /^(invite|invit|code|share|partage)$/i
const CREDITS = /^(credits?|credit|solde|balance)$/i
const JOIN = /^(?:join|code)\s+([a-z0-9]{4,12})$/i
const LIST_ALL = /^(list|liste|notes|show|mes notes)$/i
const LIST_WATCH = /^(watch(?:\s*later)?|films?|a regarder|à regarder)$/i
const LIST_STEPS = /^(steps|etapes|étapes|tutos?)$/i
const MODE_CHAT = /^(?:save|mode|stocke|stockage)\s+(chat|dm|forget|oublie|oublier)$/i
const MODE_BRAIN = /^(?:save|mode|stocke|stockage)\s+(brain|cerveau|server|serveur)$/i
const MODE_NOTION = /^(?:save|mode|stocke|stockage)\s+(notion)$/i

function kindFromList(kind: NoteKind | "all"): Command {
  return { type: "list", kind }
}

export function parseCommand(text: string): Command | null {
  const t = text.trim()
  if (!t) return null
  if (HELP.test(t)) return { type: "help" }
  if (SETTINGS.test(t)) return { type: "settings" }
  if (INVITE.test(t)) return { type: "invite" }
  if (CREDITS.test(t)) return { type: "credits" }
  const join = t.match(JOIN)
  if (join?.[1]) return { type: "join", code: join[1].toUpperCase() }
  if (LIST_WATCH.test(t)) return kindFromList("watch_later")
  if (LIST_STEPS.test(t)) return kindFromList("steps")
  if (LIST_ALL.test(t)) return kindFromList("all")
  if (MODE_CHAT.test(t)) return { type: "mode", mode: "chat" }
  if (MODE_BRAIN.test(t)) return { type: "mode", mode: "server" }
  if (MODE_NOTION.test(t)) return { type: "mode", mode: "notion" }
  return null
}

export function modeLabel(mode: StorageMode): string {
  if (mode === "server") return "brain"
  if (mode === "notion") return "Notion"
  return "chat (send and forget)"
}
