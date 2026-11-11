# Governance Tracking

Node.js + TypeScript governance monitor. The service periodically checks tracked protocol forums, stores eligible proposals, tracks raw forum-source freshness, follows Uniswap and Aave governance on Ethereum mainnet, deduplicates repeat observations, records operational audit data, and optionally sends direct Telegram notifications.

Forum tracking covers Lido, Aave, Uniswap, and CoW DAO. On-chain tracking covers Uniswap Governor Bravo and Aave Governance V3. Both use finalized Ethereum data, silent historical seeding, deduplicated lifecycle records, Telegram delivery recovery, and operator health reports. Aave's Ethereum execution event means forwarding to payload controllers, not verified execution on destination chains. There is intentionally no dashboard or public proposal browser. Structured state lives in Firestore in production mode, or in memory during demos and tests.

For operator commands and expected results, use [PLATFORM_MANUAL.md](./PLATFORM_MANUAL.md).

## Requirements

- Node.js 22 or newer for local development. The production image uses Node.js 24 LTS.
- npm.
- Docker for production image builds.
- Firebase credentials only for Firestore mode.
- Telegram credentials only when proposal notifications, admin reports, or live Telegram tests are enabled.

## Quick Start

Run the monitor locally without Firebase or Telegram:

```bash
npm install
NODE_ENV=development \
STORAGE_MODE=memory \
DEMO_MODE=true \
ENABLE_SCHEDULER=false \
ENABLE_TELEGRAM_NOTIFICATIONS=false \
ENABLE_ADMIN_STATUS_REPORTS=false \
UNISWAP_ONCHAIN_ENABLED=false \
UNISWAP_ONCHAIN_NOTIFICATIONS_ENABLED=false \
AAVE_ONCHAIN_ENABLED=false \
AAVE_ONCHAIN_NOTIFICATIONS_ENABLED=false \
API_AUTH_ENABLED=false \
npm run dev
```

In another terminal:

```bash
API=http://localhost:3000
curl -s "$API/health"
curl -s -X POST "$API/api/admin/fetch/lido"
curl -s -X POST "$API/api/admin/fetch/aave"
curl -s -X POST "$API/api/admin/fetch/uniswap"
curl -s -X POST "$API/api/admin/fetch/cow"
curl -s "$API/api/admin/fetch-runs"
curl -s "$API/api/admin/source-activity"
```

These API fetches use the publisher policies configured for each adapter. Aave, Uniswap, and CoW require a publisher-name allowlist match. Lido accepts either a configured publisher-name match or an original author whose Discourse trust level is Leader (`trust_level=4`). All four forums are enabled by default and can be paused with their `*_ENABLED=false` flag. The self-contained demo supplies representative allowlists. On-chain monitoring requires an Ethereum RPC and the protocol's separate `UNISWAP_ONCHAIN_ENABLED` or `AAVE_ONCHAIN_ENABLED` flag. Admin reports require `ENABLE_ADMIN_STATUS_REPORTS=true` and Telegram credentials; see the platform manual for operator commands.

Run the end-to-end terminal walkthrough:

```bash
DEMO_STEP_DELAY_MS=750 npm run demo
```

Run the walkthrough and send the final operator status report to the configured Telegram admin:

```bash
DEMO_STEP_DELAY_MS=750 npm run demo:admin
```

Run the full local safety check:

```bash
npm run check
```

## Production Preflight

Before pointing the monitor at production Firestore/Telegram, run:

```bash
npm run check
npm run audit:prod
ENABLE_TELEGRAM_NOTIFICATIONS=false \
UNISWAP_ONCHAIN_NOTIFICATIONS_ENABLED=false \
AAVE_ONCHAIN_NOTIFICATIONS_ENABLED=false \
DEMO_STEP_DELAY_MS=0 npm run demo
docker build --load -t governance-tracker-bot .
```

After deployment, use the authenticated health and audit checks in [PLATFORM_MANUAL.md](./PLATFORM_MANUAL.md). A manual fetch changes Firestore state, and sending a status report dispatches a Telegram message. On an empty database, forum and on-chain history are seeded silently; later discoveries can alert subscribers. Each on-chain source validates Ethereum mainnet, its governance proxy, and implementation; Uniswap additionally verifies the configured Timelock and UNI token.

Run one active monitor process per database and Telegram bot. Firestore transactions protect proposal inserts, but fetch/recovery locks are process-local: multiple workers can race on Telegram delivery. A process crash after Telegram accepts a message but before delivery state is saved can also cause a retry to repeat that message; delivery is not an exactly-once guarantee.

## Current Scope

- Fetch recent proposal/forum activity for Lido, Aave, Uniswap, and CoW DAO.
- Validate Discourse JSON responses with Zod.
- Bound external forum and Telegram requests with timeouts so a stuck network call does not hang the monitor indefinitely.
- Filter fetched items by protocol-specific publisher policies: name allowlists for every forum plus a Lido-only Leader original-author exemption.
- Treat only the Discourse original poster as the publisher; a last commenter is never used as an author fallback.
- Normalize allowlisted items into a common stored proposal shape.
- Deduplicate by `protocol + sourceType + sourceId`.
- Store proposals and fetch runs in Firestore or memory mode.
- Track raw source activity so silent forum migrations or abandoned feeds surface.
- Avoid rewriting unchanged proposals on every poll.
- Send direct Telegram notifications for newly discovered allowlisted proposals.
- Store routine LlamaRisk `Risk Stewards` cap-only and cap-plus-IRM updates without sending Telegram alerts.
- Avoid duplicate notifications for already-known proposals.
- Track delivery separately for every configured Telegram recipient.
- Retry unresolved recipient deliveries automatically with bounded backoff.
- Silently seed the first protocol baseline when Firestore is empty.
- Send a daily Telegram status report to the configured admin when enabled.
- Allow manually sending the same admin status report after deploys or restarts.
- Run scheduled polling once daily by default.
- Poll finalized Uniswap Governor Bravo and Aave Governance V3 activity on Ethereum mainnet every six hours when enabled.
- Persist proposal metadata, actions, vote totals, vote/execution outcome, canonical lifecycle transactions, source cursor state, and scan runs.
- Emit one deterministic lifecycle alert for creation, success/defeat, cancellation, queue, expiry, and execution; the intermediate `active` state is stored but not alerted.
- Refresh every on-chain proposal that can still transition, including defeated or expired proposals that may later be canceled, so state changes are detected even when a provider omits a lifecycle log.
- Seed existing on-chain history silently, in resumable 10,000-block ranges, before enabling new-event notifications.
- Validate complete proposal-id and canonical lifecycle-reference coverage, reject proposal-counter regression, and fail closed on RPC omissions, cursor hash changes, address mismatches, or an unreviewed configured-Governor implementation upgrade.
- Provide a small operational API for health, manual fetches, admin status, source activity, and fetch-run audit.
- Run deterministic unit/integration tests without live forum calls.
- Enforce coverage thresholds during every normal `npm test` run.
- Run optional real Telegram E2E tests only when explicitly enabled.

## Out Of Scope

- No Angular dashboard.
- No public proposal listing/detail API.
- No CORS/browser-facing API support.
- No debug endpoints.
- No AI agent, AI summary, classification, category tagging, urgency score, recommendation, or portfolio-impact logic.
- No Snapshot ingestion.
- No on-chain governance ingestion for Lido or CoW yet.
- No per-wallet `VoteCast` indexing, calldata decoding, transaction simulation, or cross-chain executor tracking yet.
- No raw payload archive.

## How It Works

```text
Scheduler or admin fetch request
  -> protocol registry
  -> Lido, Aave, Uniswap, or CoW adapter
  -> Discourse client
  -> Zod response validation
  -> source-activity watchdog update
  -> protocol publisher policy (name allowlist and optional trust levels)
  -> normalizer
  -> protocol baseline check
  -> protocol notification policy
  -> proposal repository upsert
  -> recipient-aware Telegram notification dispatcher
  -> fetch-run repository audit record

Notification recovery scheduler
  -> pending/failed forum proposal and on-chain lifecycle-event query
  -> retry only due unresolved recipients
  -> update recipient and aggregate notification state

Six-hour Uniswap on-chain scheduler or admin scan request
  -> validate Ethereum mainnet and configured contracts
  -> verify finalized cursor and Governor implementation
  -> read finalized Governor lifecycle logs in bounded ranges
  -> refresh every proposal whose Governor state can still transition
  -> verify proposal-id and canonical lifecycle-reference coverage
  -> upsert decisions and deterministic lifecycle events atomically
  -> recipient-aware Telegram lifecycle notification dispatcher
  -> persist source cursor and scan-run audit data
```

Lido uses the proposal-category Discourse endpoint:

```text
GET https://research.lido.fi/c/proposals/9/l/latest.json?page=<page>
```

`9` is the Lido forum proposal category id. This keeps Lido polling focused on proposal-category topics instead of all latest forum discussion.

Lido's publisher policy is an OR rule. A topic is tracked when the original poster matches `LIDO_ALLOWED_PUBLISHERS` or when that original poster has Discourse `trust_level=4` (Leader). The trust level comes from the same category response's `users` record, so no per-topic request is required. Only the original poster is evaluated: a Leader who replies, comments most recently, or appears as a frequent poster cannot make another author's topic eligible. Other protocols remain name-allowlist-only until their adapters explicitly opt into a trust-level policy.

Aave, Uniswap, and CoW use broader forum coverage because proposal-like activity can appear across multiple public categories and subcategories:

```text
GET https://governance.aave.com/latest.json?page=<page>
GET https://governance.aave.com/site.json
GET https://governance.aave.com/c/<category-path>/<category-id>/l/latest.json?page=<page>

GET https://gov.uniswap.org/latest.json?page=<page>
GET https://gov.uniswap.org/site.json
GET https://gov.uniswap.org/c/<category-path>/<category-id>/l/latest.json?page=<page>

GET https://forum.cow.fi/latest.json?page=<page>
GET https://forum.cow.fi/site.json
GET https://forum.cow.fi/c/<category-path>/<category-id>/l/latest.json?page=<page>
```

The Aave, Uniswap, and CoW adapters combine global latest pages with every public category/subcategory discovered from `/site.json`, then deduplicate by Discourse topic id. Lido also deduplicates topics repeated across adjacent proposal pages. CoW coverage therefore follows the forum as its public category structure changes and currently includes areas such as Governance, Closed Proposals, Governance Resources, Inactive Proposals, Delegates, Technical, Grants, Treasury, Announcements, and General. Private/read-restricted categories are ignored because the public API does not expose them without forum permissions.

Aave applies one notification-only exception after allowlist filtering. A forum topic is still normalized, deduplicated, stored, and included in fetch-run audit data, but Telegram is suppressed when all of the following are true: the publisher identity is exactly LlamaRisk after case/spacing/punctuation normalization; the title starts with `Risk Stewards:`; it has a valid `/ YYYY.MM.DD` or `- YYYY-MM-DD` suffix; and the subject is a recognized cap-only or cap-plus-IRM increase, decrease, reduction, or change for Aave V3/V4. Combined patterns recognize `IRM` and the observed `USDT IRM` variant, not arbitrary qualifier words. The rule deliberately fails open. IRM-only posts, PT parameter changes, Slope2 changes, oracle changes, incidents, assessments, unfamiliar combinations, and posts by any other publisher continue to notify normally.

If a forum still reports more pages after the configured page cap, the monitor logs that as an `info` message with the page limit and fetched count. That is coverage telemetry, not a failed fetch.

Transient Discourse network failures, request timeouts, and `408`, `429`, or `5xx` responses are retried up to three attempts with bounded exponential backoff; a valid `Retry-After` header is respected up to 30 seconds. Invalid JSON and definitive client errors are not retried. A failed later page does not discard usable topics. Aave, Uniswap, and CoW also continue through other public feeds when one fails; their shared collector deduplicates all results.

Partial results are processed, but the fetch run records `coverageComplete: false` and sanitized diagnostics in `errors`. The daily admin report shows `ATTENTION REQUIRED` until a fully covered fetch succeeds. A partial fetch cannot complete cold-start seeding or advance the historical-notification cutoff. A proposal recovered after a feed outage can therefore still notify if it is newer than the last fully successful poll. Here, complete coverage means the configured public feed/page window was read without failures, not that the forum's entire history was fetched. Normal pagination caps are telemetry, not partial-fetch errors. If no feed can be read, the run fails.

Forum polling is bounded. A long outage or activity burst that pushes a topic beyond every configured page window can still prevent discovery. Review pagination telemetry and increase page limits or polling frequency when needed; polling cannot guarantee capture of content that the source no longer exposes in those windows.

### Uniswap On-chain Tracking

The on-chain adapter reads the canonical Uniswap Governor Bravo contract on Ethereum mainnet. The UNI token contract is validated as the Governor's configured voting token; it is not scanned as a separate proposal source. Before scanning, the adapter validates:

- RPC chain id `1` and a finalized head.
- Bytecode at the configured Governor, Timelock, UNI token, and current Governor implementation.
- The Governor's own `timelock()` and `uni()` values against configuration.
- Governor proposal counters and voting parameters.
- The stored Governor implementation on every run. An implementation change stops scanning until the code and configuration are reviewed.

Validation and proposal reads are pinned to the same finalized block snapshot, so a scan never combines a newer contract counter with older proposal state. The source reads `ProposalCreated`, `ProposalCanceled`, `ProposalQueued`, and `ProposalExecuted` logs. The proxy also contains legacy Governor Alpha events for proposal IDs `1` through `8`; the adapter reads the contract's `initialProposalId` and excludes those events. Governor Bravo tracking therefore begins at proposal `#9` rather than calling Bravo state methods with invalid Alpha IDs.

Contract state supplies the native proposal status, aggregate `forVotes`, `againstVotes`, and `abstainVotes` totals, ETA, proposer, voting blocks, and action arrays. Every proposal that can still change Governor state is refreshed on each scan. That includes `pending`, `active`, `succeeded`, `queued`, `defeated`, and `expired`; Governor Bravo permits the last two to be canceled later. This is how the monitor observes result and cancellation changes even when no usable lifecycle log is returned in the incremental range. Vote-total changes update the stored decision without generating an alert until the result changes. This step does not archive individual `VoteCast` ballots or voter addresses. If a proposal is queued and canceled between polls, the canonical queue and cancellation are both retained rather than collapsing the lifecycle to only its final state.

Only finalized blocks are processed. Each log query is capped at 10,000 blocks for compatibility with the configured QuickNode endpoint. The first production scan replays from Governor deployment block `13,059,157` to a fixed finalized target and persists progress after each complete range. This can require roughly 1,300 RPC log requests and may take several minutes, but it is resumable after a process or provider failure. Historical lifecycle records are stored with notifications skipped. New lifecycle notifications begin only after that baseline is complete.

Normal scans overlap the previous 64 finalized blocks and verify the stored cursor block hash before advancing. Deterministic decision and lifecycle-event IDs make overlap safe. The scanner independently compares stored proposal IDs with `initialProposalId + 1` through `proposalCount`, verifies that `proposalCount` has not regressed below an already stored proposal, and requires canonical creation/cancellation/queue/execution block and transaction references whenever the current lifecycle state implies those events. A missing or corrupt baseline record triggers a silent full repair. A post-baseline proposal or lifecycle gap triggers a notification-enabled full-range retry: the persisted `replayMode` survives restarts, existing deterministic events remain deduplicated, and a genuinely missed event can still alert. The failed run is never reported as successful and never advances past the coverage gap.

Lifecycle states, finalized observation blocks, and aggregate vote totals are monotonic. Proposal identity, proposer, voting window, actions, and source URL are immutable; an ETA may be established once when queued but cannot later change. Invalid backward transitions, regressive vote totals or counters, inconsistent Governor state/flags/ETA, unexpected duplicate creation/queue/execution stages, logs outside their requested range, conflicting duplicate logs, a cursor ahead of the finalized head, a changed finalized cursor hash, contract identity mismatch, unsupported contract state, missing proposal IDs, or missing canonical lifecycle references fail closed and appear in the daily admin report. Governor Bravo can legitimately emit repeated cancellation logs; the earliest cancellation remains the canonical lifecycle transition, while later cancellation calls neither rewrite it nor send another alert. Re-observed event metadata can otherwise enrich a stored lifecycle record in place, but its notification state and deterministic identity are preserved, so enrichment never sends a duplicate alert.

The implementation-change guard monitors the configured Governor Bravo proxy. A migration to an entirely separate Governor address cannot be inferred from an unchanged old contract alone; it requires an explicit address/configuration update and adapter review. Forum source-activity alerts and the daily operator report provide additional operational signals, but they are not a substitute for reviewing official Uniswap governance migration announcements.

### Aave On-chain Tracking

Both on-chain scanners verify each tracked log's block hash against its finalized RPC block header before persisting decisions or sending alerts. They validate the range endpoint before processing its proposals; an endpoint at the finalized head must match the hash returned by source validation. The scanner caches block headers within each range and reuses them for the cursor where possible. Proposal readers can make additional reads for vote timestamps. A mismatch fails the scan, preserves the last safe checkpoint, and appears in the daily admin report.

Aave Governance V3 is monitored independently from its forum allowlist and notification-suppression rules. Every on-chain proposal is tracked, including native proposal ID `0`. The source is the Ethereum Governance proxy `0x9AEE0B04504CeF83A65AC3f0e838D0593BCb2BC7`, deployed at block `18,119,225`; both identity and deployment were verified through the configured RPC. The implementation is read from the EIP-1967 proxy slot and guarded against unreviewed upgrades.

The adapter reads `ProposalCreated`, `VotingActivated`, `ProposalQueued`, `ProposalFailed`, `ProposalCanceled`, and `ProposalExecuted`, and refreshes proposal state at the same finalized Ethereum block. Aave's counter is a **count**, not a last ID: a count of `543` covers proposals `0..542`. Coverage checks, resumable baseline scanning, and replay repair honor that distinction without changing Uniswap numbering.

Votes may be cast on Polygon, Avalanche, or Ethereum, but the Governance contract receives the accepted `forVotes` and `againstVotes` on Ethereum. This integration reports those **settled results**, not live totals from remote voting machines. An elapsed voting duration alone is never treated as a passed or failed result. There is no abstain option; Aave notifications omit it. Totals use 18-decimal AAVE voting power and the same percentage formatting as Uniswap.

An Aave proposal can expire before receiving any vote result. That does not imply a successful vote or queue. Likewise, Ethereum `ProposalExecuted` confirms dispatch to payload controllers: its alert says **GOVERNANCE PROPOSAL FORWARDED**. In shared records, Aave's `status=executed` and `executionOutcome=executed` are explicitly scoped by `aave.executionScope=governance-core`. Payload chain IDs, controller addresses, and native payload IDs are stored under `aave.payloads`; destination-chain execution is not verified in this integration.

Aave uses timestamp-based voting, not Governor Bravo voting block windows. The database stores native activation time and duration under `aave`, without fabricated `startBlock`/`endBlock` values. Result messages show **Result settled**, the verified Ethereum acceptance timestamp, rather than mislabeling core activation plus duration as the remote voting-end date. Pending lifecycle alerts wait for their canonical log references; recovery cannot send an incomplete result early.

Metadata is optional presentation data. New live discoveries attempt a bounded IPFS title/description lookup using the on-chain digest. Failure does not block voting/results tracking: the stored CID and proposal link remain available with an explicit `Aave governance proposal #<id>` title. Historical seeding skips gateway requests, and missing metadata may be retried when native state changes, not on every unchanged scan.

Enable tracking with the existing Ethereum RPC; no additional chain RPC or signing key is required:

```bash
AAVE_ONCHAIN_ENABLED=true
AAVE_ONCHAIN_NOTIFICATIONS_ENABLED=false
```

Both flags default to `false` and have been added in the Aave section of local `.env`. Existing credentials and settings are unchanged. First complete the silent baseline with authenticated `POST /api/admin/fetch-onchain/aave`, then inspect `/api/admin/onchain-source-status`. To alert about subsequent new lifecycle events, set `AAVE_ONCHAIN_NOTIFICATIONS_ENABLED=true` with `ENABLE_TELEGRAM_NOTIFICATIONS=true` and recreate the container. Already skipped historical events are not replayed. Aave shares `ONCHAIN_FETCH_INTERVAL_CRON="0 */6 * * *"`, repositories, recipient-level retries, and the daily admin report with Uniswap.

For either on-chain protocol, setting `*_ONCHAIN_ENABLED=false` or `*_ONCHAIN_NOTIFICATIONS_ENABLED=false` also pauses delivery of previously queued lifecycle alerts. Pending/failed state and successful recipient deliveries are preserved. Re-enabling resumes due unresolved recipients without resending to successful recipients. Records for an unregistered or changed source identity are not automatically delivered. Paused unresolved records remain visible in admin notification counts; pausing does not acknowledge or erase a failure.

The authoritative contract interfaces and lifecycle semantics are documented in [Aave Governance V3](https://github.com/aave-dao/aave-governance-v3/blob/main/src/interfaces/IGovernanceCore.sol), [GovernanceCore](https://github.com/aave-dao/aave-governance-v3/blob/main/src/contracts/GovernanceCore.sol), and the [Aave address book](https://github.com/bgd-labs/aave-address-book/blob/main/src/GovernanceV3Ethereum.sol).

Aave's settled-result timestamp, block, and transaction are recorded together. The result header must match the log's block hash and agree with the contract's voting window and queue timestamp. Activation logs must agree with the stored voting snapshot and duration, and distinct duplicate stages in a proposal batch are rejected. Once established, settlement evidence plus queue/cancellation timestamps cannot change. Invalid evidence fails before persistence or notification. IPFS failures remain nonfatal and produce a sanitized warning.

## Stored Data

Proposals are stored under `proposals/{proposalId}` in Firestore production mode. Memory mode stores the same shape in-process for demos and tests.

Example proposal:

```json
{
  "id": "lido_forum_11624_445bfbca21",
  "protocol": "lido",
  "sourceType": "forum",
  "sourceId": "11624",
  "title": "Lido Labs proposes Nemo as a new director",
  "publisherName": "Lido Labs Foundation - Operations Team",
  "sourceUrl": "https://research.lido.fi/t/lido-labs-proposes-nemo-as-a-new-director/11624",
  "publishedAt": "2026-06-17T06:59:06.620Z",
  "firstSeenAt": "2026-06-17T07:00:00.000Z",
  "lastSeenAt": "2026-06-17T07:00:00.000Z",
  "fetchedAt": "2026-06-17T07:00:00.000Z",
  "rawHash": "64-character-sha256-hash",
  "notificationStatus": "sent",
  "notificationDeliveries": {
    "opaque-recipient-hash": {
      "recipientKey": "opaque-recipient-hash",
      "recipientMaskedId": "******3073",
      "status": "sent",
      "attemptCount": 1,
      "createdAt": "2026-06-17T07:00:00.000Z",
      "updatedAt": "2026-06-17T07:00:00.000Z",
      "lastAttemptAt": "2026-06-17T07:00:00.000Z",
      "sentAt": "2026-06-17T07:00:00.000Z"
    }
  },
  "createdAt": "2026-06-17T07:00:00.000Z",
  "updatedAt": "2026-06-17T07:00:00.000Z"
}
```

`firstSeenAt` is set when the proposal is first stored. `lastSeenAt`, `fetchedAt`, and `updatedAt` advance when a new proposal is inserted or an existing proposal has meaningful source changes. If a repeated poll sees the same proposal with no meaningful changes, the service counts it as `unchangedExistingCount` and does not rewrite the proposal document.

The repository derives the document ID itself from `protocol + sourceType + sourceId`; it does not trust an adapter-supplied ID. This keeps future adapters from accidentally creating duplicate identities.

`notificationDeliveries` stores an opaque deterministic recipient key and masked Telegram ID, never the full Telegram user ID. A successful recipient remains `sent`; if another recipient fails, only that unresolved recipient is retried. The aggregate `notificationStatus` is `failed` while any recipient remains failed and becomes `sent` automatically after all remaining deliveries succeed.

Policy-suppressed proposals have `notificationStatus: "skipped"` and an optional machine-readable `notificationSkipReason`, currently `aave_risk_stewards_routine_cap_change`. This is distinct from publisher filtering: suppressed proposals are retained in Firestore, while non-allowlisted topics are not stored as proposals. Automatic recovery also applies the current policy to unresolved records, so a matching pending or failed cap alert is closed as skipped rather than sent later.

Uniswap on-chain decisions use separate collections because their lifecycle and vote data differ from forum topics:

- `governanceDecisions/{decisionId}` stores proposal identity, proposer, title/description, status, voting and execution outcomes, vote totals, the exact voting-end block timestamp when known, ETA, action arrays, lifecycle transaction/block references, and timestamps.
- `governanceEvents/{eventId}` stores one deterministic notification event per meaningful lifecycle transition plus masked recipient delivery state.
- `governanceSourceStates/{sourceKey}` stores the resumable baseline/cursor, `initialProposalId`, fixed baseline proposal count, silent/live replay mode, finalized block hashes, validated implementation address, and current source health.
- `governanceScanRuns/{runId}` stores each scan's range, event, decision, lifecycle, notification, and error counts.

Decision identity is derived from `protocol + sourceType + chainId + governorAddress + proposalId`. Lifecycle identity is derived from `decisionId + transition`, so replay overlap and repeated scans cannot create duplicate records or alerts. Vote amounts are stored as base-unit decimal strings to avoid JavaScript precision loss. The read API returns raw values; for UNI display, divide by `10^18`.

An on-chain decision may move through `pending`, `active`, `succeeded`, `queued`, and `executed`, or end as `defeated`, `canceled`, or `expired`. `firstSeenAt` and `createdAt` are preserved. Meaningful contract-state or canonical event changes update the existing record; merely scanning it again does not rewrite it.

Fetch runs are stored under `fetchRuns/{runId}`:

```json
{
  "protocol": "aave",
  "status": "success",
  "fetchedCount": 120,
  "allowlistedCount": 4,
  "storedNewCount": 1,
  "baselineSeededCount": 0,
  "updatedExistingCount": 0,
  "unchangedExistingCount": 3,
  "skippedCount": 116,
  "notificationSentCount": 1,
  "notificationFailedCount": 0,
  "notificationSuppressedCount": 0,
  "errors": []
}
```

`storedNewCount` means a proposal was first discovered. `baselineSeededCount` is the subset inserted silently either during an empty-database baseline or when an allowlist expansion first exposes historical topics. `updatedExistingCount` means an already-stored proposal changed in a meaningful source field. `unchangedExistingCount` means the item was seen again but not rewritten. `skippedCount` means the publisher did not match the eligibility policy and was not stored. `notificationSuppressedCount` means a newly stored, eligible proposal matched an explicit protocol notification policy; duplicate polls do not increment it again.

Source activity records are stored under `sourceActivity/{protocol}`. These records are based on all raw fetched forum items, before publisher allowlist filtering, so they can detect a forum that still responds but appears abandoned or silently migrated.

Protocol baseline state is stored under `protocolState/{protocol}`. If no proposal and no protocol state exist, the first complete fetch that meets `SOURCE_ACTIVITY_MIN_FETCHED_COUNT` stores allowlisted history with notifications skipped, then marks that protocol baseline complete. If proposal records already exist during an upgrade, the baseline is treated as established. An interrupted or unexpectedly empty first fetch remains in `seeding` state so its retry cannot spam historical proposals.

After an established baseline, a newly allowlisted publisher may have older topics in the bounded forum window that were never stored. Those topics are persisted silently when their publication time is at or before the start of the previous fully successful protocol poll. Unseen topics published during or after that poll still notify normally, including recovered partial-feed results and proposals found after monitor downtime. Using the start rather than finish time avoids losing alerts for topics posted while source pages were being fetched. Failed and partial polls are never used as the freshness boundary. Legacy successful runs without a coverage flag retain their existing behavior.

Example source activity record:

```json
{
  "protocol": "aave",
  "sourceType": "forum",
  "latestRawSourceId": "25170",
  "latestRawPublishedAt": "2026-07-01T00:00:00.000Z",
  "lastFetchedAt": "2026-07-02T00:00:00.000Z",
  "lastFetchedCount": 120,
  "consecutiveStaleRuns": 0,
  "status": "healthy",
  "warningThresholdDays": 14,
  "criticalThresholdDays": 30,
  "minFetchedCount": 1,
  "updatedAt": "2026-07-02T00:00:00.000Z"
}
```

If the newest raw item becomes older than the configured threshold, or a fetch unexpectedly returns too few raw items, the daily admin status report marks the source as warning or critical.

## Configuration

Create a local `.env` file manually. It is ignored by git.

Common development values:

```bash
NODE_ENV=development
PORT=3000
STORAGE_MODE=memory
DEMO_MODE=true
ENABLE_SCHEDULER=false
API_AUTH_ENABLED=false
LOG_LEVEL=info
```

Production-like values:

```bash
NODE_ENV=production
PORT=3000
STORAGE_MODE=firestore
DEMO_MODE=false
ENABLE_SCHEDULER=true
FETCH_INTERVAL_CRON=0 8 * * *
FETCH_RUN_MAX_AGE_HOURS=48
ETHEREUM_RPC_URL=https://replace-with-authenticated-ethereum-mainnet-rpc
UNISWAP_ONCHAIN_ENABLED=true
UNISWAP_ONCHAIN_NOTIFICATIONS_ENABLED=true
ONCHAIN_FETCH_INTERVAL_CRON=0 */6 * * *
ENABLE_SOURCE_ACTIVITY_ALERTS=true
SOURCE_ACTIVITY_WARNING_DAYS=14
SOURCE_ACTIVITY_CRITICAL_DAYS=30
SOURCE_ACTIVITY_MIN_FETCHED_COUNT=1
ENABLE_ADMIN_STATUS_REPORTS=true
TELEGRAM_ADMIN_USER_ID=1549323073
ADMIN_STATUS_CRON=0 9 * * *
NOTIFICATION_RETRY_CRON=*/15 * * * *
API_AUTH_ENABLED=true
API_AUTH_TOKEN=replace-with-long-random-secret
LOG_LEVEL=info
```

Allowed values:

- `NODE_ENV`: `development`, `test`, or `production`.
- `PORT`: integer from `1` to `65535`.
- `STORAGE_MODE`: `firestore` or `memory`.
- `DEMO_MODE`: `true` or `false`.
- `ENABLE_SCHEDULER`: `true` or `false`.
- `LIDO_ENABLED`, `AAVE_ENABLED`, `UNISWAP_ENABLED`, and `COW_ENABLED`: `true` or `false`; all four forum adapters default to `true`.
- `AAVE_SUPPRESS_ROUTINE_CAP_NOTIFICATIONS`: `true` or `false`; defaults to `true`. Set it to `false` to restore Telegram alerts for future newly discovered routine LlamaRisk Risk Stewards cap-only and cap-plus-IRM posts without changing Aave ingestion. Previously skipped records are not replayed.
- `FETCH_RUN_MAX_AGE_HOURS`: positive integer; default `48`. With the production scheduler enabled, the admin report flags each protocol whose last successful forum fetch is older than this. Raise it if you schedule forum scans less often than daily.
- `UNISWAP_ONCHAIN_ENABLED`: `true` or `false`; requires `ETHEREUM_RPC_URL` when enabled.
- `UNISWAP_ONCHAIN_NOTIFICATIONS_ENABLED`: `true` or `false`; requires both on-chain tracking and global Telegram notifications.
- `ONCHAIN_FETCH_INTERVAL_CRON`: valid cron expression; default `0 */6 * * *`.
- `ENABLE_SOURCE_ACTIVITY_ALERTS`: `true` or `false`.
- `SOURCE_ACTIVITY_WARNING_DAYS`: positive integer; warns when newest raw forum item is at least this old.
- `SOURCE_ACTIVITY_CRITICAL_DAYS`: positive integer greater than or equal to warning days.
- `SOURCE_ACTIVITY_MIN_FETCHED_COUNT`: non-negative integer; marks source critical if a fetch returns fewer raw items.
- `API_AUTH_ENABLED`: `true` or `false`. When `true`, startup fails unless
  `API_AUTH_TOKEN` contains a non-blank token; surrounding whitespace is ignored.
- `ENABLE_TELEGRAM_NOTIFICATIONS`: `true` or `false`.
- `NOTIFICATION_RETRY_CRON`: valid cron expression; default `*/15 * * * *`.
- `ENABLE_ADMIN_STATUS_REPORTS`: `true` or `false`.
- `TELEGRAM_E2E_ENABLED`: `true` or `false`.
- `LOG_LEVEL`: `trace`, `debug`, `info`, `warn`, `error`, `fatal`, or `silent`.

Firestore mode requires Firebase service account values:

```bash
FIREBASE_PROJECT_ID=replace-with-firebase-project-id
FIREBASE_CLIENT_EMAIL=replace-with-service-account-client-email
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nreplace-with-private-key\n-----END PRIVATE KEY-----\n"
```

Lido configuration:

```bash
LIDO_FORUM_BASE_URL=https://research.lido.fi
LIDO_FORUM_API_BASE_URL=https://research.lido.fi
LIDO_ENABLED=true
LIDO_ALLOWED_PUBLISHERS='[
  "Lido Labs Foundation - Operations Team",
  "Lido | Finance Team",
  "Lido Ecosystem Foundation - Operations Team"
]'
LIDO_FETCH_MAX_PAGES=5
```

The three configured names continue to match exactly as before. In addition, Lido automatically treats an original poster with Discourse Leader trust level (`trust_level=4`) as trusted even when their display name or username is not in `LIDO_ALLOWED_PUBLISHERS`. This exemption is Lido-specific and is defined in the Lido adapter rather than through another environment variable.

When this policy is first deployed, older Leader-authored topics already covered by a previous successful Lido poll are stored silently under the existing historical-backfill rule. Leader topics published after the previous successful poll follow the normal new-proposal path and notify configured recipients. This prevents the policy expansion from spamming historical posts while ensuring future Leader topics are alerted.

Aave configuration:

```bash
AAVE_FORUM_BASE_URL=https://governance.aave.com
AAVE_FORUM_API_BASE_URL=https://governance.aave.com
AAVE_ENABLED=true
AAVE_ALLOWED_PUBLISHERS='[
  "LlamaRisk",
  "TokenLogic",
  "Certora",
  "kpk",
  "karpatkey_TokenLogic",
  "AaveLabs",
  "stani"
]'
AAVE_FETCH_MAX_PAGES=10
AAVE_CATEGORY_FETCH_MAX_PAGES=2
AAVE_SUPPRESS_ROUTINE_CAP_NOTIFICATIONS=true
```

Aave allowlist entries should use Discourse publisher usernames. The current tracked names correspond to LlamaRisk, TokenLogic, Certora, karpatkey, Aave Labs, and Stani. `karpatkey_TokenLogic` is included because Aave has used that joint provider account for finance-service-provider posts.

With `AAVE_SUPPRESS_ROUTINE_CAP_NOTIFICATIONS=true`, routine dated LlamaRisk `Risk Stewards` cap-only and cap-plus-IRM posts remain queryable in Firestore but do not fan out to Telegram recipients. Their proposal document records `notificationStatus=skipped`; cap-only records use `notificationSkipReason=aave_risk_stewards_routine_cap_change`, while cap-plus-IRM records use `notificationSkipReason=aave_risk_stewards_routine_cap_and_irm_change`. The fetch run increments `notificationSuppressedCount`. IRM-only posts and any title the policy cannot classify confidently remain alertable.

Uniswap configuration:

```bash
UNISWAP_FORUM_BASE_URL=https://gov.uniswap.org
UNISWAP_FORUM_API_BASE_URL=https://gov.uniswap.org
UNISWAP_ENABLED=true
UNISWAP_ALLOWED_PUBLISHERS='[
  "haydenadams",
  "eek637",
  "devinwalsh",
  "kenneth",
  "nataliara",
  "GFXlabs",
  "UniswapFoundation",
  "UniswapLabs"
]'
UNISWAP_FETCH_MAX_PAGES=10
UNISWAP_CATEGORY_FETCH_MAX_PAGES=2
```

Uniswap allowlist entries should use stable Discourse profile usernames. The monitor also checks the raw Discourse username behind a displayed publisher name, so profiles like `devinwalsh` can be tracked even when the stored proposal publisher displays as `Devin`.

Uniswap on-chain configuration:

```bash
ETHEREUM_RPC_URL=https://replace-with-authenticated-ethereum-mainnet-rpc
UNISWAP_ONCHAIN_ENABLED=false
UNISWAP_ONCHAIN_NOTIFICATIONS_ENABLED=false
ONCHAIN_FETCH_INTERVAL_CRON=0 */6 * * *
UNISWAP_GOVERNOR_ADDRESS=0x408ED6354d4973f66138C91495F2f2FCbd8724C3
UNISWAP_TIMELOCK_ADDRESS=0x1a9C8182C09F50C8318d769245beA52c32BE35BC
UNISWAP_UNI_TOKEN_ADDRESS=0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984
```

Set `UNISWAP_ONCHAIN_ENABLED=true` only after supplying an authenticated Ethereum mainnet RPC URL that supports finalized blocks, contract reads, and `eth_getLogs` ranges of 10,000 blocks. Set `UNISWAP_ONCHAIN_NOTIFICATIONS_ENABLED=true` to alert normal production recipients about newly observed lifecycle transitions. This also requires `ENABLE_TELEGRAM_NOTIFICATIONS=true`. Keep the three verified mainnet contract addresses unchanged unless Uniswap governance migrates and the adapter has been reviewed for the new contracts.

The first enabled scan is intentionally silent and resumable. Run `POST /api/admin/fetch-onchain/uniswap` once after deployment and wait for `status: "success"` plus `baselineStatus: "complete"` from `/api/admin/onchain-source-status` before treating the source as live.

CoW DAO configuration:

```bash
COW_FORUM_BASE_URL=https://forum.cow.fi
COW_FORUM_API_BASE_URL=https://forum.cow.fi
COW_ENABLED=true
COW_ALLOWED_PUBLISHERS='[
  "notsoformal",
  "Kowrigan",
  "harisang",
  "felixhenneke",
  "KPK"
]'
COW_FETCH_MAX_PAGES=10
COW_CATEGORY_FETCH_MAX_PAGES=2
```

CoW allowlist entries use exact Discourse profile usernames. The five profiles above were verified against the public forum API. Matching is case-insensitive, but canonical casing is retained for `Kowrigan` and `KPK`. Filtering checks both the display name and raw username, so a profile remains trackable when Discourse shows a different display name.

Telegram direct-user notifications:

```bash
ENABLE_TELEGRAM_NOTIFICATIONS=false
TELEGRAM_BOT_TOKEN=replace-with-telegram-bot-token
TELEGRAM_ALLOWED_USER_IDS='[
  123456789,
  987654321
]'
NOTIFICATION_RETRY_CRON=*/15 * * * *
TELEGRAM_E2E_ENABLED=false
TELEGRAM_TEST_SEND_DELAY_MS=3000
```

Telegram recipients must open the bot and send `/start` once before Telegram allows the bot to message them. In production, proposal notifications fan out to every numeric ID listed in `TELEGRAM_ALLOWED_USER_IDS`. Demo/test notification sends are intentionally admin-only so teammates are not spammed during rehearsals.

The customer-facing governance message contract remains:

```text
NEW GOVERNANCE ITEM TRACKED
Protocol: <protocol>
Source: <source type>
Publisher: <publisher>
Title: <title>
Link: <source URL>
```

The heading is sent in bold, all caps. Dynamic fields are HTML-escaped before Telegram delivery.

On-chain lifecycle notifications use the same delivery and retry machinery. Telegram displays only operationally useful fields; source type, proposal number, proposer, block references, actions, and other complete decision data remain stored in Firestore for later use. Vote-result messages include the exact UTC timestamp of the Ethereum voting-period end block plus formatted `For`, `Against`, and `Abstain` UNI totals. Each percentage is that option's share of all votes cast, including abstentions, rounded to two decimal places. A non-zero share that would round to `0.00%` is displayed as `0.01%` so it is never mistaken for no votes. Example:

```text
ON-CHAIN GOVERNANCE VOTE RESULT
Protocol: UNISWAP
Status: Succeeded
Voting ended: 2026-07-25 07:29 UTC
For: 46,604,582.79 UNI (97.33%)
Against: 1,274,746.48 UNI (2.66%)
Abstain: 1,813.59 UNI (0.01%)
Title: Activate v4 Protocol Fees (Part 1/2)
Link: https://vote.uniswapfoundation.org/proposals/100
```

The heading and uppercase protocol value are bold in Telegram. Existing forum notification text is unchanged.

A delivery is considered successful only when Telegram returns a valid JSON response with `ok: true`. HTTP `2xx` responses containing HTML, malformed JSON, an empty body, or `ok: false` remain failed and enter automatic recipient-level recovery instead of being marked sent.

Failed proposal deliveries are retried automatically while the main scheduler is enabled. Backoff is 15 minutes, 1 hour, 6 hours, then 24 hours for later attempts. Recipient state prevents already-successful users from receiving the same proposal again. Removing an unresolved recipient from `TELEGRAM_ALLOWED_USER_IDS` marks that recipient delivery skipped and allows the aggregate proposal status to clear. Legacy failed records that do not identify their failed recipient safely are automatically closed as `skipped` without resending; this prevents both permanent health-report noise and delivery to a guessed recipient.

Telegram admin status reports:

```bash
ENABLE_ADMIN_STATUS_REPORTS=true
TELEGRAM_ADMIN_USER_ID=1549323073
ADMIN_STATUS_CRON=0 9 * * *
```

Admin status reports use the same `TELEGRAM_BOT_TOKEN`, but they are separate from production notification recipients. When `ENABLE_SCHEDULER=true`, forum fetches run daily at `08:00`, enabled on-chain sources run every six hours, notification recovery checks run every 15 minutes, and the admin receives one daily status message at `09:00` server time. The report covers forum fetches, source activity, on-chain baseline/cursor/source health, latest on-chain scan status, aggregate forum and lifecycle delivery counts, masked unresolved recipients, and missing publisher eligibility policies. Lido's Leader-author exemption is valid even with an empty publisher-name allowlist. The report flags a scheduled forum fetch older than `FETCH_RUN_MAX_AGE_HOURS` or an enabled on-chain source with no successful scan within 12 hours. These checks catch stopped or silently broken schedulers even when the last stored source state looked healthy.

An incomplete Uniswap or Aave historical baseline also makes the daily report show `ATTENTION REQUIRED`. The on-chain section precedes verbose forum details so it survives message truncation. It displays checkpointed and remaining blocks, progress, the resume cursor, last attempt/success, consecutive failures, latest scan, replay mode, and a bounded sanitized source error. Historical alerts remain suppressed until baseline completion. A live coverage replay is called out separately and remains notification-enabled, with deterministic IDs preventing duplicate alerts. Invalid or future-dated scan timestamps also require attention.

The same report can be triggered manually with `POST /api/admin/status/send`. The report is defensive: if one status subsection cannot be read, for example a Firestore query error, the admin still receives an `ATTENTION REQUIRED` message with the failing subsection named.

Failed proposal notifications stay visible in the daily admin status while recipient delivery remains unresolved. They clear automatically after a retry succeeds or the unresolved recipient is removed from configuration. Historical fetch-run failure counts remain in the audit trail but do not keep future daily reports in `ATTENTION REQUIRED` after current proposal state has recovered.

Recovery processes at most 100 eligible records per dispatcher per cycle. Paused and backed-off records do not hide later due alerts, even with more than 1,000 outstanding records. Batches rotate to avoid starvation by persistently unreadable records, and one record's storage failure is logged without aborting the others. Outstanding lifecycle counts remain visible even when all on-chain sources are disabled; pausing does not erase an unresolved delivery.

Source activity watchdog:

```bash
ENABLE_SOURCE_ACTIVITY_ALERTS=true
SOURCE_ACTIVITY_WARNING_DAYS=14
SOURCE_ACTIVITY_CRITICAL_DAYS=30
SOURCE_ACTIVITY_MIN_FETCHED_COUNT=1
```

This watchdog looks at all raw fetched forum topics, not just allowlisted publishers. It helps catch silent forum migrations, abandoned category feeds, and old forums that still return valid JSON but no longer receive new governance activity.

For a one-off Telegram-safe demo, set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ADMIN_USER_ID`, then run `npm run demo:admin`. Demo proposal notifications and the final status report are sent only to the admin user. Plain `npm run demo` keeps the admin status demo off even if production admin reports are enabled in `.env`.

## Commands

Install dependencies:

```bash
npm install
```

Run the API locally:

```bash
npm run dev
```

Run the terminal demo:

```bash
npm run demo
```

Run the terminal demo with the final admin status Telegram report:

```bash
npm run demo:admin
```

Run all normal tests:

```bash
npm test
```

This runs all non-live Jest unit, regression, repository, and Supertest integration suites and enforces global minimums of 97% statements, 88% branches, 96% functions, and 97% lines. Critical modules also have stricter per-file thresholds. Live Ethereum RPC and Telegram delivery tests remain opt-in.

Regressions cover real-adapter partial HTTP recovery, silent incomplete baselines, large retry backlogs, recipient-level deduplication, poisoned-record isolation, concurrent memory updates, transactional write rollback, disabled-source API protection, and finalized-head consistency. The Firestore test double stages writes and rejects reads after writes; it is not a substitute for a post-deployment smoke check against your configured Firestore project.

Run full verification:

```bash
npm run check
```

`npm run check` runs the production TypeScript build, strict unused-symbol typecheck, and the full Jest/Supertest test suite.

Audit the dependency set installed in the production image:

```bash
npm run audit:prod
```

The image omits development dependencies and Firebase Admin's unused optional Cloud Storage dependency tree, so this command audits the same runtime dependency set.

Run real Telegram test-send:

```bash
npm run telegram:test-send
```

This command requires `TELEGRAM_E2E_ENABLED=true` and sends saved forum samples plus a real saved Aave settled-result sample only to `TELEGRAM_ADMIN_USER_ID`. It deliberately ignores `TELEGRAM_ALLOWED_USER_IDS` so teammate proposal-notification recipients are not spammed during tests.

Run real Telegram E2E test:

```bash
npm run test:e2e:telegram
```

This sends saved real forum samples and Uniswap/Aave proposal-result samples through memory repositories, then verifies recipient-level `sent` state. The service is constructed with only `TELEGRAM_ADMIN_USER_ID`; production teammate recipients are not used.

Validate all live forum APIs without Firestore or Telegram:

```bash
npm run test:e2e:forums
```

This reads page zero from Lido's proposal category and the global latest feeds from Aave, Uniswap, and CoW, validates the live Discourse response shape, and verifies public category discovery for the three broad-coverage adapters.

Run the read-only live Uniswap RPC E2E test:

```bash
npm run test:e2e:onchain
```

This validates Ethereum mainnet, the Governor/Timelock/UNI/implementation relationships, proposal #100's canonical creation/queue/execution logs, exact voting-end timestamp, current vote totals, and all seven actions. It does not access Firestore or Telegram.

Run the independent read-only Aave Governance V3 test:

```bash
npm run test:e2e:aave-onchain
```

It validates mainnet/proxy identity and replays real proposal `0`'s canonical creation, activation, result settlement, and forwarding logs against saved vote totals and seven payload identities. It uses neither Firestore nor Telegram.

For the full Aave deployment check:

```bash
npm run test:e2e:aave-onchain:full
```

This runs the production scan job from deployment to a fixed finalized head using memory repositories. It verifies every native proposal ID, canonical result evidence, silent seeding, and a duplicate-free repeat scan at the same head. It makes many RPC requests and can take several minutes or longer under provider throttling. It does not use Firestore, Telegram, or IPFS.

The Telegram commands send real messages only when the required Telegram env values are configured. Demo/test Telegram messages are admin-only. Normal `npm test` and `npm run check` make neither live RPC calls nor Telegram requests; each live E2E path requires its dedicated script.

For an expensive deployment-to-head audit, run `npm run test:e2e:onchain:full`. It replays every Governor Bravo proposal into memory, verifies contiguous proposal coverage, canonical lifecycle references, final-result timestamps, and idempotency, and forcibly disables Firestore and Telegram. Use it deliberately because it performs many RPC requests and can take 10-30 minutes when the provider throttles repeated historical reads.

## Operational API

If `API_AUTH_ENABLED=true`, every endpoint requires the configured token. Use HTTPS in production so the token is not exposed in transit.

Security notes:

- Keep `.env` and `.env.*` files out of git and Docker images.
- Use a long random `API_AUTH_TOKEN` when the API is reachable outside your machine.
- Request logs redact `Authorization`, `x-api-token`, Telegram, Firebase, and API token fields.

| Endpoint                                                     | External call? | Purpose                                                                                                                  |
| ------------------------------------------------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `GET /health`                                                | No             | Confirms storage/scheduler mode plus the enabled forum and on-chain protocol lists.                                      |
| `POST /api/admin/fetch/lido`                                 | Yes            | Fetches Lido proposal-category topics, filters, stores, notifies, and writes a fetch run.                                |
| `POST /api/admin/fetch/aave`                                 | Yes            | Fetches Aave global latest plus public category/subcategory feeds, filters, stores, notifies, and writes a fetch run.    |
| `POST /api/admin/fetch/uniswap`                              | Yes            | Fetches Uniswap global latest plus public category/subcategory feeds, filters, stores, notifies, and writes a fetch run. |
| `POST /api/admin/fetch/cow`                                  | Yes            | Fetches CoW global latest plus public category/subcategory feeds, filters, stores, notifies, and writes a fetch run.     |
| `POST /api/admin/fetch-onchain/uniswap`                      | RPC            | Runs the same finalized Uniswap Governor scan as the six-hour scheduler. The first run silently seeds history.           |
| `POST /api/admin/fetch-onchain/aave`                         | RPC/IPFS       | Runs the finalized Aave Governance V3 scan; silently seeds history and tracks accepted results and core forwarding.      |
| `POST /api/admin/status/send`                                | Telegram       | Sends the same operator Telegram status report used by the daily admin cron.                                             |
| `GET /api/admin/fetch-runs`                                  | No             | Returns latest stored fetch-run audit records, newest first.                                                             |
| `GET /api/admin/source-activity`                             | No             | Returns latest raw-source freshness records used by the silent-migration watchdog.                                       |
| `GET /api/admin/governance-votes?protocol=uniswap&limit=100` | No             | Returns stored on-chain decisions, newest updated first. `limit` must be `1..500`.                                       |
| `GET /api/admin/onchain-source-status`                       | No             | Returns stored on-chain baseline, cursor, implementation, finalized-head, and health state.                              |
| `GET /api/admin/onchain-scan-runs?limit=100`                 | No             | Returns stored on-chain scan audit records, newest first. `limit` must be `1..500`.                                      |

With auth enabled, include a token:

```bash
curl -s http://localhost:3000/health \
  -H "Authorization: Bearer $API_AUTH_TOKEN"
```

You can also use `x-api-token: $API_AUTH_TOKEN`.

## Demo Mode

`npm run demo` runs a credential-free terminal walkthrough using memory storage and locally saved governance payload samples. It exercises the same fetch, allowlist, dedupe, storage, fetch-run, and notification code paths as normal operation.

Demo mode shows:

- Lido live discovery, historical allowlist backfill without old alerts, and duplicate suppression across multiple fetches.
- Non-allowlisted Lido items being skipped.
- Aave global latest plus category/subcategory coverage.
- Aave routine cap-only and cap-plus-IRM notification suppression, including persisted reasons and fetch-run counts.
- Uniswap global latest plus all discovered public category/subcategory coverage.
- CoW global latest plus all discovered public category/subcategory coverage.
- A real saved snapshot of Uniswap Governor proposal `#100` progressing through silent baseline, creation, successful result, queue, and execution.
- A real saved Aave proposal `#0` progressing through silent baseline, discovery, accepted result, and forwarding, followed by an idempotent repeated scan. Telegram-enabled demos remain admin-only.
- On-chain lifecycle event persistence, canonical create/queue/execute references, persisted notification-state totals, and a repeated scan with zero duplicate decisions or alerts.
- Repeat fetches updating counts without duplicating proposals.
- Stored proposals printed from the repository.
- Fetch-run audit records printed from the repository.
- Source-activity watchdog records printed from the repository.
- Recipient-level notification state when Telegram is enabled.

Speed it up:

```bash
DEMO_STEP_DELAY_MS=0 npm run demo
```

If Telegram is enabled in `.env`, the demo can send forum and on-chain lifecycle notifications, but only to `TELEGRAM_ADMIN_USER_ID`. It never uses teammate IDs from `TELEGRAM_ALLOWED_USER_IDS`. The saved Uniswap proposal #100 snapshot records an action count of seven; the concise scripted demo includes its first action as a representative sample, while the production RPC adapter persists every returned action.

## Docker

The multi-stage production image uses Node.js 24 LTS, runs as the non-root `node` user, and contains compiled JavaScript plus production dependencies only.

Production image:

```bash
docker build --load -t governance-tracker-bot .
```

Production container with runtime environment variables:

```bash
docker run -d \
  -p 127.0.0.1:3001:3000 \
  --name governance-tracker-bot \
  --restart unless-stopped \
  -e NODE_ENV=production \
  -e PORT=3000 \
  -e STORAGE_MODE=firestore \
  -e DEMO_MODE=false \
  -e ENABLE_SCHEDULER=true \
  -e FETCH_INTERVAL_CRON="0 8 * * *" \
  -e FETCH_RUN_MAX_AGE_HOURS=48 \
  -e ETHEREUM_RPC_URL="https://replace-with-authenticated-ethereum-mainnet-rpc" \
  -e UNISWAP_ONCHAIN_ENABLED=true \
  -e UNISWAP_ONCHAIN_NOTIFICATIONS_ENABLED=true \
  -e AAVE_ONCHAIN_ENABLED=true \
  -e AAVE_ONCHAIN_NOTIFICATIONS_ENABLED=false \
  -e ONCHAIN_FETCH_INTERVAL_CRON="0 */6 * * *" \
  -e UNISWAP_GOVERNOR_ADDRESS="0x408ED6354d4973f66138C91495F2f2FCbd8724C3" \
  -e UNISWAP_TIMELOCK_ADDRESS="0x1a9C8182C09F50C8318d769245beA52c32BE35BC" \
  -e UNISWAP_UNI_TOKEN_ADDRESS="0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984" \
  -e ENABLE_SOURCE_ACTIVITY_ALERTS=true \
  -e SOURCE_ACTIVITY_WARNING_DAYS=14 \
  -e SOURCE_ACTIVITY_CRITICAL_DAYS=30 \
  -e SOURCE_ACTIVITY_MIN_FETCHED_COUNT=1 \
  -e API_AUTH_ENABLED=true \
  -e API_AUTH_TOKEN="replace-with-long-random-secret" \
  -e FIREBASE_PROJECT_ID="replace-with-project-id" \
  -e FIREBASE_CLIENT_EMAIL="replace-with-client-email" \
  -e FIREBASE_PRIVATE_KEY="replace-with-private-key" \
  -e ENABLE_TELEGRAM_NOTIFICATIONS=true \
  -e TELEGRAM_BOT_TOKEN="replace-with-telegram-bot-token" \
  -e TELEGRAM_ALLOWED_USER_IDS='["1549323073"]' \
  -e NOTIFICATION_RETRY_CRON="*/15 * * * *" \
  -e ENABLE_ADMIN_STATUS_REPORTS=true \
  -e TELEGRAM_ADMIN_USER_ID="1549323073" \
  -e ADMIN_STATUS_CRON="0 9 * * *" \
  -e LIDO_ENABLED=true \
  -e AAVE_ENABLED=true \
  -e AAVE_SUPPRESS_ROUTINE_CAP_NOTIFICATIONS=true \
  -e UNISWAP_ENABLED=true \
  -e COW_ENABLED=true \
  -e LOG_LEVEL=info \
  governance-tracker-bot
```

The API is bound to host loopback at `127.0.0.1:3001`; scheduled polling and outbound Telegram delivery still work. This example enables Aave on-chain tracking with alerts off. Once its baseline is complete and healthy, recreate the container with `AAVE_ONCHAIN_NOTIFICATIONS_ENABLED=true` to enable new lifecycle alerts.

Add the protocol allowlists with `-e LIDO_ALLOWED_PUBLISHERS='[...]'`, `-e AAVE_ALLOWED_PUBLISHERS='[...]'`, `-e UNISWAP_ALLOWED_PUBLISHERS='[...]'`, and `-e COW_ALLOWED_PUBLISHERS='["notsoformal","Kowrigan","harisang","felixhenneke","KPK"]'` if they are not already provided by the deployment environment. All four forum adapters, including CoW, default to enabled; use the corresponding `*_ENABLED=false` setting only when intentionally pausing a source.

For `FIREBASE_PRIVATE_KEY`, pass escaped newlines, for example `-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n`. A deployment secret manager is preferable to pasting secrets into shell history.

Do not pass the local, human-readable `.env` directly to Docker when its JSON allowlists span multiple lines. Docker `--env-file` values must be one line each. If you choose that mechanism, use compact arrays such as `LIDO_ALLOWED_PUBLISHERS=["publisher one","publisher two"]`, without the surrounding shell quotes used in the `-e` command. The documented production command uses explicit runtime `-e` values instead.

Useful Docker commands:

```bash
docker ps -a
docker images
docker build -t governance-tracker-bot .
docker logs -f governance-tracker-bot
docker stop governance-tracker-bot
docker rm governance-tracker-bot
docker restart governance-tracker-bot
```

To replace a running container after rebuilding:

```bash
docker stop governance-tracker-bot
docker rm governance-tracker-bot
docker build --load -t governance-tracker-bot .
```

Restart with the full `docker run` command above and the same runtime variables.

Secrets are injected through environment variables and are not baked into the Docker image. Keep real credentials out of git and shell history, and rotate any credentials exposed during debugging.

Application error logs and persisted failure messages sanitize authenticated URLs, bearer credentials, bot-token patterns, and private-key blocks. Keep normal secret-handling controls in place regardless: redaction is defense in depth, not a reason to expose credentials.

The Docker image installs Firestore explicitly and omits Firebase Admin's unused optional services, including Cloud Storage. This keeps the production dependency set aligned with the platform's Firestore-only storage design.

After the first on-chain-enabled deploy, set `API=http://127.0.0.1:3001` on the Docker host. Trigger an authenticated `POST /api/admin/fetch-onchain/:protocol` for each enabled source (`uniswap` or `aave`) and monitor `docker logs -f governance-tracker-bot`. Completed 10,000-block ranges are persisted, so a later run resumes from the last safe cursor. Confirm `baselineStatus: "complete"` and `healthStatus: "healthy"` through `/api/admin/onchain-source-status`.

## Adding Another Protocol

Add a protocol adapter under `src/protocols/<protocol>/`, including a forum/source client, Zod schemas, normalizer, fixtures, and tests. Register the adapter in `src/protocols/registry.ts`. The shared fetch job, repositories, notification service, scheduler, and admin fetch endpoint are protocol-agnostic.

For another EVM governance source, implement `EvmGovernanceAdapter` under `src/onchain/<protocol>/` and register it in `src/onchain/registry.ts`. Reuse the generic range scanner, source cursor, decision/lifecycle repositories, delivery dispatcher, scheduler, admin status integration, and operational endpoints. Keep chain-specific ABI, address validation, native state mapping, deployment block, and public proposal URL inside the adapter.
