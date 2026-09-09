# PRODUCT PLAN — The naturalist's quest map

## Core value (one sentence)

Paste a public iNaturalist username, pick a place and season, and get a
living map of the species you have never seen ranked by how often others
find them there that month, where each target quietly disappears once
your own photo is community-confirmed.

## North star

A returning naturalist opens the app the night before a trip and it
already holds every quest they have ever run. They pick where they are
going, and in seconds they see the handful of never-seen species that a
single morning walk could actually turn up this month, drawn on a map of
where to point their feet. In the field they photograph three of them.
Days later they open the app and those three have already checked
themselves off, each one showing the exact photo that completed it. The
excellent version of this product is the record a life-lister trusts more
than their own memory: it remembers what they are missing, it never asks
them to prune a list by hand again, and over years it becomes the trip
journal that made them see more wild life than they otherwise would have.

## Quality differentiator

**Effortless persistence: the only targets tool that maintains itself.**
Every alternative today is a one-shot query the user has to re-run and
hand-prune (forum users literally deleted found species from a bookmarked
list every evening). This product's one committed dimension is that the
quest is alive and self-maintaining: it re-ranks as the season turns and
completes itself from the user's own confirmed uploads, so the naturalist
never edits the list by hand. Not fastest, not flashiest. The one that
keeps itself current while they sleep.

## Signature moment (what a user tells a friend)

A species vanishes from your map because strangers on the internet
confirmed the photo you took. You did nothing to the list. It pruned
itself. This mechanic ships in v1 (EPIC 3) or the product is just another
list.

---

## Users and stories (MVP only)

The user is an iNaturalist life-lister: someone who photographs wild
plants, insects, fungi, and animals and keeps a running list of every
species they have recorded.

- As a naturalist planning a trip, I paste my public username, pick a
  place and a month, and see a ranked, mapped list of species I have
  never seen that others find there then, so I know what to hunt.
- As a returning user, I open a quest I saved earlier and it re-ranks for
  where the season is now, so my plan stays current without rebuilding
  it.
- As a user who just got home, I open my quest and the species I
  photographed and got confirmed have already dropped off, each showing
  which of my observations completed it, so my list is true without me
  editing it.
- As a user eyeing a specific target, I glance at its week-by-week
  seasonality so I know whether this is the right week to look.
- As a data-minded naturalist, I export a quest to CSV or GeoJSON so my
  targets are mine to keep and use elsewhere.

---

## Data model sketch

- **inat_user** — `id` (iNat user id, primary key), `login`, `name`,
  `icon_url`, `last_seen_at`. Populated from iNat, not created by us.
- **quest** — `id`, `inat_user_id` (fk), `place_id`, `place_name`,
  `months` (array of 1–12, or a start/end pair), `taxon_root_id`
  (nullable; e.g. all life, plants, birds), `taxon_label`, `created_at`,
  `last_refreshed_at`.
- **target** — `id`, `quest_id` (fk), `taxon_id`, `scientific_name`,
  `common_name`, `photo_url`, `obs_count`, `distinct_observers`,
  `rank_score`, `status` (`open` | `melted`), `melted_at`,
  `melted_observation_id`.
- **query_cache** — keyed on `(place_id, month, taxon_root_id,
  inat_user_id)` with a TTL, holding the raw ranked target payload so we
  respect iNat's ~1 req/s guidance and never re-hit it on every view.

Indexes: `quest(inat_user_id)`, `target(quest_id, status)`,
`target(quest_id, rank_score DESC)`. No target-list query runs unindexed
on a hot path, and the displayed list is capped and paginated (a single
place/month can return 10,000+ species).

## Ranking (honest by design)

`rank_score` blends raw observation frequency with the count of distinct
observers, so a species many different people find outranks one that a
single power user photographed a hundred times. The UI states in one
short line what the number means, because iNat has no effort denominator
and presenting frequency as findability without that caveat ships a
number users will catch being wrong.

## Screen / endpoint inventory

Screens (mobile-first, usable at 390px):
- **Start** — username field, place picker, month/date picker, one
  primary "Build my quest" action. Doubles as the first-run entry.
- **Quest** — ranked target list (capped + paginated), map of targets,
  melted/open status, per-target seasonality on the top targets, refresh
  and export actions.
- **My quests** — saved quests for the current username, with melt
  progress; the app's home once a user has one quest.

Endpoints:
- `GET /api/users/validate?login=` — validate username, return profile.
- `GET /api/places/autocomplete?q=` — place picker options.
- `POST /api/quests` — create a quest (username, place, months, taxon
  root); returns the ranked target list.
- `GET /api/quests?login=` — list saved quests for a username.
- `GET /api/quests/:id` — quest with ranked targets and melt status.
- `POST /api/quests/:id/refresh` — re-rank for the current season and run
  the melt poll.
- `GET /api/species/:taxonId/histogram?place_id=` — week-of-year
  seasonality.
- `GET /api/quests/:id/export.csv`, `GET /api/quests/:id/export.geojson`.

## iNaturalist adapter

One thin module wraps every iNat call (`observations/species_counts` with
`unobserved_by_user_id` + `place_id` + `month`; `observations` for the
melt poll; `observations/histogram`; `places/autocomplete`;
`users/autocomplete`). All caching, rate limiting (~1 req/s), and the
undocumented-parameter surface live here, so an iNat change is a one-file
fix. Threatened-species locations arrive obscured by iNat geoprivacy and
stay obscured on our map.

## Security model (stated, because there is no login)

The app has no accounts and holds only public data. Every input is
validated at the boundary (username format, place id, month range,
pagination bounds). Mutations (`POST /api/quests`, refresh) are rate
limited per client, and saved quests per username are capped to prevent
bloat. Secrets (`SENTRY_DSN`, `INTERNAL_SERVICE_KEY`, DB creds) arrive
only via environment. No PII in logs. There is no private resource to
authorize; "authorization" here is public read of public data, and that
is stated so a reviewer does not read the absence of auth as a gap.

---

## EPIC list (build order)

### EPIC 1 — Scaffold and the ranked target list

**Scope.** Stand up one web service (API plus static frontend) and
deliver the core query end to end: paste a username, pick a place and a
month, and see the ranked never-seen target list. Build the iNat adapter
with caching and rate limiting. Wire error tracking (`SENTRY_DSN`) and
analytics (`UMAMI_WEBSITE_ID`). Ship the staging deploy scaffold. No
persistence, no map, no melt yet.

**Acceptance criteria.**
- A `Dockerfile` and a `docker-compose.staging.yml` build and run the app
  with one command; the compose file honors the `SEED_DEMO` convention so
  the deployed app shows a populated target list within a minute without
  hand-crafted input.
- Entering a valid public username, a place, and a month returns a ranked
  list of never-seen species with common name, photo, and the blended
  frequency score, within ~1s of first meaningful render (skeletons hold
  the layout while loading).
- The list is capped and paginated; a place/month returning 10,000+
  species does not degrade the page or the API.
- The target list is served from a server-side cache keyed on
  place/month/taxon/user; repeat views do not re-hit iNat.
- One short line in the UI states what the ranking means (frequency
  blended with distinct observers, not guaranteed findability).
- Empty, loading, and error states are designed: an unknown username
  shows a positive, actionable message ("Check the username and try
  again"); no raw stack traces reach the user.
- `SENTRY_DSN` and `UMAMI_WEBSITE_ID` are wired from env; `.env.example`
  carries placeholders only.
- Fully usable at 390px with no horizontal scroll; touch targets ~44px.

**Non-goals.** Saved quests, map, auto-melt, seasonality, export, the
guided walkthrough.

### EPIC 2 — Persistent quests and the target map

**Scope.** Make a quest a saved, mapped artifact. Persist quests keyed to
the iNat username (no account system), list them on a "My quests" screen,
and reopen them. Draw the targets on a map using iNat taxon map tiles,
preserving geoprivacy.

**Acceptance criteria.**
- Creating a quest persists it; it survives an app restart and reappears
  on "My quests" for that username.
- Reopening a quest re-ranks its targets for the current season.
- The quest screen shows a map of its targets; obscured/threatened
  locations remain obscured (no de-obfuscation on our side).
- "My quests" is the home screen once at least one quest exists; its empty
  state points a first-time user to build one ("Start your first quest").
- Saved quests per username are capped; quest creation is rate limited.
- Map and list stay usable and legible at 390px.

**Non-goals.** Auto-melt, seasonality curves, export, accounts.

### EPIC 3 — Auto-melt (the signature moment)

**Scope.** The self-completing quest. Poll the user's recent
research-grade observations, intersect their taxa with open quest targets,
and melt matches with visible provenance. This is the mechanic the whole
product exists for; build it depth-first.

**Acceptance criteria.**
- Opening or refreshing a quest runs a melt poll of the user's confirmed
  observations and moves any newly matched targets from open to melted.
- A melted target shows its provenance: the date it melted and a link to
  the user's observation that completed it ("Confirmed by your photo on
  <date>").
- Melting is idempotent and never un-melts a target on a later refresh.
- Melt runs on demand (open/refresh), not as a background mail-storm; no
  notifications are sent.
- The melt poll respects the iNat rate limit and reuses the adapter.
- On staging, `SEED_DEMO` includes a quest with at least one already-
  melted target so the signature moment is visible within a minute.
- Quest progress (open vs melted count) is shown on the quest and on "My
  quests".

**Non-goals.** Email/push on melt, real-time updates, seasonality, export.

### EPIC 4 — Seasonality and export

**Scope.** Add the season signal per target and let users take their data
with them. Show week-of-year seasonality on the top targets; export a
quest to CSV and GeoJSON.

**Acceptance criteria.**
- Each of the top targets shows a compact week-of-year seasonality
  indicator from the histogram endpoint, so a user can tell whether this
  is the right week.
- Seasonality data is cached and does not add a per-target live iNat call
  on every view.
- A quest exports to CSV (targets, status, provenance) and to GeoJSON
  (target locations), downloadable from the quest screen.
- Exports contain only public data and no PII beyond the public username.

**Non-goals.** Charts beyond a compact per-target indicator, scheduled
exports, import.

### EPIC 5 — Guided first run

**Scope.** Walk a brand-new user through completing the core action once,
anchored to the real controls, ending at their first quest and an
understanding of how melt will complete it.

**Acceptance criteria.**
- A first-time user is led through 2–4 short steps (each one short
  imperative sentence) anchored to the real username, place, and build
  controls, ending on a real populated quest.
- The path is skippable at any step, shows only until the first quest is
  built, and never appears for a returning user.
- One step points at how targets melt themselves, so the user understands
  the payoff before they leave.
- The walkthrough points at real controls; it is not an overlay essay and
  adds no wall of text.

**Non-goals.** Multi-tour onboarding, tooltips layered over every control,
video or animation.

### EPIC 6 — Polish pass (no new features)

**Scope.** A UX, performance, and copy pass over the whole delivered
product against the QUALITY BAR and the quality differentiator. Tighten
what exists; add nothing.

**Acceptance criteria.**
- First meaningful render is under ~1s and every interaction gives
  feedback within 100ms (pressed states, optimistic melt/refresh,
  skeletons); measured on the quest and "My quests" screens.
- Every screen has one obvious primary action; secondary actions are
  visibly subordinate.
- Every user-visible string passes the copy sweep: no em-dashes or
  dash-asides, no banned LLM vocabulary, no negative empty states; errors
  say what to do next in the product's voice.
- Accessibility basics verified: contrast, visible focus states, labeled
  inputs, semantic headings/landmarks, alt text, full keyboard reach.
- Mobile-first verified at 390px across every screen: no horizontal
  scroll, ~44px touch targets, readable without zoom.
- `README.md` lets a stranger understand, run (verified against the actual
  compose files), and contribute, with no pipeline/factory jargon.
- No hot-path endpoint runs an unindexed query or an uncapped list.

---

## Non-goals / Out of scope (product-wide fence)

- **Per-place or per-country novelty.** v1 owns the lifer framing
  (`unobserved_by_user_id` excludes species seen anywhere). "New for this
  country" is explicitly out.
- **User accounts, passwords, or auth.** Public username is the only
  input; persistence is keyed to it.
- **Social features.** No sharing, following, comments, or leaderboards.
- **Native mobile apps.** Mobile-first web only.
- **Email, push, or any notification** on melt or otherwise in v1.
- **Runtime LLM features.** The core loop needs none; do not add one.
- **Editing the user's iNat life list or lists** from here. The life list
  lives on iNaturalist; this app owns the quest/trip/melt layer only.
- **Non-iNaturalist data sources.** One data source in v1.
- **Bioblitz/project life lists, guide/educator multi-user views.** Real
  future audiences, not v1.
