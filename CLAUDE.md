# haydens-trainer

**Legacy.** The original single-user training-week app. Its features were merged into `~/Projects/cycling` (Trainer tab); do new work there unless told otherwise. Kept because its GitHub Pages site and Cloudflare Worker may still be live.

- Stack: Vite + React static site on GitHub Pages; Cloudflare Worker proxy in `worker/` (`haydens-trainer-proxy`) holds Strava + Anthropic secrets.
- Commands: `npm run dev` · `npm test` · `npm run build`. Worker: `cd worker && npx wrangler deploy`.
- Deploy: push to `main` → `.github/workflows/deploy.yml` tests, builds, publishes to Pages. Build vars are GitHub repo *Variables* (public by design).
- Multi-user successor: `~/Projects/trainer`.
