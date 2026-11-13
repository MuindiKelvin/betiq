# BetIQ (React + Firebase + Bootstrap, all free tiers)

Analyze a football match before betting. Choose any of 80+ competitions worldwide, then browse its matches, table, teams, squads,
players and transfers, and get head-to-head, form, statistics (possession, shots, corners, cards, xG) and a probability-based prediction.

Data: **Bzzoiro Sports Data** (https://sports.bzzoiro.com, free tier: 7,500 calls per day). Replaces the earlier SportAPI7 / API-Football / CSV sources.

## How it fits together
```
BSD API  --scripts/sync.mjs-->  Firestore  <--read--  React app (browser)
 token stays here              budgeted, resumable        no API token in the browser
```
The token is only used by `scripts/` (your `.env`, or a GitHub secret). The app reads Firestore and queues requests in it.

## Run it
Needs Node 20.6+, a Google account, and a free BSD key (https://sports.bzzoiro.com/register/).
1. `npm install`
2. Copy `.env.example` to `.env` and fill in the `VITE_FB_*` values (Firebase console > Project settings > Your apps) and `BSD_API_KEY`.
3. Firebase console: enable Google sign-in (Authentication) and create Firestore. Put `serviceAccountKey.json` in this folder
   (Project settings > Service accounts). Never share or commit it.
4. `npx firebase-tools login`, then deploy the rules: `npx firebase-tools deploy --only firestore --project YOUR_PROJECT_ID`
5. **`npm run probe`**: ~20 calls; checks the token and prints the real response shapes. Send me any FAIL line.
6. `npm run sync:local`. The first full load takes a few runs (see below). Then `npm run dev` and open http://localhost:5173.

## What the sync does
Per competition: seasons, teams, current-season fixtures and results, standings, top scorers/assists/cards, transfers and club spending, and
`SEASONS_BACK` (5) past seasons for head-to-head and the model. Rolling jobs (a few hundred per run): team squads, profiles and form statistics
(possession, shots, corners, cards, xG per game), per-match statistics, head-to-head of the next fixtures, and top-scorer player profiles.
Users' requests (match details, all-competition head-to-head, full player profiles) are served first, then competitions by staleness.

Budget: `MAX_REQUESTS` per run (default 6000); it stops when the account has `QUOTA_RESERVE` (500) calls left, read from the API's `RateLimit` header.
Progress lives in the stored documents, so an interrupted or stopped run simply continues. Estimated first load for all 87 competitions: roughly
15,000 to 20,000 calls, i.e. about three days of free quota; afterwards about 1,500 to 2,500 calls a day.
Fewer competitions: `SYNC_LEAGUES=1,3,4,5,6` (ids from https://sports.bzzoiro.com/leagues/). `npm run sync:dry` writes to `./.sync-out` instead of Firestore.

## Daily refresh on GitHub (free)
Repo secrets: `BSD_API_KEY`, `FIREBASE_SERVICE_ACCOUNT` (whole JSON). The included workflow runs a full sync every 6 hours and a cheap
requests-only run every 30 minutes (0 API calls when nothing is queued), so a requested match detail or player profile appears within about 30 minutes.

## Layout
Competitions (browse) > a competition hub: Overview, Matches, Table, Teams, Players, Transfers. Teams have squads (by position, with injury status),
statistics, matches and transfers; players have profile, career, transfers and recent matches. Match Analysis predicts upcoming fixtures;
finished matches open view-only with events, lineups, **average positions** and a **shot map** (sized by xG). Global search finds teams and competitions.

## The model
Time-decayed home/away attack and defence strengths (shrunk for small samples) -> Poisson goals -> scoreline grid -> markets, plus two small
bounded nudges (recent form, head-to-head). Home/away scores are 90-minute scores. Cup and continental predictions are labelled rough.
The Model tab backtests it. `npm test` runs the model and data-parsing tests.

## Troubleshooting
- `HTTP 401` in sync/probe: key missing or wrong. `daily quota exhausted`: normal, resets 00:00 UTC; run again later.
- "Missing or insufficient permissions": rules not deployed (step 4). "No data yet": run step 6.
- A competition shows "Loading soon": it has not been reached yet; run the sync again. "Could not load, will retry" shows the error in the sync log.
- Old picks from earlier versions show "Legacy" and are not auto-settled (match ids changed with the data source).
- Old Firestore collections from earlier versions are ignored; delete them in the console to tidy up.

## Notes
Data is shown inside this app only (see https://sports.bzzoiro.com/docs/api-license/): do not republish the raw dataset. Predictions are estimates,
not advice. 18+, bet responsibly.

---
© BetIQ. All rights reserved. Developed by: [muindikelvin.github.io](https://muindikelvin.github.io)
