# nudgedispatch.com marketing site (live snapshot, 20 Nov 2026)

This is the code that was actually live on `nudgedispatch.com` (Cloudflare Worker `nudge-sandbox`) when this branch was saved. It is a save-to-repo snapshot only. **Do not deploy or merge without Jesse's OK.**

## What is live

- Worker version `13c9a9c2-b9e6-46cb-9673-96811290d58a` at 100% (deployment `5ab00445-ae74-44b8-82c7-b60abc61e114`), created 20 Nov 2026, 5:46 AM America/New_York.
- That build is the all-pages redesign plus the Nov 20 SEO fix (version `514b4832`, 5:39 AM ET: canonical 301s and small-fleet title/H1/description/sitemap lastmod) and the Nov 20 GA4 add (measurement ID `G-KDG43ZJHVK`, external `/ga-init.js`, CSP hosts for Google tags).

## Layout

- `src/` — files extracted from the live Worker asset map (HTML, CSS, JS, images, sitemap, onboarding PDF).
- `published/worker.js` — the exact Worker script downloaded from Cloudflare for the live version. sha256 `e300d209da3d213180252e8e908625e32f361ae4fb2009c130a906327ec702af`. Byte-identical to `/workspace/nudge/seo_fix_nov19/publish_ga4/worker.js`.
- `tools/` — the small build snippets used to apply the SEO 301s and GA4 tags on top of the previous live Worker. The original publish shell scripts are not included here so this PR cannot be used to redeploy by accident.
- `unpublished-drafts/` — the previous contents of this folder (a homepage CTA snippet that was never published).
- `wrangler.toml` — documents the Worker name and compatibility date only. No secrets.

## How this was confirmed to match live

1. Cloudflare Workers API `GET .../scripts/nudge-sandbox/deployments` showed version `13c9a9c2` at 100%, message "Nudge GA4 G-KDG43ZJHVK (Jesse voice OK Nov 20). Rollback 514b4832".
2. `GET .../scripts/nudge-sandbox` returned a `worker.js` part whose sha256 matched `published/worker.js`.
3. Public curls on 20 Nov 2026, 8:24 AM America/New_York:
   - `/`, `/ga-init.js`, `/sitemap.xml`, and `/small-fleet-dispatch-software.html` were byte-identical to the extracted `src/` files.
   - `/trial`, `/index`, and `/index.html` returned 301s to `/trial.html` and `/` respectively (the SEO routing).
   - `/ga-init.js` configures `G-KDG43ZJHVK`.

Rollback for the live Worker (not part of this PR): Cloudflare rollback from `13c9a9c2` to `514b4832` (SEO-only) or `0935b165` (pre-SEO all-pages redesign).
