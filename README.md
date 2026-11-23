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

## Live scores and kick-off detection

The **Live** tab and the badges on match rows (red minute and score, amber *Kick-off passed*, *Rescheduled*, *Postponed*) come from a small runner that writes one Firestore document, `live/main`, which every browser listens to. The BSD token stays in the runner and never reaches the browser.

```bash
npm run probe:live     # prints the REAL shape of /events/live/ and /fixtures/changes/ (2-4 calls). Run it while a match is in play.
npm run live:local     # runs until stopped (PC or small server)
npm run test:live-run  # end-to-end test of the runner against a mock server
```

Then deploy the rules once (they now allow reading `live`): `npx firebase-tools deploy --only firestore`.

- **What it spends:** `/coverage/` needs no token, so nothing is spent while nothing is live or due. While matches are live: one `/events/live/` call per tick (default 30 s, `LIVE_POLL_SECONDS`), one `/fixtures/changes/` call every 5 minutes, and one `/events/{id}/` call for each match that leaves the live feed. It stops when `LIVE_RESERVE` (1000) calls remain today so the data sync keeps working.
- **No guessing:** a match is *Live* only if the live feed lists it. Matches that disappear are looked up (`/events/{id}/`) and their status is stored as the API reports it. Minutes are shown as reported, not counted locally. If the feed is delayed, stopped or out of quota, the app says so. Extra time and penalties are shown separately from the 90-minute score, as the API reports them.
- **Time zones:** the started/not-started decision compares absolute instants; your time zone only changes how times are displayed.
- **GitHub Actions:** `.github/workflows/live.yml` has a 15-minute safety-net cron that restarts the runner chain if it is ever broken (free on public repositories; on private ones prefer `npm run live:local` on an always-on machine). The WebSocket (individual actions, ball position) is a paid BSD add-on and is not used.

## Live page, FT labels and instant pick results (v0.5)

- **Live page = FotMob style.** Pick a day (strip, arrows or calendar); matches are grouped by competition (the most used competitions first, then international, then by country A-Z) and sorted by kick-off. Chips: All, Live, FT, Upcoming. While matches are in play the page opens on **Live** (every match in play now, whatever its date); otherwise on today. Days come from `schedule/<UTC day>` documents (built from the data sync, 0 API calls), overlaid with the live feed, so a day costs at most 3 Firestore reads.
- **FT** is shown for every finished match (lists, Live page, match page, My Picks). Scores are 90-minute scores; extra time and penalties are listed under them.
- **My Picks settle as soon as the API reports the match finished.** The runner looks up every match that leaves the live feed and keeps the confirmed result for 4 days in `live/finals`. My Picks listens to the live feed, so a pick turns Won/Lost on screen without a reload, and shows the minute and score while the match is in play. A result from the data sync, once present, always wins. A "sweep" (every ~2 min, max `SWEEP_MAX_PER_DAY`=400 lookups/day) also looks up matches in the stored schedule that kicked off 110 min to 12 h ago and were never reported finished (feed gap, runner restarted).
- Honest limits: the app can only be as fast as the API's own feed. A result is shown after the API marks the match finished (typically within a minute of the runner seeing it leave the feed). If the API gives no score, nothing is guessed: the pick stays "Awaiting result".

## Daily Picks, more value-finder markets, verified badge

- **Daily Picks tab.** `scripts/picks.mjs` (after every sync, in the daemon and in `sync.yml`; 0 API calls) runs the app's own model (`src/lib/analysis.js`) on the upcoming fixtures of every synced league and writes `daily/<UTC day>` for today and the next 3 days. Per match it takes the most probable selection of three headline markets (result >= 50%, over/under 2.5 >= 60%, both teams score >= 60%), skips pairs with little data and cups / continental competitions (too rough), and keeps the best 5 per competition and day (`DAILY_PER_COMP`, `DAILY_AHEAD_DAYS`). Thresholds: `DAILY` in `src/lib/daily.js`.
- **Stable through the day.** A pick whose match has started is frozen (never recomputed); only later matches are refreshed on each run.
- **Confirm and download.** *Confirm* saves the pick to My Picks (`users/<uid>/picks/a_<match>_<market>`, same document shape as a normal pick, no odds, shown with a *Daily pick* tag); the fixed id makes a double confirm impossible (rules deny updates). Confirming closes at kick-off. *Download* gives a PDF per competition or for the whole day.
- **Value finder markets:** match result, double chance, total goals 1.5 / 2.5 / 3.5, both teams score, home and away clean sheet. Double chance removes the margin against a total of 2 (each selection covers two results). All are settled from the 90-minute score. Corners and cards are not modelled, so they are not offered.
- **Verified badge:** a gold tick (sidebar and Profile) when `emailVerified` is true and the address is well formed (`src/lib/verified.js`). Google sign-in accounts always are.
- **Deploy:** `npx firebase-tools deploy --only firestore,hosting` (the rules now allow reading `daily`, the indexes exempt `daily.list`), then `npm run picks:local` once so the first day exists. `npm test` covers all of it, including a run of `picks.mjs` on stored data.

## Deploy and run on its own

One-time, on your computer (replace `YOUR_PROJECT_ID`):
```bash
npm install
npx firebase-tools login
npm run build
npx firebase-tools deploy --only firestore,hosting --project YOUR_PROJECT_ID   # rules (now incl. schedule) + the website
npm run sync:local          # first data load (repeat on later days until all competitions are loaded; see "What the sync does")
npm run schedule:local      # builds the day-by-day schedule for the Live page (0 API calls)
npm run picks:local         # builds the Daily Picks (0 API calls; needs a finished data sync)
```
The website is static (Firebase Hosting) and is always up. The three jobs that keep the data fresh run inside **one process**, `npm start` (`scripts/daemon.mjs`): the live runner (always on, restarted if it crashes, sleeps until 00:00 UTC when the daily quota is used up), queued requests every 2 min (0 API calls when idle) and a full sync + schedule rebuild every 6 h. Run it on any always-on machine (a VPS, a Raspberry Pi, a PC that stays on). It needs `.env` and `serviceAccountKey.json` in the project folder (never commit them).
```bash
sudo npm install -g pm2
cd /path/to/betiq                      # must be run from the project folder
pm2 start npm --name betiq -- start    # start it
pm2 save                               # remember it
pm2 startup                            # prints one command: run exactly that (sudo) so it also starts after a reboot
```
Day to day: `pm2 status` · `pm2 logs betiq` · `pm2 restart betiq` · `pm2 stop betiq`.
After you change the code: `git pull && npm install && npm run build && npx firebase-tools deploy --only firestore,hosting --project YOUR_PROJECT_ID && pm2 restart betiq`.
Options (put in `.env`): `SYNC_EVERY_HOURS` (6), `REQUESTS_EVERY_SECONDS` (120), `LIVE_POLL_SECONDS` (30), `SWEEP_MAX_PER_DAY` (400), `LIVE_SWEEP=0` (no sweep), `SCHEDULE_BACK_DAYS` (7), `SCHEDULE_AHEAD_DAYS` (14).

**Use only one runner.** If the daemon runs, disable the GitHub workflows so two runners do not write the same documents: `gh workflow disable live-runner && gh workflow disable sync-data` (or Actions tab > each workflow > Disable). Without a server you can use the workflows instead (the sync one now also rebuilds the schedule), but GitHub's cron is not exact (runs can start late) and live updates then arrive in 20-minute chunks.

## Scorers, assists, managers, referees and venues (v0.6)

- **Scorers and assists, by name, for every finished match.** Source: `/events/{id}/commentary/` (scorer = `player`, assist = `related_player`). Stored per competition in `goals/<code>` and shown on the match page under *Scorers and assists*, with no button to press. Three feeds fill it: (1) matches the live runner saw finish (`live/finals`), within one runner/sync cycle of full time; (2) a per-competition backfill, newest first (`GOALS_PER_COMP`, `GOALS_PER_RUN`); (3) every "match details" request. 0-0 matches cost no call. The goals found are compared with the 90-minute score: a match whose list is short is marked **incomplete** (never shown as "No goals"), retried every 6 h for 3 days, then left as is. Extra-time goals are kept and labelled. **Cost: one call per match that had a goal**; no bulk endpoint is documented. Goal calls pause when fewer than `GOALS_RESERVE` (1000) calls remain today.
- **Match info** (venue, referee, both managers, attendance): the `/events/` list rows already carry `venue_id`, `referee_id`, `home_coach_id`, `away_coach_id` and `attendance` (confirmed with `npm run probe`), so this costs **no extra calls**. Ids are turned into names from the synced managers and referees lists and from venue documents (`/venues/{id}/`, 1 call per venue, refreshed every 30 days, `VENUES_PER_RUN`=100 per run). Shown under the score on the match page; each item opens its page. `INFO_DETAIL_CALLS=1` additionally reads `/events/{id}/` for the next fixtures (off by default: it adds nothing the list does not already give).
- **Managers and referees** per competition (`/managers/?league_id=`, `/referees/?league_id=`, about 2 calls per competition per day) in the *Managers* and *Referees* tabs. These list rows already hold the full profile and averages (record, win %, goals, cards and fouls per match), so those pages open instantly with no request. Only a manager's career (record per spell, home/away, **appointment effect**) and a venue's competitions are fetched on first open (queued like player profiles: 2 calls each). `REFEREES_PER_RUN` (default 0) can preload referee profiles, which the list rows make redundant.
- **Honest limits.** The manager *matches* log and *social* endpoints are not used. In-play scorer names are not fetched: they appear after full time. The `/events/{id}/incidents/` shape is not used.
- Deploy the new rules (`npx firebase-tools deploy --only firestore`), then `npm run sync:local` as usual.


## Security, request limits and checks (v0.7)

**Credentials.** `.env` and `serviceAccountKey.json` are git-ignored and must never be committed or shared (zip archives included). If either has been shared, rotate it: create a new service-account key in the Firebase console and regenerate the BSD key. The Firebase *web* config in the built app is public by design; restrict that API key to your domain in the Google Cloud console. `npm run check:secrets` fails if a credential is tracked by git or sits in a file git would add; it prints file and rule names only, never values. CI runs it on every push.

**Queued-request limits.** Signed-in users can queue match details, head-to-head and profile requests, and each costs API calls from the shared daily quota. `scripts/lib/requests.mjs` serves them fairly (one per user per round, oldest first) and enforces daily limits (UTC day). Over a user's limit: dropped. Over the global limit: kept for the next day. Older than 48 h: dropped. Usage is kept in `system/requestUsage` (admin-only). Settings: `REQUESTS_PER_RUN` (60), `REQUESTS_PER_USER_DAY` (100), `REQUESTS_TOTAL_DAY` (1000).

**Firestore rules and indexes.** Requests must carry the caller's own `uid`; picks are validated on create (fixed keys and types) and cannot be updated; `system/*` is admin-only. `firestore.indexes.json` now disables indexing of the large array and map fields the app never queries (avoids the per-document index-entry limit and makes live writes cheaper). **Deploy the rules and the hosting build together**: an old cached app does not send `uid` and its requests would be refused. Then run `firebase deploy --only firestore:rules,firestore:indexes,hosting`.

**Checks.** `npm run verify` runs the secret scan, all unit tests, the end-to-end runs against the mock API (`test:e2e`) and the build. The rules contract test checks that every client write in `src/` matches `firestore.rules`; it is not a rules-emulator test, so after changing rules also try them in the Firebase emulator or the Rules Playground.

**Known dependency advisories.** `npm audit` reports advisories in Node-only packages (`undici`, `@grpc/grpc-js`, inside `firebase-admin` and the Node entry of `firebase`) and in the Vite dev server. None is in the shipped browser bundle. `npm audit fix --force` proposes a Firebase downgrade; do not apply it. Plan a deliberate major upgrade (`firebase`, `firebase-admin`, `vite`) and smoke-test it against your project.
