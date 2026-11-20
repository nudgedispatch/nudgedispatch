# Nudge GA4 — PUBLISHED Nov 20, 2026 ~5:46 AM ET (Jesse voice OK)
GA4 property 565311365 "Nudge Dispatch" (account 32055911 JAB SKills), web stream 16380768831, measurement ID G-KDG43ZJHVK.
nudge-sandbox base 514b4832 -> new version 13c9a9c2-b9e6-46cb-9673-96811290d58a, deployment 5ab00445-ae74-44b8-82c7-b60abc61e114.
gtag.js async + external /ga-init.js (CSP has no 'unsafe-inline', so no inline script) on all 7 pages, right after the meta CSP.
CSP (Worker header + per-page meta): script-src += googletagmanager; connect-src += google-analytics, *.google-analytics, *.analytics.google, googletagmanager; img-src += google-analytics, googletagmanager.
Rollback: sh rollback-to-514b4832.sh
