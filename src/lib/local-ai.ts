import type { AiIntent } from "../types"

// Unicode-aware word match: `\b` breaks next to accented letters like "à" or "é".
function hasWord(text: string, words: string): boolean {
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:${words})(?![\\p{L}\\p{N}])`, "iu").test(text)
}

const WATCH_WORDS = "films?|movies?|s[ée]ries?|watch later|[àa] regarder|[àa] voir"
const STEP_WORDS = "steps?|[ée]tapes?|how to|comment faire|tutos?|tutorials?"
const SHOW_WORDS = "show|list|liste|mes notes|watch later|[ée]tapes|steps"

// Strip bullets / numbering at the start of a line ("- ", "• ", "1. ", "2) ").
function cleanLine(line: string): string {
  return line.replace(/^[\s*•\-]*(?:\d+[.)]\s*)?/u, "").trim()
}

function lines(text: string): string[] {
  return text.split(/\n+/).map(cleanLine).filter(Boolean)
}

// "films à voir: Dune, X" → { label: "films à voir", rest: "Dune, X" }
function splitLabel(text: string): { label?: string; rest: string } {
  const m = text.match(/^([^:\n]{1,60}):\s*([\s\S]+)$/u)
  if (!m) return { rest: text }
  return { label: m[1].trim(), rest: m[2].trim() }
}

// Inline numbered steps on one line: "1. boil 2. add 3. drain".
function inlineSteps(text: string): string[] {
  const parts = text.split(/(?:^|\s)\d+[.)]\s+/u).map((s) => s.trim()).filter(Boolean)
  return parts
}

export function interpretLocal(userText: string, transcript?: string): AiIntent {
  const blob = `${userText}\n${transcript || ""}`.trim()

  const looksLikeContent = /[:,\n]/.test(userText)
  if (!looksLikeContent && userText.length < 40 && hasWord(userText, SHOW_WORDS)) {
    const list = hasWord(userText, WATCH_WORDS)
      ? "watch_later"
      : hasWord(userText, STEP_WORDS)
        ? "steps"
        : "all"
    return { action: "show", list, reply: "Here is what I have." }
  }

  if (hasWord(blob, WATCH_WORDS) || /\b(2025|2026)\b/.test(blob)) {
    const { label, rest } = splitLabel(blob)
    const fromLines = lines(rest).filter((l) => !/^(save|best)\b/i.test(l))
    const fromComma = rest
      .split(/,|\n| et | and /i)
      .map(cleanLine)
      .filter((s) => s.length > 1 && s.length < 80)
    const picked = (fromLines.length >= 2 ? fromLines : fromComma).slice(0, 20)
    if (picked.length) {
      return {
        action: "watch_later",
        title: label && label.length <= 40 ? label : "Watch later",
        items: picked,
        reply: `Added ${picked.length} to watch later.`,
      }
    }
  }

  if (hasWord(blob, STEP_WORDS) || /(?:^|\s)\d+[.)]\s/m.test(blob)) {
    const { label, rest } = splitLabel(blob)
    const multi = lines(rest)
    const steps = multi.length >= 2 ? multi : inlineSteps(rest)
    if (steps.length) {
      return {
        action: "steps",
        title: (label || "Steps").slice(0, 80),
        content: steps.map((s, i) => `${i + 1}. ${s}`).join("\n"),
        reply: `Saved ${steps.length} clear steps.`,
      }
    }
  }

  if (!blob) return { action: "chat", reply: "Send a note, a Reel, or a how-to." }

  const { label, rest } = splitLabel(blob)
  if (label) {
    return { action: "save_note", title: label.slice(0, 80), content: rest.slice(0, 4000), reply: "Saved." }
  }
  const [first, ...others] = blob.split("\n")
  return {
    action: "save_note",
    title: others.length ? "Note" : cleanLine(first).slice(0, 80) || "Note",
    content: blob.slice(0, 4000),
    reply: "Saved.",
  }
}
