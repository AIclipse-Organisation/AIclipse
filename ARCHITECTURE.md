# System Architecture Mantra

This file is the operational contract for AIclipse.
This file holds the **system** (who owns what, who calls what, what must
never change). A change that violates an invariant here is a bug, not a
feature. Before merging, re-read the relevant section.

---

## 1. The nine services

| Service | Stack | Role |
|---|---|---|
| `auth` | FastAPI + Mongo | Issues JWTs, owns user identity, API keys, admin actions, plan flag, stats, activity log |
| `gateway` | FastAPI | **Trust boundary.** Authenticates, proxies to backends, enforces quotas, forwards `X-User-*` headers |
| `client` | Flask | Browser BFF: landing, detection, library, plan, community UI proxy |
| `community` | Next.js (basePath `/community`) | Browser BFF + internal API + adminBFF for posts/votes/comments/moderation/notifications |
| `billing` | FastAPI + Mongo + Stripe | Checkout sessions, webhook processing, subscription state |
| `media` | FastAPI + Mongo + MinIO/S3 | Image metadata + presigned URL generation |
| `detector` | FastAPI + ViT model | AI inference, model hot-reload, concurrency-bounded |
| `model-cycle` | ASP.NET + SQLite + MinIO | Training jobs, model lifecycle, confidence scoring via Bayesian vote aggregation |
| `email-worker` | FastAPI + Redis Streams + Gmail | Email dispatch consumer with DLQ |

---

## 2. Auth models — four, never mix

| Model | Where | Header/cookie | Who mints | Who validates |
|---|---|---|---|---|
| **cookieAuth** | `client`, `community` (BFF surfaces) | `access_token` cookie | `auth` at login | BFF calls gateway `/auth/me` to resolve |
| **bearerAuth** | `gateway` (external user API) | `Authorization: Bearer <JWT>` | `auth` | `gateway` via JWKS |
| **apiKeyAuth** | `gateway` (programmatic user API) | `X-Api-Key` | `auth` API-key rotation | `gateway` → `auth` key lookup |
| **internalTokenAuth** | backend↔backend | `X-Internal-Token` | Shared secret | Each service checks the env-configured token |
| **stripe-signature** | `billing` webhook | `stripe-signature` | Stripe | `billing` verifies BEFORE parsing body |

**Rules:**
- BFFs (`client`, `community`) consume the access_token cookie. They **never** mint JWTs.
- Backend services (`media`, `detector`, `billing`, `model-cycle`, `community` internal, `email-worker`) trust forwarded identity from `gateway` via `X-User-Id`, `X-User-Name`, `X-User-Is-Admin` headers. They **never** re-authenticate.
- `gateway` is the only place that validates user JWTs and API keys. Any additional external auth path is an architectural bug.
- `X-Internal-Token` + `X-User-*` is the single canonical path for gateway→backend. Backends do not accept external Bearer tokens.

---

## 3. Trust boundaries

```
  browser
   │  access_token cookie
   ▼
 ┌─────────────┐  ┌─────────────┐
 │   client    │  │  community  │     (BFF layer — cookie in, Bearer out)
 │   (Flask)   │  │  (Next.js)  │
 └─────┬───────┘  └─────┬───────┘
       │ Bearer(JWT)    │ Bearer(JWT) OR X-Internal-Token
       ▼                ▼
 ┌───────────────────────────┐
 │        gateway            │  ◄── TRUST BOUNDARY
 │  (bearer/api-key → X-*)   │
 └─────┬───────────┬─────────┘
       │ X-Internal-Token + X-User-*
       ▼           ▼
 ┌────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐  ┌───────────┐
 │  auth  │  │  media   │  │ detector │  │ billing │  │ community │
 │        │  │          │  │          │  │         │  │ internal  │
 └────────┘  └──────────┘  └──────────┘  └─────────┘  └───────────┘
                                             ▲
                                    stripe-signature
                                             │
                                          Stripe
```

`model-cycle` and `email-worker` sit off this plane:
- `model-cycle` ← HTTP from `gateway` admin proxy; posts hot-reload to `detector`.
- `email-worker` ← Redis stream `auth-events`; publishes to `auth-events-dlq`.

---

## 4. Data ownership (no shared databases)

| Service | Store | Owns |
|---|---|---|
| `auth` | Mongo `auth.*` | users, api_keys, sessions, plan_audit, user_activity, access_requests, user_deletion_logs |
| `billing` | Mongo `billing.*` | billing_audit, stripe_events, customers, subscriptions |
| `media` | Mongo `media.images` + MinIO `images/` bucket | image metadata + binary objects |
| `community` | Mongo `community.*` | posts, comments, votes, clicks, reports, notifications |
| `model-cycle` | SQLite + MinIO `models/` bucket | ModelWeights, TrainingImages, ModelImageLinks |
| `detector` | in-memory model | no persistence |
| `email-worker` | Redis (shared) | consumer offsets, dedupe keys, DLQ stream |

**Invariants:**
- No service reads another service's collection directly. Cross-service data goes over HTTP.
- User stats/activity are written by **`auth` internal endpoints only**; `community` and others `POST /internal/user/{user_id}/stats` to update.
- Image visibility changes are owned by `media`; `community` calls gateway, which calls `media` PATCH to sync public/private when posting/moderating.

---

## 5. Canonical flows

### 5.1 Login
1. Browser → `client` `POST /auth/login` (JSON email/password).
2. `client` → `gateway` `POST /auth/login` (no auth).
3. `gateway` → `auth` internal login, receives JWT.
4. `client` sets `access_token` cookie (HttpOnly) on response, stores user in server session.
5. Subsequent browser requests carry cookie → `client` extracts → forwards as Bearer to `gateway`.

### 5.2 Detection → publish
1. Browser → `client` `POST /checks` (multipart image).
2. `client` → `gateway` `POST /checks` → `detector` `POST /v1.0.1/checks` (X-Request-Id required).
3. `detector` returns verdict/label/confidence. `gateway` mints a **detection_token** (JWT bound to image hash + user).
4. Browser calls `client` `POST /upload/image` with detection_token + file.
5. `client` → `gateway` `POST /upload/image` → `media` `POST /upload/image` (gateway validates detection_token, forwards identity).
6. `media` writes S3 object, then Mongo record. If Mongo fails, S3 object is rolled back.
7. Browser optionally calls `client` `POST /results/save` (with is_public + description). On publish, `client` resolves viewer and proxies; `community` creates a post via `/community/internal/posts` which syncs `media` visibility through gateway.

### 5.3 Community post flow
- Browser → `community` `/community/posts` (same-origin cookie) OR `client` → `gateway` `/community/posts` (external Bearer) → `community` `/community/internal/posts`.
- Vote/click writes enqueue Redis deltas (5s/30s/60s debounce) before persisting to Mongo; reads merge Mongo + Redis pending deltas.
- Notification writes use **collapsed upsert**: one document per (recipient, actor, post, type) tuple, `event_count` increments on repeat events.

### 5.4 Stripe checkout
1. Browser → `client` `POST /billing/create-checkout-session` with `plan_id`.
2. `client` resolves user via gateway, forwards to `gateway` `POST /billing/create-checkout-session` → `billing`.
3. `billing` creates Stripe checkout session, returns `checkout_url`.
4. Stripe posts back to `billing` `/webhook` with `stripe-signature` → `billing` verifies signature **before parsing**, then processes event.
5. Webhook handler: unique-sparse index on `stripe_event_id` makes retries idempotent (DuplicateKeyError = already processed).
6. On `checkout.session.completed`: `billing` calls `auth` `/internal/user/{id}/plan` to set the plan flag.

### 5.5 Model training
1. Admin triggers via `community` adminBFF `/community/adminBFF/models/train` → gateway `/admin/models/train` → `model-cycle` `POST /api/models/train` (enqueues one job).
2. Worker picks balanced Ready images, runs Python training, evaluates on validation + golden set.
3. If improved, `model-cycle` uploads weights to MinIO, updates SQLite, deactivates prior version, posts to `detector` `POST /internal/reload-model` for hot-swap.
4. Vote-driven retraining: `community` votes → `model-cycle` `POST /api/imageconfidence/evaluate` (Bayesian Beta aggregation) → images flip to Ready when confident.

---

## 6. Allowed inter-service calls (anything else is suspect)

| From → To | Purpose |
|---|---|
| `client` → `gateway` | all backend data (detection, library, billing, community, auth) |
| `community` → `gateway` | `/auth/me` lookup, adminBFF proxies, media visibility sync |
| `gateway` → `auth` | validate JWT, API-key lookup, internal user endpoints |
| `gateway` → `media` | image ops with `X-User-*` |
| `gateway` → `detector` | `/v1.0.1/checks` |
| `gateway` → `billing` | checkout, status, cancel |
| `gateway` → `community` | `/community/internal/*` (X-Internal-Token + X-User-*) |
| `gateway` → `model-cycle` | `/api/models/*`, `/images` |
| `billing` → `auth` | `/internal/user/{id}/plan` on webhook success |
| `community` → `auth` | `/internal/user/{id}/stats`, `/internal/user/{id}/activity` |
| `model-cycle` → `detector` | `/internal/reload-model` on deploy |
| `model-cycle` → `auth` | user accuracy lookup for vote weighting |
| `auth` → Redis `auth-events` | publish user lifecycle events |
| `email-worker` ← Redis `auth-events` | consume and send email |
| `billing` ← Stripe webhook | signed event delivery |

**If you need a call not in this table, the boundary may be in the wrong place.**

---

## 7. Invariants (never break these)

1. **One identity per request path.** Each route has one auth scheme. No route accepts both Bearer and cookie on the same backend surface.
2. **Gateway is the only JWT validator.** Backends trust `X-User-*`; they do not re-validate tokens.
3. **Webhook signature before body parse.** `billing` verifies `stripe-signature` on raw bytes; parsing before verification is a vulnerability.
4. **Detection token required for upload.** `/upload/image` and `/results/save` must carry the token minted by `/checks`. No bypass.
5. **Image bytes never transit app servers on read.** Media returns presigned S3 URLs (public=1h, private=5min TTL). Never proxy image bytes.
6. **Idempotent webhook processing.** Stripe event dedup by `stripe_event_id` unique-sparse index. Retries land on DuplicateKeyError and continue.
7. **One source of truth per domain fact.** User plan = `auth.users.plan`; posts = `community.posts`; images = `media.images`. Read from the owner, do not cache cross-service.
8. **Indexed queries only.** Every Mongo/SQLite query filters on an indexed field.
9. **No N+1.** List endpoints batch user/actor lookups (see `notificationsRoute.js` actorMap pattern).
10. **Concurrency bounds on detector.** `/v1.0.1/checks` has max-inflight + max-concurrent-inference slots. 503 at capacity, 504 on inference timeout — do not remove these.
11. **Redis-only async, HTTP only sync.** Email send is a Redis stream consumer; detection is synchronous HTTP.
12. **S3 rollback on Mongo insert failure.** Any S3 write followed by a DB write must roll back the object if the DB step fails.
13. **User-supplied values are sanitized in logs.** Strip `\r\n` before logging any input that could come from a user (see `media/main-media.py:sanitize_for_log`).
14. **Notification collapsing.** One notification per (recipient, actor, post, type) tuple; `event_count` increments. Never re-insert duplicates.

---

## 8. Forbidden patterns

- **Backend service reading user JWT.** Backends read `X-User-Id`, not `Authorization`.
- **Fallback auth paths.** No "try cookie, else Bearer" on the same route. One path per route.
- **Direct cross-service DB reads.** Never have service A connect to service B's Mongo/SQLite.
- **Image proxying.** Never read an S3 object and stream it through a FastAPI/Flask handler. Return a presigned URL.
- **Unindexed list endpoints.** Never add a list endpoint without a bounded, indexed filter.
- **Secret in error response.** Never return an env var, stack trace, or token in an HTTP error body.
- **Mock databases in integration tests.** Use a real DB — mocks hide schema/migration drift.
- **Parsing Stripe webhook body before signature check.**
- **Amending published commits** or force-pushing to `main`.
- **Adding a feature flag** where a single-path redesign would work.
- **Temporal decomposition.** Do not split modules by "step 1, step 2, step 3" — split by information hiding.
- **Calling `client` or `community` public BFF from another backend service.** They exist for browsers, not for service-to-service traffic.
- **Creating a new module that just forwards to another module without hiding complexity.** Shallow modules are worse than no abstraction.

---

## 9. Performance contracts

- **Initial HTML ≤ 14 KB** (first TCP congestion window).
- **No blocking `<script>` in `<head>`.** Defer or async.
- **Static assets content-hashed, cached indefinitely.** HTML has short TTL.
- **Detector concurrency:** inflight semaphore + inference semaphore. 503 = shed load; 504 = timeout; do not silently retry.
- **Presigned URL TTLs:** public = 3600s, private = 300s.
- **Max upload sizes:** images = 20 MB, model weights = 750 MB.
- **Redis debounce:** votes 5s (60s max wait), clicks 60s cooldown, comments 30s (60s max wait).
- **Notification cap:** 50 per user, enforced after each write.
- **Comment list limit:** 100 newest per post.
- **Training image list limit:** 200 newest.
- **Partial UI updates.** Use fetch + DOM patch, not full-page reloads for dynamic data.

---

## 10. Security contracts

- **CSP, X-Content-Type-Options, X-Frame-Options** set at every HTML/BFF origin. See `media/main-media.py` middleware as reference.
- **access_token cookie** is HttpOnly, SameSite set for cross-origin BFF↔gateway flow.
- **detection_token** is short-lived and bound to user+image hash; reuse or replay fails closed.
- **Log injection prevention:** sanitize `\r\n` from all user-controlled log values.
- **Webhook secret:** `STRIPE_WEBHOOK_SECRET` must be set; 500 if missing rather than accepting unsigned events.
- **Admin routes:** every admin endpoint checks `is_admin=true` on the resolved user. Non-admin gets 403 (or redirect on HTML).
- **Rate limiting:** quota enforced at gateway on `/checks` per plan tier. Never on the backend — gateway is the boundary.
- **Secrets never in code, logs, or error bodies.** Config via env only.
- **SQL/NoSQL injection:** all Mongo queries use driver parameter binding, not string concatenation.
- **Input validation at boundaries only.** Inside trust boundary, trust forwarded identity; do not re-validate the same thing twice.

---

## 11. Redis stream topology

| Stream | Producer | Consumer group | Purpose |
|---|---|---|---|
| `auth-events` | `auth` | `email-workers` | email.send requests on signup, password reset, access approval |
| `auth-events-dlq` | `email-worker` | (manual replay via HTTP) | failed deliveries after `MAX_RETRIES=3` |

**Dedupe:** per-event Redis key with TTL=86400s prevents reprocessing.
**Send lock:** per-event TTL=300s prevents concurrent delivery by multiple workers.
**Replay:** `POST /internal/dlq/replay` pushes DLQ entries back to `auth-events`; `delete_after_replay=true` by default.

---

## 12. Before merging: the four questions

1. **Does this change affect an auth boundary?** Re-read §2 and §3. If yes, exactly one auth model must be introduced at exactly one surface.
2. **Does this add a cross-service call?** Check §6. If the call is not in the table, justify the boundary change in the PR or redesign.
3. **Does this add complexity (new module, new fallback, new env flag)?** Ask if the system could achieve the same result with less code. Three lines reusing existing abstractions beat ten new lines.
4. **Does this break an invariant in §7 or §8?** If yes, the change is incorrect even if tests pass.

If all four answers are "no risk", proceed. Otherwise, update this file in the same PR — the architecture changed, not just the code.

---

## 13. When this file goes stale

This is a living document. If you find a service that is no longer accurate:

- Do not patch this file alone — fix the code to match the contract, OR update the contract if the code is right and the contract was aspirational.
- Every contract change requires a PR description explaining *which invariant changed* and *why the old one was wrong*.
- Swagger specs in `swagger-docs/` are the per-service contract. This file is the cross-service contract. Both must stay in sync.
