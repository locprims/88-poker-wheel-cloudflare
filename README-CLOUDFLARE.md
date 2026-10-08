# 88 Poker Wheel — Cloudflare Workers version

This version replaces the Flask/Render backend with Cloudflare Workers + D1.

## Required Cloudflare bindings/secrets

After the first deployment, configure:

- D1 binding name: `DB`
  - bind it to the SAME D1 database used by 88 Poker Manager
- Secret: `TELEGRAM_BOT_TOKEN`
  - use the Telegram bot token for the Wheel Mini App

The D1 database must already contain:
- `wheel_players`
- `wheel_spins`

## Routes

- `/` — Telegram Mini App
- `/api/me`
- `/api/spin`

The administration remains in the separate 88 Poker Manager Worker:
Agents | Promoteurs | 🎡 Lucky Wheel

## Git deployment

Cloudflare build/deploy command:
`npx wrangler deploy`

No Render `PORT`, `DB_PATH`, `DATABASE_URL`, `DEV_MODE` or `ADMIN_KEY`
is required by this Wheel Worker.


hey
