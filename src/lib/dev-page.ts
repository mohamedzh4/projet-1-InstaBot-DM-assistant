export function devChatPage(secret: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>InstaBot local</title>
  <style>
    :root { color-scheme: dark; }
    body { margin:0; font-family: ui-sans-serif, system-ui, sans-serif; background:#0b0b0f; color:#f4f4f5; }
    main { max-width: 32rem; margin:0 auto; min-height:100vh; display:flex; flex-direction:column; }
    header { padding:1rem; border-bottom:1px solid #27272a; }
    header p { margin:.35rem 0 0; color:#a1a1aa; font-size:.85rem; }
    #log { flex:1; padding:1rem; display:flex; flex-direction:column; gap:.6rem; overflow:auto; }
    .me, .bot { max-width:85%; padding:.7rem .85rem; border-radius:14px; white-space:pre-wrap; font-size:.92rem; line-height:1.4; }
    .me { align-self:flex-end; background:#fff; color:#000; }
    .bot { align-self:flex-start; background:#18181b; border:1px solid #27272a; }
    form { display:flex; gap:.5rem; padding:1rem; border-top:1px solid #27272a; }
    input[type=text] { flex:1; background:#18181b; color:#fff; border:1px solid #3f3f46; border-radius:12px; padding:.75rem; }
    button { background:#fff; color:#000; border:0; border-radius:12px; padding:.75rem 1rem; font-weight:650; }
    .row { display:flex; flex-wrap:wrap; gap:.4rem; padding:0 1rem 1rem; }
    .row button { background:#27272a; color:#fff; font-weight:500; font-size:.8rem; }
    .meta { color:#71717a; font-size:.75rem; padding:0 1rem 1rem; }
  </style>
</head>
<body>
<main>
  <header>
    <strong>InstaBot — local chat</strong>
    <p>Same logic as Instagram DMs. This page is off in production. Follow is simulated: you are already a “follower” here.</p>
  </header>
  <div id="log"></div>
  <div class="row">
    <button type="button" data-act="help">help</button>
    <button type="button" data-act="credits">credits</button>
    <button type="button" data-act="story">reply to story</button>
    <button type="button" data-act="comment">comment on post</button>
    <button type="button" data-act="invite">friend clicks invite</button>
    <button type="button" data-act="films">sample films</button>
  </div>
  <form id="f">
    <input id="t" type="text" placeholder="Message the bot…" autocomplete="off" />
    <button type="submit">Send</button>
  </form>
  <p class="meta" id="status"></p>
</main>
<script>
const secret = ${JSON.stringify(secret)};
const igsid = "local-user-1";
const log = document.getElementById("log");
const status = document.getElementById("status");
function add(cls, text) {
  const d = document.createElement("div");
  d.className = cls;
  d.textContent = text;
  log.appendChild(d);
  log.scrollTop = log.scrollHeight;
}
async function send(body) {
  const res = await fetch("/dev/inbox", {
    method: "POST",
    headers: { "content-type": "application/json", "X-Dev-Secret": secret },
    body: JSON.stringify({ igsid, ...body }),
  });
  const data = await res.json();
  if (!res.ok) { add("bot", data.error || res.statusText); return; }
  for (const line of data.replies || []) add("bot", line);
  if (data.user) status.textContent = "credits " + data.user.credits + " · earned " + data.user.credits_earned + " · code " + data.user.invite_code + " · " + data.user.storage_mode;
}
document.getElementById("f").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = document.getElementById("t").value.trim();
  if (!text) return;
  add("me", text);
  document.getElementById("t").value = "";
  send({ text });
});
document.querySelectorAll("[data-act]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const act = btn.getAttribute("data-act");
    if (act === "help") { add("me", "help"); send({ text: "help" }); }
    if (act === "credits") { add("me", "credits"); send({ text: "credits" }); }
    if (act === "story") { add("me", "[reply to story]"); send({ storyId: "story-" + Date.now() }); }
    if (act === "comment") { add("me", "[comment on post]"); send({ comment: true, commentId: "c-" + Date.now() }); }
    if (act === "invite") { add("me", "[friend opens invite]"); send({ friendClick: true }); }
    if (act === "films") { add("me", "watch later: Dune, Sinners, One Battle After Another"); send({ text: "watch later: Dune, Sinners, One Battle After Another" }); }
  });
});
send({ text: "help" });
</script>
</body>
</html>`
}
