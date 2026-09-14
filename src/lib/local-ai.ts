import type { AiIntent } from "../types"

function lines(text: string): string[] {
  return text
    .split(/\n+/)
    .map((l) => l.replace(/^[\s*-•\d.)]+/, "").trim())
    .filter(Boolean)
}

export function interpretLocal(userText: string, transcript?: string): AiIntent {
  const blob = `${userText}\n${transcript || ""}`.trim()
  const lower = blob.toLowerCase()

  if (/\b(show|list|liste|mes notes|watch later|étapes|etapes)\b/i.test(userText) && userText.length < 40) {
    const list = /watch|film|movie/.test(lower)
      ? "watch_later"
      : /step|etape|étape|tuto/.test(lower)
        ? "steps"
        : "all"
    return { action: "show", list, reply: "Here is what I have." }
  }

  if (
    /\b(film|movie|serie|series|watch later|à regarder|a regarder)\b/i.test(lower) ||
    /\b(2025|2026)\b/.test(blob)
  ) {
    const cleaned = blob.replace(/\bwatch later:?\b/gi, " ").replace(/\s+/g, " ").trim()
    const items = lines(cleaned).filter((l) => !/^(save|film|movie|best)/i.test(l))
    const fromComma = cleaned
      .split(/,| et | and /i)
      .map((s) => s.trim())
      .filter((s) => s.length > 1 && s.length < 80)
    const picked = (items.length >= 2 ? items : fromComma).slice(0, 20)
    if (picked.length) {
      return {
        action: "watch_later",
        title: "Watch later",
        items: picked,
        reply: `Added ${picked.length} to watch later.`,
      }
    }
  }

  if (/\b(step|etape|étape|how to|comment (faire|build)|tuto)\b/i.test(lower) || /^\s*\d+[.)]/m.test(blob)) {
    const steps = lines(blob)
    return {
      action: "steps",
      title: "Steps",
      content: steps.map((s, i) => `${i + 1}. ${s}`).join("\n"),
      reply: "Saved as clear steps.",
    }
  }

  if (!blob) return { action: "chat", reply: "Send a note, a Reel, or a how-to." }

  return {
    action: "save_note",
    title: blob.slice(0, 80),
    content: blob.slice(0, 4000),
    reply: "Saved.",
  }
}
