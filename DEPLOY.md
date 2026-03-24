# Deploying Wayfarer to Vercel

## 1. Push to GitHub

```bash
git add .
git commit -m "ready for deploy"
git push origin main
```

## 2. Connect to Vercel

1. Go to [vercel.com/new](https://vercel.com/new)
2. Import your GitHub repo
3. **Do not change the Root Directory** — leave it as `/` (the `vercel.json` handles everything)
4. Framework will auto-detect as Next.js

## 3. Add Environment Variables

In the Vercel dashboard → Settings → Environment Variables, add all of these:

| Variable | Where to get it |
|----------|----------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase dashboard → Settings → API |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` | Supabase dashboard → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase dashboard → Settings → API (secret) |
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | account.mapbox.com → Tokens |
| `GOOGLE_PLACES_API_KEY` | Google Cloud Console → Credentials |
| `GOOGLE_CSE_API_KEY` | Google Cloud Console → Credentials |
| `GOOGLE_CSE_ID` | cse.google.com → your search engine |
| `REDDIT_CLIENT_ID` | reddit.com/prefs/apps |
| `REDDIT_CLIENT_SECRET` | reddit.com/prefs/apps |

> `MAPBOX_TOKEN` (server-only) is optional — only `NEXT_PUBLIC_MAPBOX_TOKEN` is used by MapView.

## 4. Deploy

Click **Deploy**. First build takes ~2 minutes.

## 5. Test Production

```bash
node scripts/test-e2e.mjs https://your-app.vercel.app
```

## 6. Supabase — allow production URL

In Supabase dashboard → Authentication → URL Configuration:
- Add your Vercel URL to **Allowed Origins** (for future auth)

---

## Re-deploying

Vercel auto-deploys on every push to `main`.

To redeploy manually: Vercel dashboard → Deployments → Redeploy.
