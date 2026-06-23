# Fresh Methogle v3 setup

This is designed as a complete restart. Use a new GitHub repository called `methogle-v3` and a new Render Web Service. Do not mix these files with the old project.

## 1. Supabase

1. Open your Methogle Supabase project.
2. Open SQL Editor -> New query.
3. Paste all of `supabase-schema.sql` and press Run.
4. Go to Authentication -> URL Configuration.
5. Set Site URL to your final Render URL after deployment.
6. Add redirect URLs:
   - `https://YOUR-RENDER-URL.onrender.com/**`
   - `http://localhost:3000/**`
7. During beta testing you may disable email confirmation under Authentication -> Providers -> Email. Re-enable it before a serious public launch.

## 2. New GitHub repository

1. Create a new private repository named `methogle-v3`.
2. Upload every file and folder from this project.
3. The final structure must be:

```text
public/
  app.js
  favicon.svg
  index.html
  manifest.webmanifest
  styles.css
  sw.js
data/
  .gitkeep
.env.example
.gitignore
package.json
question-engine.js
render.yaml
server.js
supabase-schema.sql
README.md
SETUP.md
```

Never upload a real `.env` file or any secret key.

## 3. New Render service

1. Render -> New -> Web Service.
2. Connect the new `methogle-v3` repository.
3. Use:
   - Region: Singapore
   - Runtime: Node
   - Build command: `npm install --omit=dev --no-audit --no-fund`
   - Start command: `npm start`
   - Health check: `/health`
   - Instance: Free for beta testing
4. Add environment variables:
   - `NODE_VERSION` = `24.14.1`
   - `NODE_ENV` = `production`
   - `SUPABASE_URL` = your project URL
   - `SUPABASE_PUBLISHABLE_KEY` = the key beginning `sb_publishable_`
   - `SUPABASE_SECRET_KEY` = the key beginning `sb_secret_`
5. Deploy.

## 4. Verify

Open:

```text
https://YOUR-RENDER-URL.onrender.com/health
```

You should see:

```json
{
  "ok": true,
  "app": "Methogle",
  "version": "3.0.0",
  "accountsConfigured": true
}
```

Then open the main URL, create two accounts and test a private room on two devices.

## 5. Payments

The Pro plan is visual only. No payment is taken. Before enabling payments you will need:

- A parent/guardian involved if the business owner is under 18
- Stripe or another payment provider
- Terms of use, privacy policy and refund policy
- Production hosting and monitoring
- A secure Stripe webhook endpoint

Do not collect payments until those items are ready.
