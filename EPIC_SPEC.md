# EPIC SPEC — Scaffold and the ranked target list

> This is EPIC 1 of "The naturalist's quest map." It stands up one web
> service and delivers the core query end to end: paste a public
> iNaturalist username, pick a place and a month, and see a ranked list of
> never-seen species. No persistence, no map, no auto-melt, no
> seasonality, no export, no guided walkthrough (those are EPICs 2–5).

## Quality differentiator (hold every choice to this)

**Effortless persistence: the only targets tool that maintains itself.**
Every competitor is a one-shot query the user re-runs and hand-prunes.

What it demands of THIS EPIC: this EPIC does not yet persist or self-melt,
but it lays the two foundations that make persistence possible later — a
**stable cache key** (`place / month / taxon_root / user`) that EPIC 2's
`query_cache` and saved quests reuse verbatim, and a **ranking core** that
lives in one module so EPIC 2 can re-run it on a saved quest without a
rewrite. Build the query so that "run it again tomorrow" is a cache read,
not a re-computation. Do not build persistence here; build so persistence
drops in without reshaping this code.

---

## 1. Scope

### In scope
- One web service: a backend API plus a static frontend, served from the
  same service (one container).
- Start screen: username field, place picker, month picker, one primary
  "Build my quest" action.
- Results screen: ranked, capped, paginated list of never-seen species,
  each with common name, photo, and a blended rank score, plus one honest
  line stating what the ranking means.
- A thin iNaturalist adapter wrapping every iNat call, with a ~1 req/s
  rate limiter and a server-side TTL cache.
- Designed empty, loading, and error states (including the unknown-username
  message).
- Error tracking wired from `SENTRY_DSN`; analytics wired from
  `UMAMI_WEBSITE_ID` / `UMAMI_URL`.
- `Dockerfile` + `docker-compose.staging.yml` that build and run with one
  command and honor the `SEED_DEMO` convention.
- Mobile-first at 390px; accessibility basics; the copy sweep.

### Out of scope (Non-Goals — do NOT build; each is a later EPIC)
- **Saved quests / any persistent database** (EPIC 2). The only server-side
  state this EPIC holds is an ephemeral cache.
- **Map** of targets (EPIC 2).
- **Auto-melt** / self-completing quests (EPIC 3).
- **Seasonality** / per-species histograms (EPIC 4).
- **Export** to CSV/GeoJSON (EPIC 4).
- **The guided walkthrough** — the multi-step highlighted onboarding path
  (EPIC 5). See §7 for what first-run clarity this EPIC DOES owe.
- Taxon-group selection UI ("plants only", "birds only"). The API accepts
  an optional `taxonRootId` so the cache key matches EPIC 2, but the EPIC 1
  UI does not expose a selector; it always queries all life.
- User accounts, auth, social, notifications, runtime LLM (product-wide
  fences).

---

## 2. First-run clarity vs. the guided walkthrough (read before building)

QUALITY BAR §4 requires a first-time user to understand the product and
reach the core action, and it requires "walking the first success." The
planner scheduled the multi-step **guided walkthrough** as its own EPIC
(EPIC 5) and fenced it out of this EPIC.

These do not conflict. Split them like this:

- **Build here (first-run clarity, required):** the start screen makes the
  core action obvious by looking, not reading (one primary action, a
  filled-in example placeholder, a real place suggestion). On staging with
  `SEED_DEMO` on, a brand-new visitor sees a *populated* ranked list within
  a minute with zero hand-crafted input (the pre-warmed demo quest). This
  is the bar's "the example must produce real output" requirement.
- **Do NOT build here (EPIC 5):** the multi-step highlighted overlay/tour
  anchored to controls, the skippable "walk the first success" path, the
  "one step points at how targets melt" step. Building it is drift into
  EPIC 5.

If, while building, first-run clarity appears to require the full guided
overlay to be usable, do not silently build it and do not silently skip it:
stop and report `outcome: "blocked"` with the specific conflict.

---

## 3. Technical design

### 3.1 Stack (chosen — do not re-litigate)
- **Runtime:** Node.js 20 LTS, TypeScript, ES modules.
- **Backend:** Fastify. Use `@fastify/rate-limit` (rate limiting),
  `@fastify/static` (serve the built frontend), `@fastify/compress`
  (gzip). Fastify JSON-schema validation guards every route's inputs.
- **Frontend:** React 18 + Vite + TypeScript, built to static assets and
  served by the backend from the same origin. Plain CSS (one stylesheet or
  CSS modules). No component/design-system library — three screens do not
  justify one, and adding one is gold-plating under SCOPE DISCIPLINE.
- **Cache:** an in-process TTL + LRU cache module behind a tiny interface
  (`get(key)`, `set(key, value, ttl)`). No Redis, no DB this EPIC. Keep the
  interface small so EPIC 2 can swap the backing store without touching
  call sites.
- **Error tracking:** `@sentry/node` on the backend, initialized only when
  `SENTRY_DSN` is set. Frontend Sentry is optional; if wired, use the same
  public DSN exposed via `/api/config`. No PII in any event (never attach
  the username to Sentry scope).
- **Analytics:** Umami. Inject the script into `index.html` at runtime only
  when `UMAMI_WEBSITE_ID` and `UMAMI_URL` are present (served via
  `/api/config`; the frontend adds the `<script>` tag client-side). No
  analytics call when unset.

### 3.2 Files / modules to touch (indicative layout)
```
/Dockerfile                     multi-stage: build frontend + backend, run node
/docker-compose.staging.yml     one service, env, SEED_DEMO, healthcheck
/.env.example                   placeholders only (no secrets)
/package.json                   workspaces or single package; scripts below
/server/
  index.ts                      Fastify bootstrap, static serving, Sentry init
  config.ts                     env parsing + defaults (typed)
  routes/
    health.ts                   GET /api/health
    config.ts                   GET /api/config
    users.ts                    GET /api/users/validate
    places.ts                   GET /api/places/autocomplete
    targets.ts                  POST /api/targets
  inat/
    client.ts                   the ONE adapter: every iNat call, rate limiter, cache
    ranking.ts                  blended rank_score (pure, unit-tested)
    types.ts
  cache.ts                      TTL+LRU cache module + key builder
  seed.ts                       SEED_DEMO cache pre-warm from bundled fixture
  fixtures/
    demo-species-counts.json    real captured iNat payload for the demo quest
    demo-observers.json         captured observer counts for the demo top-K
/web/
  index.html
  src/                          React app: Start screen, Results screen, states
  ...
/tests/                         see §6
```

### 3.3 The iNaturalist adapter (`inat/client.ts`) — the only place iNat is called
- Base URL from `INAT_API_BASE` (default `https://api.inaturalist.org/v1`).
- **Rate limiter:** a single global token bucket at `INAT_RATE_LIMIT_RPS`
  (default `1`) requests/second, shared across ALL iNat calls process-wide.
  Every adapter method acquires a token before its fetch. A polite
  `User-Agent` identifying the app and a contact is set on every request.
- **Cache:** every read-through method checks the cache first and stores on
  miss. Cache keys are built by `cache.ts` (§3.5).
- **Timeouts + retries:** per-call timeout (default 8s); one retry on a
  network error or iNat 5xx/429 with a short backoff; then surface a
  typed adapter error. Never throw a raw fetch error to a route.
- Methods this EPIC needs (and ONLY these):
  - `validateUser(login)` → `GET /users/autocomplete?q={login}` (or
    `/users/{login}`); returns `{id, login, name, iconUrl}` or `null` if no
    exact-login match. Cache TTL `USER_TTL` (default 1h).
  - `placesAutocomplete(q)` → `GET /places/autocomplete?q={q}`; returns up
    to ~10 `{id, name, displayName}`. Cache TTL `PLACE_TTL` (default 24h).
  - `speciesCounts({login, placeId, month, taxonRootId, perPage, page})` →
    `GET /observations/species_counts?unobserved_by_user_id={login}&place_id={placeId}&month={month}[&taxon_id={taxonRootId}]&per_page={perPage}&page={page}`.
    Returns `{totalResults, results:[{count, taxon}]}`. This is the one call
    that produces the frequency ranking. Cache TTL `TARGETS_TTL`
    (default 24h).
  - `distinctObservers({taxonId, placeId, month})` →
    `GET /observations/observers?taxon_id={taxonId}&place_id={placeId}&month={month}&per_page=0`;
    read `total_results` as the distinct-observer count. Cache TTL
    `TARGETS_TTL`. Used only for top-K enrichment (§3.4).

Verified against the live API (2026-09-09/2026-09-10):
`species_counts` returns `total_results` in the thousands with
`{count, taxon:{id, preferred_common_name, name, default_photo:{...}, ...}}`
per result. It does **not** carry a per-species observer count — that is
why `distinctObservers` is a separate call and why the blend is enriched
top-K only.

### 3.4 Ranking (`inat/ranking.ts`) — honest blend, feasible under the rate limit

The plan requires `rank_score` to blend observation frequency with the
count of **distinct observers**, so a species many different people find
outranks one a single power user photographed a hundred times. iNat gives
frequency (`count`) in one cheap call but exposes distinct observers only
per species. Fetching observers for all 10,000+ species under a 1 req/s
limit is infeasible, so:

1. **Frequency ranking (one call).** `speciesCounts(...)` returns species
   ranked by `count` desc. Take the top `MAX_TARGETS` (default 500). Never
   fetch or materialize the full 10k+ tail.
2. **Distinct-observer enrichment of the head only.** For the top
   `OBSERVER_ENRICH_TOP_K` targets (default 25) by frequency, call
   `distinctObservers(...)` through the rate-limited adapter and cache each.
   These are the targets that top the list and where observer softening
   actually changes the visible order.
3. **Blended score.** For enriched targets:
   `rankScore = w_f * norm(obsCount) + w_o * norm(distinctObservers)`,
   with `norm` a min-max (or log-then-min-max) over the enriched head and
   `w_f`, `w_o` defaulting to `0.6 / 0.4` (constants in `ranking.ts`, unit
   tested; not env-tunable — not a knob users need). Re-sort the enriched
   head by `rankScore` desc. Targets below the enriched head keep frequency
   order and carry `distinctObservers: null` and a `rankScore` derived from
   frequency alone.
4. **Determinism + degradation.** Ranking is a pure function of its inputs
   (unit-testable with fixtures). If a `distinctObservers` call fails or the
   per-request enrichment budget `REQUEST_ENRICH_BUDGET_MS` (default 30000)
   is exceeded, stop enriching, leave remaining head targets frequency-only
   (`distinctObservers: null`), and return a successful response. Never fail
   the whole query because enrichment was slow.

Cost of a **cold, novel** quest: 1 `species_counts` call + up to K
`observers` calls ≈ up to ~26s at 1 req/s. Every repeat view is a pure
cache hit (§3.5) and returns in well under a second. `SEED_DEMO` pre-warms
the demo quest's cache so staging is instant (§3.7). The frontend holds a
designed, determinate loading state over the cold build (§4, §5) — never a
dead spinner.

> Rationale for the top-K choice, so a reviewer does not read it as a
> shortcut: users act on the top handful ("the handful a morning walk could
> turn up"), so softening observer bias where it reorders the visible head
> delivers the plan's intent within the rate budget. `OBSERVER_ENRICH_TOP_K`
> is env-tunable if staging wants a larger head. Moving enrichment to a
> background refresh is EPIC 2+ work; do not build it here.

### 3.5 Cache keys (`cache.ts`) — the persistence-ready contract
- Target-list key: `targets:v1:{placeId}:{month}:{taxonRootId|all}:{login}`.
  This mirrors the plan's `query_cache` key `(place_id, month,
  taxon_root_id, inat_user_id)` so EPIC 2 reuses it. (EPIC 1 keys on
  `login`; EPIC 2 may key on iNat user id. Keep the key builder in one
  function so that swap is one edit.)
- Observer key: `obs:v1:{taxonId}:{placeId}:{month}`.
- User key: `user:v1:{login}`. Place key: `place:v1:{q}`.
- The cached value for a target list is the fully blended, capped result
  set (all pages), so pagination is served from one cache entry and repeat
  views never re-hit iNat. Bound total cache entries (`CACHE_MAX_ENTRIES`,
  default 500) with LRU eviction; each entry carries its TTL.

### 3.6 API contracts
All responses JSON. All inputs validated at the boundary (Fastify schema);
invalid input returns `400 {error, message}` with a positive, actionable
`message`. Errors never leak stack traces or raw upstream bodies.

- `GET /api/health` → `200 {status:"ok"}`. Used by the compose healthcheck.
- `GET /api/config` → `200 {umamiWebsiteId?, umamiUrl?, sentryDsn?, demo?}`
  where `demo` is `{login, placeId, placeName, month}` only when
  `SEED_DEMO` is on. Contains no secrets (Umami id and frontend Sentry DSN
  are public by design). No `INTERNAL_SERVICE_KEY`, DB creds, etc.
- `GET /api/users/validate?login=` →
  `200 {id, login, name, iconUrl}` on an exact-login match, else
  `404 {error:"unknown_user", message:"Check the username and try again."}`.
- `GET /api/places/autocomplete?q=` (min length 2) →
  `200 {results:[{id, name, displayName}]}` (max ~10). Empty query or `<2`
  chars → `200 {results:[]}` (no upstream call).
- `POST /api/targets` — the core query. Body:
  `{login, placeId:int>0, month:int 1..12, taxonRootId?:int>0, page?:int>=1, perPage?:int 1..50}`.
  Flow: validate input → `validateUser(login)`; if unknown →
  `404 {error:"unknown_user", message:"Check the username and try again."}`
  → build/return the blended list from cache. Response:
  ```
  200 {
    page, perPage,
    totalTargets,          // capped count (<= MAX_TARGETS), NOT iNat's 10k+
    totalAvailable,        // iNat total_results, for the "showing N of many" line
    rankBasis: "frequency+observers",
    note: "<the ranking note string, §7.3>",
    results: [{ taxonId, scientificName, commonName, photoUrl,
                obsCount, distinctObservers /* int|null */, rankScore }]
  }
  ```
  Valid user with zero unseen species → `200` with `results: []` and
  `totalTargets: 0` (frontend shows the designed empty state). iNat
  unreachable after retry → `502 {error:"upstream", message:"iNaturalist is
  slow right now. Try again in a moment."}`.

### 3.7 SEED_DEMO (staging first-run, load-bearing)
- When `SEED_DEMO` is truthy, on startup `seed.ts` pre-warms the cache for
  one known-good demo quest (`SEED_DEMO_LOGIN`, `SEED_DEMO_PLACE_ID`,
  `SEED_DEMO_PLACE_NAME`, `SEED_DEMO_MONTH`) from **bundled fixtures**
  (`fixtures/demo-species-counts.json`, `fixtures/demo-observers.json`) —
  real captured public iNat payloads, committed to the repo. Pre-warming
  from a fixture (not a live call) guarantees the demo shows a populated,
  non-empty list within a minute even if iNat is slow or down, satisfying
  the bar's "a sample that yields zero results demonstrates nothing."
- `/api/config` returns the `demo` descriptor; the frontend, on first load
  with no prior input, pre-fills the demo quest and shows its populated
  results immediately (the visitor may then change username/place/month).
- The fixture holds only public iNat data (a public username plus public
  species/observer counts). No private data, no secret, no PII beyond the
  public username. Document the fixture's provenance in a code comment.

### 3.8 Data model / migrations
No persistent schema this EPIC. The only state is the in-memory cache,
which is ephemeral and rebuildable. There are therefore **no forward-only
migrations** in EPIC 1. The cache key shape in §3.5 is deliberately
schema-compatible with EPIC 2's `query_cache` so the migration EPIC 2
writes is additive.

---

## 4. Ordered task list (each with acceptance criteria)

Order is dependency order; each task is done only when its criteria AND the
QUALITY BAR clauses it touches pass.

### T1 — Project scaffold, health, config, static serving
Set up the Node/TS/Fastify backend and Vite/React frontend, single-origin
serving, `GET /api/health`, `GET /api/config`, and env parsing (`config.ts`
with typed defaults). Wire Sentry (backend) and the Umami injection path,
both no-ops when their env is unset.
- **AC1.1** `GET /api/health` returns `200 {status:"ok"}`.
- **AC1.2** With `SENTRY_DSN` unset the app boots and serves with no Sentry
  errors; with it set, backend Sentry initializes (verified by a test that
  asserts init is called, not by hitting the network).
- **AC1.3** `GET /api/config` returns Umami fields only when the env is set,
  and never returns any secret.

### T2 — iNaturalist adapter: rate limiter + cache + user/place calls
Build `inat/client.ts` with the global 1 req/s token bucket, timeouts, one
retry, the typed error, and `validateUser` + `placesAutocomplete`, each
read-through cached. Build `cache.ts` (TTL+LRU + key builder).
- **AC2.1** A unit test proves N concurrent adapter calls are serialized to
  ~`INAT_RATE_LIMIT_RPS`/second by the token bucket.
- **AC2.2** A second identical `validateUser` / `placesAutocomplete` call
  within TTL is served from cache and makes no second upstream request
  (asserted against a mocked fetch).
- **AC2.3** An upstream 5xx/network error surfaces as the typed adapter
  error after one retry, never as a raw fetch throw.
- **AC2.4** `GET /api/users/validate` returns the profile for a known public
  login and `404 {error:"unknown_user", ...}` for a nonexistent one.
- **AC2.5** `GET /api/places/autocomplete?q=` returns capped results and
  makes no upstream call for queries under 2 chars.

### T3 — species_counts + blended ranking + the targets endpoint
Add `speciesCounts` and `distinctObservers` to the adapter and
`inat/ranking.ts` (pure blend). Implement `POST /api/targets`: validate,
validate-user, frequency-rank, cap to `MAX_TARGETS`, enrich top-K, blend,
cache the full result, paginate from cache.
- **AC3.1** A valid `{login, placeId, month}` returns a ranked list with
  `taxonId, commonName, photoUrl, obsCount, rankScore` per item.
- **AC3.2** The blend is correct and deterministic: a fixture where a
  low-observer, high-count species and a high-observer, lower-count species
  compete produces the documented order (unit test on `ranking.ts`).
- **AC3.3** The list is capped at `MAX_TARGETS` and paginated at `perPage`;
  a mocked `species_counts` returning `total_results` of 12,000 yields a
  response whose `results` length ≤ `perPage` and `totalTargets` ≤
  `MAX_TARGETS`, and the endpoint does not fetch or materialize all 12,000.
- **AC3.4** Repeat `POST /api/targets` with the same body (and paging
  through pages) hits iNat's `species_counts` **once**; further views are
  pure cache reads (asserted against mocked fetch call counts).
- **AC3.5** If `distinctObservers` enrichment errors or exceeds
  `REQUEST_ENRICH_BUDGET_MS`, the endpoint still returns `200` with head
  targets frequency-ranked and `distinctObservers: null` where unfetched.
- **AC3.6** An unknown username returns `404 {error:"unknown_user",
  message:"Check the username and try again."}`; no stack trace in the body.

### T4 — Start screen (username, place picker, month, primary action)
Mobile-first Start screen: labeled username input (example placeholder),
place picker backed by `/api/places/autocomplete`, month picker, one
primary "Build my quest" button. Inline boundary validation with positive
messages.
- **AC4.1** At 390px there is no horizontal scroll; the primary action and
  all inputs are reachable; touch targets are ~44px.
- **AC4.2** Submitting with a missing/invalid field shows an inline positive
  message ("Enter a valid iNaturalist username.", "Pick a place.", "Pick a
  month.") and does not call the API.
- **AC4.3** The screen has exactly one visually-primary action; any
  secondary control is visibly subordinate.
- **AC4.4** Inputs are labeled, keyboard-reachable, and show a visible focus
  state.

### T5 — Results screen, designed states, pagination, ranking note
Render the ranked list (photo with `commonName` alt text, common name,
score/observer signal) with skeletons on load, a determinate loading state
over cold builds (with a back/cancel affordance), the unknown-username and
upstream error states, the empty state, pagination controls, and the
one-line ranking note.
- **AC5.1** First meaningful render (app shell + start screen; on submit,
  the skeleton results layout) appears within ~1s on an ordinary
  connection; skeletons hold the layout while the list loads. A warm
  (cached) `POST /api/targets` returns in well under 1s.
- **AC5.2** Each result shows common name, photo (with meaningful alt text),
  and the blended score/observer signal.
- **AC5.3** Pagination works from the capped set; paging does not re-hit
  iNat (served from the cached result).
- **AC5.4** Unknown username shows "Check the username and try again." with
  no raw stack trace; iNat-down shows "iNaturalist is slow right now. Try
  again in a moment." with a retry; a valid-user-zero-targets shows the
  designed empty state (§7.3 copy).
- **AC5.5** The ranking note (§7.3) is visible on the results screen.
- **AC5.6** Results screen is fully usable at 390px: no horizontal scroll,
  ~44px targets, readable without zoom.

### T6 — Sentry + Umami wired from env; `.env.example`
Confirm error tracking captures a thrown backend error when `SENTRY_DSN` is
set (no username/PII on the event), Umami loads only when configured, and
`.env.example` lists every variable with placeholder values only.
- **AC6.1** With `SENTRY_DSN` set, an unhandled route error is reported to
  Sentry with no username or other PII attached; with it unset, nothing is
  sent and the app still returns the designed error state.
- **AC6.2** With `UMAMI_WEBSITE_ID` + `UMAMI_URL` set, the analytics script
  is injected; with them unset, no analytics request is made.
- **AC6.3** `.env.example` contains placeholders only; no real secret is in
  any tracked file.

### T7 — Dockerfile + docker-compose.staging.yml + SEED_DEMO
Multi-stage `Dockerfile` (build frontend + backend, run node), one-command
`docker-compose.staging.yml` with env, a healthcheck on `/api/health`, and
the `SEED_DEMO` pre-warm from bundled fixtures.
- **AC7.1** `docker compose -f docker-compose.staging.yml up --build` brings
  the app up with one command and the healthcheck passes.
- **AC7.2** With `SEED_DEMO` on, a fresh visitor with zero input sees a
  populated, non-empty ranked list within a minute (served from the
  pre-warmed fixture cache), demonstrating the differentiator without
  hand-crafted input.
- **AC7.3** No secret is baked into the image or compose file; secrets come
  from env, and `.env.example` documents them with placeholders.

### T8 — Copy sweep + accessibility + mobile pass (bar, not a feature)
Mechanically sweep every user-visible string; verify accessibility basics
and the 390px pass across both screens. (This is finishing T1–T7 to the
bar, not new scope.)
- **AC8.1** No user-visible string contains "—" or "–", any banned LLM
  vocabulary, or negative empty-state phrasing ("You don't have", "No … yet",
  "Nothing … here", "Unable to", "Something went wrong"). See §7.
- **AC8.2** Contrast, visible focus, labeled inputs, semantic headings and
  landmarks, alt text on species photos, and full keyboard reach verified.
- **AC8.3** Both screens pass at 390px: no horizontal scroll, ~44px targets.

---

## 5. Designed states (exact behavior)
- **Loading:** on submit, render skeleton result cards that hold the final
  layout immediately (no white screen, no layout shift). For a cold build
  that runs longer than ~1.5s, show a determinate, honest status ("Checking
  iNaturalist for your targets") plus a Back control so the user is never
  trapped in a dead spinner.
- **Empty (valid user, zero targets):** the §7.3 empty copy plus the primary
  action to try another place or month.
- **Error (unknown user):** "Check the username and try again.", focus
  returned to the username field.
- **Error (iNat unreachable):** "iNaturalist is slow right now. Try again in
  a moment." with a retry button.
- **First screen (first-run clarity):** self-explanatory by looking —
  example placeholder in the username field, one primary action. On staging
  with `SEED_DEMO`, the demo quest's populated results are shown on first
  load (no guided overlay; that is EPIC 5).

---

## 6. Test plan (which automated test proves each criterion)

Frameworks: **Vitest** (unit + Fastify `inject` integration, iNat mocked),
**Playwright** (E2E/UI/mobile with iNat mocked at the network boundary).
No test hits the live iNaturalist API.

- **Adapter unit (Vitest):** token-bucket serialization → AC2.1;
  cache hit avoids second fetch → AC2.2, AC3.4; retry + typed error →
  AC2.3; cap does not materialize the full tail → AC3.3.
- **Ranking unit (Vitest):** deterministic blend order from a fixture →
  AC3.2; degradation to frequency-only when observers unavailable → AC3.5.
- **API integration (Vitest + `inject`, mocked fetch):**
  `/api/health` → AC1.1; `/api/config` gating → AC1.3, AC6.2;
  `/api/users/validate` known/unknown → AC2.4, AC3.6;
  `/api/places/autocomplete` cap + min-length → AC2.5;
  `/api/targets` shape, cap, pagination, cache-once, unknown-user 404 →
  AC3.1, AC3.3, AC3.4, AC3.6; Sentry init gating + no-PII scope → AC1.2,
  AC6.1.
- **E2E / UI (Playwright, mocked iNat):**
  first-render + skeletons + warm-return speed → AC5.1; result content and
  alt text → AC5.2; pagination without re-hit → AC5.3; all four states →
  AC5.4; ranking note visible → AC5.5; start-screen validation and single
  primary action → AC4.2, AC4.3; 390px no-horizontal-scroll + ~44px targets
  on both screens → AC4.1, AC5.6, AC8.3; labels/focus/keyboard/semantics/alt
  → AC4.4, AC8.2.
- **Copy sweep (Vitest or a lint script over the built strings/locale):**
  fails on "—"/"–", banned vocabulary, or negative empty-state phrasing in
  any user-visible string → AC8.1.
- **Container smoke (script, run in the foreground to completion):**
  `docker compose -f docker-compose.staging.yml up --build -d`, poll
  `/api/health` until healthy, with `SEED_DEMO=1` assert the served page
  shows a non-empty list, then `down` → AC7.1, AC7.2, AC7.3.

All suites must run and pass in the foreground before `result.json` is
written. Do not leave any suite running in the background.

---

## 7. Copy (write these verbatim; sweep before shipping)

### 7.1 Rule reminder
No "—" or "–". No banned LLM vocabulary ("seamlessly", "effortlessly",
"unlock", "elevate", "empower", "leverage", "robust", "dive in", etc.). No
negative empty states. Short, plain, one idea per sentence. Sweep every
user-visible string mechanically, not by feel.

### 7.2 Screen copy
- Product/heading (Start): **Map what you've never seen**
- Start subline (one line): **Paste your iNaturalist name, pick a place and
  a month, and see what to hunt for.**
- Username field label: **iNaturalist username**; placeholder: **e.g.
  kueda**
- Place field label: **Place**; Month field label: **Month**
- Primary action: **Build my quest**
- Validation inline: **Enter a valid iNaturalist username.** / **Pick a
  place.** / **Pick a month.**

### 7.3 States and the ranking note
- Ranking note (required by criterion): **Ranked by how often people record
  each species here this month, and by how many different people find it.
  It's a guide, not a guarantee.**
- Loading status (cold build): **Checking iNaturalist for your targets.**
- Unknown username: **Check the username and try again.**
- iNat unreachable: **iNaturalist is slow right now. Try again in a
  moment.**
- Empty (valid user, zero targets): **You've already recorded every species
  reported here this month.** with action **Try another place or month.**

> These example strings are shipped verbatim downstream, so they are swept
> here: none contain "—"/"–", banned vocabulary, or negative empty-state
> phrasing. Any NEW string the implementer adds must be swept the same way.

---

## 8. Environment variables (`.env.example` = placeholders only)
```
PORT=8080
INAT_API_BASE=https://api.inaturalist.org/v1
INAT_RATE_LIMIT_RPS=1
INAT_USER_AGENT=naturalist-quest-map (contact: you@example.com)
USER_TTL_SECONDS=3600
PLACE_TTL_SECONDS=86400
TARGETS_TTL_SECONDS=86400
MAX_TARGETS=500
PAGE_SIZE=20
OBSERVER_ENRICH_TOP_K=25
REQUEST_ENRICH_BUDGET_MS=30000
CACHE_MAX_ENTRIES=500
RATE_LIMIT_MAX=60
RATE_LIMIT_WINDOW=1 minute
TARGETS_RATE_LIMIT_MAX=20
SENTRY_DSN=
UMAMI_WEBSITE_ID=
UMAMI_URL=
SEED_DEMO=0
SEED_DEMO_LOGIN=kueda
SEED_DEMO_PLACE_ID=14
SEED_DEMO_PLACE_NAME=California
SEED_DEMO_MONTH=9
```
No secret is ever committed. `.env` stays untracked.

---

## 9. Security hygiene (this EPIC's surface)
- The app has no accounts and serves only public iNat data; there is no
  private resource to authorize. State this in the README so the absence of
  auth is not misread as a gap. Every route is still input-validated.
- Validate every input at the boundary (login charset/length, `placeId`
  positive int, `month` 1..12, pagination bounds, autocomplete min length).
- Rate limit all routes with `@fastify/rate-limit`; apply a tighter limit
  to `POST /api/targets` (`TARGETS_RATE_LIMIT_MAX`), the expensive route.
- Secrets via env only; `.env.example` placeholders only; nothing secret in
  the image, compose file, or client bundle.
- No PII in logs and none on Sentry events (never attach the username).
- No unindexed hot-path work: no DB this EPIC, and the target list is capped
  and paginated so the endpoint never scales with iNat's 10k+ tail.

---

## 10. Definition of done
- Every AC in §4 passes; every QUALITY BAR clause the work touches is met.
- All test suites in §6 run and pass in the foreground.
- `docker compose -f docker-compose.staging.yml up --build` runs the app
  with one command; `SEED_DEMO` shows a populated list within a minute.
- The copy sweep is clean. Mobile 390px and accessibility basics verified.
- No Non-Goal from §1 was built. No persistence, map, melt, seasonality,
  export, taxon selector, or guided walkthrough was added.
