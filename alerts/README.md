# Marine Alerts — crypto tips with TTS for streamers

A separate service from the terminal: its own Worker, D1 database and deploy. It's served under `/alerts` on the site's domains.

| Page | Who | What |
|---|---|---|
| `/alerts/` | streamers | landing page, sign in (Solana wallet or Google) |
| `/alerts/dashboard` | streamers | page name, payout wallet, alert look, sound and voice, moderation, tip history, annual plan, overlay link |
| `/alerts/@name` | viewers | tip page: pay with a browser wallet or a phone wallet (Solana Pay QR) |
| `/alerts/overlay/<key>` | OBS | the browser source (1920×1080, transparent) |

**Money flow (non-custodial):** the server builds the transaction and the viewer signs it. The streamer's share and the
fee (`FEE_BPS`, none on the annual plan) each go straight to their own wallet in that one transaction. Each order has a
Solana Pay reference key, which is how a payment is found and checked on chain (balance changes per receiver). No private
keys are stored anywhere.

## Code
- `src/index.js` — routes, API, orders, payment checks, cron (every minute: payments made in a phone wallet after its page closed)
- `src/solana.js` — base58, token accounts, building and checking transactions (no library; tested against web3.js)
- `src/auth.js` — Sign-In With Solana, Google ID tokens, signed session cookie
- `src/settings.js` — streamer settings (clamped) and the hold filter
- `src/tts.js` — Google Cloud TTS voices (audio made on the server so it plays in OBS)
- `src/room.js` — Durable Object per streamer: live connection to their overlays
- `public/alerts/` — the pages; `migrations/` — D1 schema

## Deploy (once)
Easiest: Cloudflare dashboard → Workers & Pages → Create → Import a repository → `linkmarines`, with
project name `marine-alerts`, root directory `alerts`, no build command, and deploy command
`npx wrangler deploy && npx wrangler d1 migrations apply marine-alerts --remote`. The first deploy creates the database.
Then, in that Worker's Settings → Variables and Secrets, add `SESSION_SECRET` (any long random string), plus
`HELIUS_KEY` (recommended: the public RPC rate-limits payment checks) and `GOOGLE_TTS_KEY` (optional). After that it
redeploys by itself on every merge to main.

From a terminal instead: `npm install`, `npx wrangler secret put SESSION_SECRET`, then the same deploy command.

Then in `../wrangler.jsonc`, uncomment the `ALERTS` service binding and deploy the site. `/alerts` then works on
themarines.link and terminal7.xyz. Until then it works on `marine-alerts.<account>.workers.dev/alerts/`.

**Google sign-in (optional):** Google Cloud console → APIs & Services → Credentials → OAuth client ID (Web). Add the
domains as authorized JavaScript origins, then put the client id in `GOOGLE_CLIENT_ID` in `wrangler.jsonc`.
**Google TTS:** enable the Cloud Text-to-Speech API and make an API key restricted to it.

Settings in `wrangler.jsonc` vars: `TREASURY` (fee and plan wallet; it's the terminal's treasury for now), `FEE_BPS`,
`PLAN_USD`, `REQUIRE_PLAN` (`"1"` means no free plan), `BRAND`.

## Local
```sh
printf 'SESSION_SECRET=dev\n' > .dev.vars
npx wrangler d1 migrations apply marine-alerts --local
npx wrangler dev            # http://localhost:8787/alerts/
npm test                    # unit tests
node test/e2e.mjs           # end-to-end against wrangler dev
```
