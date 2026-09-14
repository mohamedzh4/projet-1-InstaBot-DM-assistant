import type { StorageMode, UserRow } from "../types"

function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

export function settingsPageHtml(opts: {
  token: string
  user: UserRow
  notionEnabled: boolean
  inviteUrl: string
  brainOpen: boolean
  saved?: string
  error?: string
}): string {
  const { token, user, notionEnabled, inviteUrl, brainOpen, saved, error } = opts
  const notionOn = Boolean(user.notion_access_token && user.notion_database_id)
  const keyOn = Boolean(user.ai_api_key)

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>InstaBot settings</title>
  <style>
    :root { color-scheme: dark; }
    body { margin:0; font-family: ui-sans-serif, system-ui, sans-serif; background:#0b0b0f; color:#f4f4f5;
      min-height:100vh; }
    main { max-width: 28rem; margin: 0 auto; padding: 1.25rem; }
    h1 { font-size: 1.25rem; margin: 0 0 .35rem; }
    p.lead { color:#a1a1aa; font-size:.92rem; margin:0 0 1.2rem; line-height:1.45; }
    section { background:#14141b; border:1px solid #27272a; border-radius:16px; padding:1rem; margin-bottom:1rem; }
    h2 { font-size:.95rem; margin:0 0 .75rem; }
    label.choice { display:flex; gap:.7rem; align-items:flex-start; padding:.55rem 0; }
    label.choice span { display:block; color:#a1a1aa; font-size:.82rem; margin-top:.15rem; }
    input, select { width:100%; box-sizing:border-box; background:#0b0b0f; color:#fff; border:1px solid #3f3f46;
      border-radius:10px; padding:.7rem .75rem; font-size:1rem; }
    button, .btn { display:inline-block; width:100%; box-sizing:border-box; text-align:center; text-decoration:none;
      background:#fff; color:#000; border:0; border-radius:12px; padding:.8rem; font-weight:650; font-size:.95rem;
      margin-top:.75rem; }
    .btn.ghost { background:transparent; color:#fff; border:1px solid #3f3f46; }
    .ok { background:#052e16; color:#86efac; padding:.65rem .75rem; border-radius:10px; margin-bottom:1rem; font-size:.9rem; }
    .err { background:#450a0a; color:#fecaca; padding:.65rem .75rem; border-radius:10px; margin-bottom:1rem; font-size:.9rem; }
    .meta { color:#a1a1aa; font-size:.85rem; line-height:1.45; }
    code { background:#27272a; padding:.1rem .35rem; border-radius:6px; }
  </style>
</head>
<body>
<main>
  <h1>Optional extras</h1>
  <p class="lead">You can keep using Instagram DMs only. This page is if you want Notion, your own AI key, or to change where notes are saved.</p>
  ${saved ? `<div class="ok">${esc(saved)}</div>` : ""}
  ${error ? `<div class="err">${esc(error)}</div>` : ""}

  <section>
    <h2>Credits</h2>
    <p class="meta">Balance: <strong>${user.credits}</strong> · earned ${user.credits_earned}<br/>
    Follow the bot, then reply to stories, comment on posts, tag us, or share your invite link. Likes and silent shares cannot be detected.</p>
  </section>

  <form method="post" action="/s/${esc(token)}">
    <section>
      <h2>Where should I save?</h2>
      <label class="choice"><input type="radio" name="storage_mode" value="chat" ${user.storage_mode === "chat" ? "checked" : ""} />
        <div>Chat only<span>I reply in the DM and forget. Nothing stored.</span></div></label>
      <label class="choice"><input type="radio" name="storage_mode" value="server" ${user.storage_mode === "server" ? "checked" : ""} />
        <div>Bot brain<span>${brainOpen ? "Unlocked." : "Earn at least one growth credit (story reply, comment, or invite)."}</span></div></label>
      <label class="choice"><input type="radio" name="storage_mode" value="notion" ${user.storage_mode === "notion" ? "checked" : ""} />
        <div>My Notion<span>${notionOn ? "Connected." : "Connect Notion below. Still optional."}</span></div></label>
    </section>

    <section>
      <h2>Your AI key (optional)</h2>
      <p class="meta">Leave empty to spend bot credits on the shared AI. With your own key, AI does not spend credits.</p>
      <p class="meta" style="margin-top:.5rem">Status: ${keyOn ? `saved (${esc(user.ai_provider || "")})` : "using shared AI + credits"}</p>
      <label class="meta">Provider</label>
      <select name="ai_provider">
        <option value="groq" ${user.ai_provider === "groq" ? "selected" : ""}>Groq</option>
        <option value="gemini" ${user.ai_provider === "gemini" ? "selected" : ""}>Gemini</option>
        <option value="openai" ${user.ai_provider === "openai" ? "selected" : ""}>OpenAI</option>
      </select>
      <label class="meta" style="display:block;margin-top:.6rem">API key</label>
      <input type="password" name="ai_api_key" autocomplete="off" placeholder="${keyOn ? "••••••••  (leave blank to keep)" : "paste key"}" />
      <label class="choice"><input type="checkbox" name="clear_key" value="1" /> <div>Remove my key</div></label>
    </section>

    <button type="submit">Save</button>
  </form>

  <section>
    <h2>Notion (optional)</h2>
    ${
      notionEnabled
        ? `<p class="meta">${notionOn ? "Connected. New saves can go to your InstaBot database." : "Login with Notion and share any page. We create an InstaBot database under it."}</p>
           <a class="btn" href="/s/${esc(token)}/notion">Connect Notion</a>
           ${notionOn ? `<form method="post" action="/s/${esc(token)}"><input type="hidden" name="disconnect_notion" value="1" /><button class="btn ghost" type="submit">Disconnect Notion</button></form>` : ""}`
        : `<p class="meta">Notion login is not enabled on this bot yet.</p>`
    }
  </section>

  <section>
    <h2>Invite friends (credits)</h2>
    <p class="meta">Your code: <code>${esc(user.invite_code)}</code><br/>
    Link: <code>${esc(inviteUrl)}</code><br/>
    ${user.referral_count} friend(s) joined.</p>
  </section>
</main>
</body>
</html>`
}

export function parseMode(value: unknown): StorageMode | null {
  if (value === "chat" || value === "server" || value === "notion") return value
  return null
}
