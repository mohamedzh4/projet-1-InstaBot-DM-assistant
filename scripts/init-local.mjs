import { existsSync, writeFileSync } from "node:fs"
import { randomBytes } from "node:crypto"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const dest = join(root, ".dev.vars")
if (existsSync(dest)) {
  console.log(".dev.vars already exists")
  process.exit(0)
}

const key = randomBytes(32).toString("hex")
writeFileSync(
  dest,
  `# Local only — never commit. Production uses wrangler secrets.

PUBLIC_URL="http://127.0.0.1:8787"
BOT_NAME="instabot"
IG_VERIFY_TOKEN="local-verify-token"
INSTAGRAM_APP_ID=""
IG_APP_SECRET=""
IG_ACCESS_TOKEN=""
IG_OAUTH_REDIRECT_URI="https://localhost/"
ENCRYPTION_KEY="${key}"

ALLOW_DEV_INBOX="true"
DEV_INBOX_SECRET="local-dev-secret"

CREDIT_STORY_REPLY="2"
CREDIT_STORY_MENTION="4"
CREDIT_COMMENT="2"
CREDIT_MENTION="3"
CREDIT_INVITE="5"
CREDIT_AI_TEXT="1"
CREDIT_AI_MEDIA="2"
CREDIT_BRAIN_MIN="1"
CREDIT_WELCOME="5"
`,
)
console.log("Wrote .dev.vars for local chat at http://127.0.0.1:8787/dev")
