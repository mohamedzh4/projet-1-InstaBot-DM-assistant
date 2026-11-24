# InstaBot DM assistant

Instagram DM assistant that turns messages and Reels into notes, watch-later lists, and step-by-step guides. Users follow the bot account, then message it. They earn AI credits by growing the account (story replies, comments, invite-link clicks). Notion and a personal AI key are optional, on a single settings page — not a full website.

Do not commit `.dev.vars`, `.env`, or API keys. Copy `.env.example` and fill secrets locally (or with `wrangler secret put` in production).

## Run it now (no Instagram yet)

```bash
npm install
npm run local
```

Open http://127.0.0.1:8787/dev — same bot logic as DMs (credits, story reply, comments, invites, notes). Turn `ALLOW_DEV_INBOX` off before production.

Without Groq/Gemini/OpenAI, a local extractor handles notes / watch-later / steps. Add a real key later for Reels.

## Follow first

Ask people to **follow** `@yourbot` before using it. In Instagram, set who can message you to **followers** so non-followers never reach the webhook.

Instagram’s API **cannot** tell us “this IGSID followed you.” There is no follower webhook and no likes-from-user list. Follow is enforced by that Instagram setting, not by our database.

## Credits (only what Instagram can detect)

| User action | Can we see who did it? | Credits |
|---|---|---|
| Follow the account | **No** | Use IG “followers can message” |
| Like a post | **No** | — |
| Share the profile to a friend’s DM (they never click our link) | **No** | — |
| Friend **opens your invite link** and messages the bot | **Yes** | Inviter gets credits |
| Reply to our story | **Yes** | Credits (once per story) |
| Tag `@bot` in their story | **Yes** (public accounts / followers) | Credits |
| Comment on our post / live | **Yes** | Credits |
| Mention us in a comment | **Yes** | Credits |

Invite link (better than typing a code):

`https://ig.me/m/YOURBOT?ref=ABC12`

Shared AI **spends** credits. A personal API key on the settings page does not.

## Commands

`help` · `credits` · `settings` · `invite` · `join CODE`  
`list` · `watch later` · `steps`  
`save chat` · `save brain` · `save notion`

Save modes: **chat** (reply and forget), **brain** (our database, after some growth credits), **notion** (optional).

## Instagram token (Generate token is often broken)

Meta’s **Generate token** button frequently does nothing after login. Skip it.

1. In the Meta app, finish **Instagram → API setup with Instagram login → 4. Set up Instagram business login**.
2. Set **OAuth redirect URIs** to exactly `https://localhost/`
3. Copy **Instagram app ID** and **Instagram app secret** (not the Facebook ones) into `.dev.vars` as `INSTAGRAM_APP_ID` and `IG_APP_SECRET`.
4. Either open http://127.0.0.1:8787/setup/ig while `npm run local` is running, or run `npm run ig-token`.
5. Log in as the **bot** Instagram. The browser will fail to load `https://localhost/` — copy the full address bar (`?code=...`) and paste it into the helper.
6. Put the long-lived token in `IG_ACCESS_TOKEN`. Never commit it or paste it in chat.

## Setup

1. Professional Instagram account. Message controls: followers only.
2. Meta app webhook `https://YOUR_WORKER/webhook`. Subscribe to **messages**, **messaging_referral**, **messaging_postbacks**, **comments**, **mentions**, **live_comments**.
3. Cloudflare:

```bash
cp .env.example .dev.vars
# PUBLIC_URL, IG_*, ENCRYPTION_KEY (`openssl rand -hex 32`), GROQ_API_KEY, BOT_NAME=your.ig.username

npx wrangler d1 create instabot
# paste database_id into wrangler.jsonc

npx wrangler d1 migrations apply instabot --local
npm run dev
```

4. Deploy: `npx wrangler d1 migrations apply instabot --remote`, `wrangler secret put …`, `npm run deploy`.

5. Notion (optional): redirect `https://YOUR_WORKER/auth/notion/callback`.

6. Local fake DMs (`ALLOW_DEV_INBOX=true` only on your machine):

```bash
curl -X POST http://127.0.0.1:8787/dev/inbox \
  -H 'content-type: application/json' \
  -H 'X-Dev-Secret: your-dev-secret' \
  -d '{"igsid":"test-user-1","text":"help"}'
```
