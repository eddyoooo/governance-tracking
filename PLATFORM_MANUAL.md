# Platform Manual

Terminal playbook for the current governance tracking MVP.

Base URL:

```bash
API=http://localhost:3000
```

## 1. Start The App

Development/demo mode:

```bash
npm install
npm run dev
```

Use these local `.env` values for a credential-free run:

```bash
NODE_ENV=development
PORT=3000
STORAGE_MODE=memory
DEMO_MODE=true
ENABLE_SCHEDULER=false
ENABLE_DEBUG_ENDPOINTS=true
API_AUTH_ENABLED=false
LIDO_ALLOWED_PUBLISHERS='["Allowed Publisher"]'
LIDO_FETCH_MAX_PAGES=5
AAVE_ALLOWED_PUBLISHERS='["AaveLabs","TokenLogic","LlamaRisk"]'
AAVE_FETCH_MAX_PAGES=10
AAVE_CATEGORY_FETCH_MAX_PAGES=2
```

Expected result: API starts on port `3000`, uses in-memory storage, uses fixture-backed Lido and Aave data, and does not require Firebase or Telegram.

## 2. Run The One-Shot Demo

```bash
npm run demo
```

Expected result: a terminal walkthrough using in-memory storage, scripted Lido
proposal fixtures, and Aave forum fixtures. It reveals three new allowlisted
Lido proposals one by one, runs the normal fetch/store/notify logic after each
reveal, then demonstrates Aave preview/fetch/store/dedupe using the global
latest plus public category/subcategory coverage path. It also exercises API
endpoints, checks duplicate/no-rewrite behavior, checks auth behavior, and resets
demo state. If Telegram is enabled in `.env`, the complete demo sends Telegram
notifications during the new proposal fetches.

The demo fixture set has four real Lido proposal records:

- Three allowlisted records from the configured Lido publishers. These should be stored and, when Telegram is enabled, notified once.
- One non-allowlisted record from `Vladimir` titled `CMv2 Prover Bot Funding`. This is the `skippedPublisherFixture` in the demo output.

`skippedPublisherFixture` exists to prove the allowlist is doing work. The platform fetches that item, counts it as skipped, does not store it as a proposal, and does not send a Telegram notification for it.

For a faster dry run:

```bash
DEMO_STEP_DELAY_MS=0 npm run demo
```

What the complete demo shows:

- It starts an in-memory API so the demo does not need Firestore.
- It prints available routes from `GET /`.
- It checks `GET /health` to prove the API is alive.
- It checks `GET /api/protocols` to prove Lido and Aave are registered.
- It checks `GET /api/debug/config-safe` to show non-secret runtime settings.
- It checks `GET /api/debug/demo-fixtures` to show the local fixture set.
- It runs three discovery fetches with `POST /api/admin/fetch/lido`; each one reveals one new allowlisted Lido proposal.
- It sends a Telegram notification during each discovery fetch when Telegram is enabled.
- It calls `GET /api/debug/lido/recent` and `GET /api/debug/aave/recent` to show what adapters currently see before storage.
- It calls `GET /api/proposals` to show what was actually persisted after filtering.
- It calls `POST /api/admin/fetch/aave` and `POST /api/debug/aave/fetch-once` to prove Aave fetch, storage, dedupe, and no-rewrite behavior.
- It calls both proposal detail endpoints to show internal-id lookup and source-id lookup.
- It filters proposals by publisher and notification status.
- It calls `GET /api/admin/fetch-runs` to show the audit trail of fetch attempts.
- It calls `POST /api/admin/notify-pending` to prove queued notification handling is wired.
- It calls `POST /api/debug/lido/fetch-once` after discovery to prove repeat fetches do not duplicate or rewrite unchanged proposals.
- It checks auth behavior by showing that protected endpoints reject requests without a token.
- It resets in-memory state so the demo can be repeated.

## 3. Check Service Health

```bash
curl -s "$API/health"
```

Expected result:

```json
{
  "ok": true,
  "storageMode": "memory",
  "schedulerEnabled": false
}
```

## 4. See Registered Protocols

```bash
curl -s "$API/api/protocols"
```

Expected result: registered protocols, currently Lido and Aave, including source metadata and allowlist counts.

## 5. Preview Protocol Items Before Storage

```bash
curl -s "$API/api/debug/lido/recent"
curl -s "$API/api/debug/aave/recent"
```

Expected result: recent adapter items with `sourceId`, `title`, `publisherName`, `sourceUrl`, and raw payload data.

Important: this does not store proposals. It is for inspecting what the adapter sees before allowlist filtering.

To inspect the fixture payload used in demo/memory mode:

```bash
curl -s "$API/api/debug/demo-fixtures"
```

Expected result: raw demo fixture JSON for the Lido and Aave recent-topics responses, Aave public category/subcategory metadata, and the real Lido proposal records used by the Telegram/demo notification flow.
The response also includes the non-allowlisted fixture used to prove skipped
publisher behavior.

## 6. Fetch, Filter, Store

```bash
curl -s -X POST "$API/api/admin/fetch/lido"
curl -s -X POST "$API/api/admin/fetch/aave"
```

Expected result:

```json
{
  "protocol": "lido",
  "fetchedCount": 2,
  "allowlistedCount": 1,
  "storedNewCount": 1,
  "updatedExistingCount": 0,
  "unchangedExistingCount": 0,
  "skippedCount": 1,
  "notificationSentCount": 0,
  "notificationFailedCount": 0,
  "errors": []
}
```

The Lido category endpoint returns 30 proposal topics per page. With `LIDO_FETCH_MAX_PAGES=5`, one Lido run can inspect up to 150 recent proposal-category topics before stopping.

Aave uses the verified Discourse forum at `https://governance.aave.com`. It does not have one clean proposal-only category equivalent to Lido, so the Aave adapter uses two coverage layers: `GET /latest.json?page=<page>` for global forum latest topics, then `GET /site.json` to discover public categories/subcategories and poll each `GET /c/<category-path>/<category-id>/l/latest.json?page=<page>` feed. This is intentionally more robust than Lido because Aave proposal-like posts can appear across Governance, Governance subcategories, Risk, Risk subcategories, Development, Finance, and other public categories.

With `AAVE_FETCH_MAX_PAGES=10`, one Aave run can inspect up to 300 global latest topics. With `AAVE_CATEGORY_FETCH_MAX_PAGES=2`, it can also inspect up to 60 topics per public category/subcategory before deduplicating by Discourse topic id.

Debug equivalent when `ENABLE_DEBUG_ENDPOINTS=true`:

```bash
curl -s -X POST "$API/api/debug/lido/fetch-once"
curl -s -X POST "$API/api/debug/aave/fetch-once"
```

Expected result: same fetch result shape as the admin fetch endpoint.

After the complete demo has already revealed and stored all three allowlisted
fixtures, this endpoint usually returns:

```json
{
  "fetchedCount": 4,
  "allowlistedCount": 3,
  "storedNewCount": 0,
  "updatedExistingCount": 0,
  "unchangedExistingCount": 3,
  "skippedCount": 1,
  "notificationSentCount": 0,
  "notificationFailedCount": 0,
  "errors": []
}
```

That means the adapter saw four items, three matched the publisher allowlist,
one was skipped, all three allowlisted proposals were already stored and
unchanged, and no duplicate Telegram notifications were sent.

Run a one-item fetch example again:

```bash
curl -s -X POST "$API/api/admin/fetch/lido"
```

Expected result: `storedNewCount` becomes `0`, `unchangedExistingCount` increases for already-known unchanged proposals, and no duplicate proposal is created. `updatedExistingCount` only increases if source content changed.

## 7. List Stored Proposals

```bash
curl -s "$API/api/proposals?protocol=lido&limit=5"
curl -s "$API/api/proposals?protocol=aave&limit=5"
```

Expected result: stored proposals after allowlist filtering. This endpoint reads memory or Firestore only; it does not call Lido.

Useful filters:

```bash
curl -s "$API/api/proposals?publisherName=Allowed%20Publisher"
curl -s "$API/api/proposals?notificationStatus=skipped"
curl -s "$API/api/proposals?sort=firstSeenAt_desc&limit=10&offset=0"
```

Expected result: filtered proposal lists.

## 8. Read One Proposal

By internal proposal id:

```bash
curl -s "$API/api/proposals/<internal-proposal-id>"
```

By source identity:

```bash
curl -s "$API/api/proposals/source/lido/forum/<lido-topic-id>"
curl -s "$API/api/proposals/source/aave/forum/<aave-topic-id>"
```

Expected result: one stored proposal, or:

```json
{
  "error": "Proposal not found."
}
```

Use source identity when you only know the Lido/Discourse topic id.

These two endpoints can return the same proposal through different keys. The
internal id is generated by the platform, for example
`lido_forum_11624_445bfbca21`. The source identity uses the original source
fields, for example protocol `lido`, source type `forum`, and Lido Discourse
topic id `11624`. Aave works the same way, except the protocol is `aave`.

## 9. List Fetch Runs

```bash
curl -s "$API/api/admin/fetch-runs"
```

Expected result: stored fetch-run records showing what each run fetched, stored, meaningfully updated, saw unchanged, skipped, and notified.

Useful options:

```bash
curl -s "$API/api/admin/fetch-runs?limit=5&offset=0&sort=startedAt_desc"
```

## 10. Notify Pending Proposals

```bash
curl -s -X POST "$API/api/admin/notify-pending"
```

Expected result:

```json
{
  "pendingCount": 0,
  "sentCount": 0,
  "failedCount": 0,
  "skippedCount": 0,
  "errors": []
}
```

If Telegram is disabled, pending proposals are marked `skipped`. If Telegram is enabled, pending proposals are sent and marked `sent` or `failed`.

## 11. Inspect Safe Config

```bash
curl -s "$API/api/debug/config-safe"
```

Expected result: non-secret runtime config. It shows booleans such as whether Firebase keys or API tokens are present, but never returns raw secrets.

## 12. Reset Demo State

```bash
curl -s -X POST "$API/api/debug/reset-demo-state"
```

Expected result:

```json
{
  "reset": true,
  "storageMode": "memory"
}
```

Only works when `ENABLE_DEBUG_ENDPOINTS=true` and storage is memory/demo.

## 13. Test Auth Protection

Set:

```bash
API_AUTH_ENABLED=true
API_AUTH_TOKEN=replace-with-long-random-secret
```

Without token:

```bash
curl -i "$API/health"
```

Expected result: `401`.

With token:

```bash
curl -s "$API/health" \
  -H "Authorization: Bearer $API_AUTH_TOKEN"
```

Expected result: normal health response.

Alternative header:

```bash
curl -s "$API/health" \
  -H "x-api-token: $API_AUTH_TOKEN"
```

## 14. Test Telegram Setup

Telegram notifications are direct user notifications, not group/channel posts.
Each recipient must open the bot and send `/start` once. The backend then sends
only to numeric user IDs listed in `TELEGRAM_ALLOWED_USER_IDS`.

Set:

```bash
ENABLE_TELEGRAM_NOTIFICATIONS=true
TELEGRAM_BOT_TOKEN=replace-with-token
TELEGRAM_ALLOWED_USER_IDS='[
  123456789,
  987654321
]'
TELEGRAM_E2E_ENABLED=true
TELEGRAM_TEST_SEND_DELAY_MS=3000
```

Then run:

```bash
curl -s -X POST "$API/api/admin/fetch/lido"
curl -s -X POST "$API/api/admin/fetch/aave"
```

Expected result: new allowlisted proposals are sent once to the configured
Telegram user IDs. Existing proposals are not notified again; unchanged repeat
sightings are counted without rewriting the proposal.

Send direct-message test alerts without fetching proposals:

```bash
npm run telegram:test-send
```

Expected result: each configured allowed user receives multiple real Lido and Aave
governance-style messages from different publishers, and the terminal prints how
many messages and users were targeted. The message content comes from
`src/demoFixtures/telegramNotification.fixture.ts`. Messages are spaced by
`TELEGRAM_TEST_SEND_DELAY_MS`, which defaults to `3000`. Each message starts
with a bold all-caps `NEW GOVERNANCE ITEM TRACKED` header.

For a fast dry run:

```bash
TELEGRAM_TEST_SEND_DELAY_MS=0 npm run telegram:test-send
```

Run the real Telegram E2E test:

```bash
npm run test:e2e:telegram
```

Expected result: the test seeds multiple pending proposals in memory from the
same real Lido/Aave fixture set, sends them through the real Telegram service to the
allowed users, and marks each one `sent`.

## 15. Run Tests

```bash
npm test
```

Expected result: all Jest/Supertest tests pass.

```bash
npm run check
```

Expected result: TypeScript build passes, then all tests pass.

```bash
npm run test:watch
```

Expected result: Jest watch mode starts for active development.

## 16. Run With Firestore

Set:

```bash
NODE_ENV=production
STORAGE_MODE=firestore
DEMO_MODE=false
ENABLE_SCHEDULER=true
FETCH_INTERVAL_CRON=*/15 * * * *
LIDO_FETCH_MAX_PAGES=5
AAVE_FETCH_MAX_PAGES=10
AAVE_CATEGORY_FETCH_MAX_PAGES=2
AAVE_ALLOWED_PUBLISHERS='[
  "AaveLabs",
  "TokenLogic",
  "LlamaRisk"
]'
ENABLE_DEBUG_ENDPOINTS=false
API_AUTH_ENABLED=true
FIREBASE_PROJECT_ID=replace-with-project-id
FIREBASE_CLIENT_EMAIL=replace-with-client-email
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nreplace\n-----END PRIVATE KEY-----\n"
```

Run:

```bash
npm run build
npm run start
```

Expected result: proposals and fetch runs are stored in Firestore.

## 17. Run With Docker

Development compose:

```bash
docker compose up --build
```

Credential-free API demo:

```bash
docker compose -f docker-compose.demo.yml up --build
```

Production image:

```bash
docker build -t governance-tracking-backend .
docker run --env-file .env -p 3000:3000 governance-tracking-backend
```

Expected result: backend listens on local port `3000`. Demo compose uses memory mode and does not require Firebase or Telegram.

## Endpoint Source Map

These do not call protocol forums:

```text
GET /health
GET /api/protocols
GET /api/proposals
GET /api/proposals/:id
GET /api/proposals/source/:protocol/:sourceType/:sourceId
GET /api/admin/fetch-runs
GET /api/debug/demo-fixtures
```

These fetch through protocol adapters:

```text
GET /api/debug/lido/recent
GET /api/debug/aave/recent
POST /api/debug/lido/fetch-once
POST /api/debug/aave/fetch-once
POST /api/admin/fetch/lido
POST /api/admin/fetch/aave
```

In demo/memory mode, adapters use fixtures. In normal Firestore mode, they call their live protocol forums.

## Common Results

`fetchedCount > 0` and `allowlistedCount = 0`: fetch worked, but allowlist matched nothing.

`storedNewCount = 1`: a new allowlisted proposal was discovered.

`updatedExistingCount = 1`: an already-known proposal appeared again and had meaningful source changes, so the stored record was updated.

`unchangedExistingCount = 1`: an already-known proposal appeared again with no meaningful source changes, so the stored record was not rewritten.

`skippedCount > 0`: fetched items were ignored because their publisher was not allowlisted.

`notificationFailedCount > 0`: proposal storage worked, but Telegram failed.
