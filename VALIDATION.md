# VALIDATION — The naturalist's quest map

## Verdict: VIABLE

Viable as value, with one binding condition: the product is the
**persistent, self-completing quest artifact**, not the query. If the
build ships only the ranked list, it is a worse SpeciesDex and should
not exist. The plan must treat auto-melt, saved quests, and the map as
the MVP core, not stretch goals.

## Technical claims verified live (2026-09-09)

Every load-bearing API claim in the dossier was re-verified today
against the production iNaturalist API v1, unauthenticated:

1. **The core query works in one call.**
   `GET /v1/observations/species_counts?unobserved_by_user_id=kueda&place_id=14&month=9`
   returned 12,691 never-seen species for California in September,
   ranked by observation count, with names, photos, and taxon data
   inline. The parameter accepts a plain login (no separate id lookup
   needed), though `GET /v1/users/autocomplete` also works for
   validating the username and showing the user their own profile.
2. **Auto-melt is a cheap poll.**
   `GET /v1/observations?user_id=X&quality_grade=research&order_by=created_at`
   returns the user's freshly confirmed observations; intersecting
   their taxon ids with open quest targets is the whole melt mechanic.
3. **Seasonality is served per species.**
   `GET /v1/observations/histogram?taxon_id=...&place_id=...&interval=week_of_year`
   returned a clean 53-bucket curve (the test species peaks weeks
   27–36, exactly the "figeater beetles are a late-summer target"
   signal the product needs).

No authentication, no approval process, no scraping, no runtime LLM.
This is squarely agent-buildable.

## Core value proposition

Paste a public iNaturalist username, pick a place and dates, and get a
season-aware map of species you have never seen, ranked by how often
others record them there at that time of year. The quest persists,
re-ranks as the season advances, and a target melts off the map by
itself once your photo is community-confirmed. eBird's Targets loop,
generalized from birds to all of life, made persistent and self-pruning.

The signature moment (Ambition Bar): *a species disappears from your
map because strangers confirmed your photo.* It is a mechanic, not an
adjective, and it must ship in v1.

## Why it survives the substitution tests

- **A chatbot cannot do it.** It holds neither the user's observation
  history nor live monthly sighting frequencies, and it structurally
  cannot watch uploads between sessions to complete the quest. It can
  assemble the URL trick once; it cannot hold the artifact.
- **No free tool holds all four pieces.** All-taxa never-seen targets,
  month ranking, a map, and self-completion: the URL trick has no state
  and no discoverability (absent from every filter UI, years-old open
  feature request); SpeciesDex has no seasons, no map, no persistence;
  kildor's tools are one-shot lists; the Tampermonkey wishlist is
  manual and browser-local. Users are demonstrably hand-building this
  exact loop and pruning it every evening (forum threads 84183, 84138,
  84023, 52577).
- **Durable artifact.** The quest history (which targets melted, when,
  by which observation) plus a seasonal home-region calendar is a
  compounding record no chat window or existing tool keeps. It should
  export cleanly (CSV/GeoJSON) because this audience routes around
  locked-up data.

## Minimal feature set (the smallest product that delivers the value)

1. Username paste (public data only, no login), place picker, month or
   date-range picker.
2. Ranked never-seen target list for that place and season, blending
   raw frequency with distinct-observer count to soften effort bias,
   with an honest one-line note about what the ranking means.
3. Map of targets (iNat taxon map tiles; geoprivacy-obscured locations
   stay obscured).
4. Saved quests that persist per user (keyed to the iNat username;
   no account system needed for v1).
5. Auto-melt: a poll of the user's recent confirmed observations
   against open quests, with visible provenance ("melted on <date> by
   your observation of X").
6. Per-species week-of-year seasonality on the top targets.

Out of the minimal set: per-place novelty ("new for this country"),
social features, mobile apps, any runtime LLM, notifications/email in
v1.

## Main risks

1. **Substitution is one bookmarkable URL away.** The core query is
   free today for anyone told about `unobserved_by_user_id`, and the
   audience is exactly the crowd that gets told. Mitigation is
   structural, not defensive: the state layer (quests, melt, history)
   is the product; the query is the ingredient.
2. **iNat could ship native Targets.** Three partial native versions
   exist and the mobile app is being rebuilt. If they ship it, this
   product compresses to its quest-history layer. Acceptable for a
   no-revenue factory: the tool is valuable now, and its data exports.
3. **Frequency is not findability.** iNat has no effort denominator
   (unlike eBird checklists), so counts skew toward what enthusiasts
   photograph. Must blend in distinct-observer counts and say plainly
   in the UI what the number means, or power users will distrust the
   map.
4. **Undocumented parameter drift.** `unobserved_by_user_id` is
   undocumented but stable for years with an open feature request to
   expose it. Rate limits (~1 req/s recommended) require server-side
   caching of place/month lists. Build a thin API adapter so a param
   change is a one-file fix.
5. **Trip-shaped usage.** Honest expectation: a few sessions per year
   per user, more for home-region users. Fine under the factory's
   value purpose; the artifact still compounds.

## What would make me reject it

- If `unobserved_by_user_id` did not work or required auth. Verified
  working today, unauthenticated.
- If auto-melt could not be built from public data. It is a trivial
  poll; verified today.
- If the build cuts auto-melt or persistence to ship faster. That
  version already exists for free (SpeciesDex, kildor) and fails the
  "couldn't an existing free tool do it" test. This is the one scope
  cut that kills the product rather than shrinking it.
- If the ranking were presented as findability without the effort-bias
  caveat and observer blending. That ships a number users will catch
  being wrong, and trust does not come back.

## Note for the planner

The premortem's 0.7 kill probability overweights risk 1 by treating the
query as the product. The evidence says users who know the URL trick
still hand-build the state layer every evening. Plan depth-first on the
melt mechanic and quest persistence; do not spend EPICs widening the
query surface.
