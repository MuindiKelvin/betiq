# Phase 1 changes (audit, security, tests)

New
- scripts/check-secrets.mjs ........... secret scan (file + rule names only). `npm run check:secrets`
- scripts/lib/requests.mjs ............ fair scheduling and daily limits for queued user requests
- scripts/dev/test-secrets.mjs, test-requests.mjs, test-rules-contract.mjs ... unit/contract tests (in `npm test`)
- scripts/dev/test-requests-run.mjs ... end-to-end run of sync.mjs against the mock API (in `npm run test:e2e`)
- .github/workflows/ci.yml ............ secret scan, tests, e2e, build on every push / PR

Changed
- scripts/sync.mjs .................... fulfillRequests uses the planner; usage kept in system/requestUsage
- firestore.rules ..................... requests bound to the caller's uid; picks validated on create, never updated; system/* admin-only
- firestore.indexes.json .............. 18 single-field exemptions for large arrays/maps
- src/lib/people.js, src/pages/Player.jsx, Analyze.jsx, MatchView.jsx ... requests now send uid
- scripts/dev/test-live-run.mjs ....... fixtures relative to now (the old fixed dates made the test expire)
- package.json ........................ new scripts: check:secrets, test:e2e, test:requests-run, verify; `npm test` extended
- .gitignore, .env.example, README.md . credentials patterns, new env vars, security/limits section
- .github/workflows/sync.yml, live.yml  npm ci; least-privilege permissions on sync

Not changed on purpose: dependency versions (see README "Known dependency advisories"), existing pick/value/stake features (decision pending).
