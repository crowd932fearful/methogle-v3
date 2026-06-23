# Methogle v3

Methogle is a professional real-time Mathematics Methods battle platform.

## Included

- Ranked 1v1 matchmaking with ELO
- Casual 1v1 battles
- Topic-specific matchmaking
- Private friend rooms with six-character codes
- Practice mode against Methobot
- Daily challenge
- One-life survival mode
- Speed blitz
- 500+ generated question variations across seven Methods topics
- Worked explanations after every question
- Supabase email/password accounts
- Persistent ratings, wins, XP, levels and match history
- Global leaderboard
- Original Web Audio background music and sound effects
- Responsive desktop/mobile design
- Methogle Pro pricing placeholder with payments disabled
- PWA manifest and service worker
- Server-authoritative scoring and answer checking
- Safe preset reactions instead of unrestricted chat

## Run locally

1. Install Node.js 24 LTS.
2. Copy `.env.example` to `.env` and add your Supabase values.
3. Run:

```bash
npm install
npm start
```

4. Open `http://localhost:3000`.

Guest modes work even if Supabase is not configured. Accounts and persistent rankings require Supabase.

## Deployment

Read `SETUP.md`. For a clean restart, create a new GitHub repository and a new Render Web Service rather than reusing the old broken deployment.
