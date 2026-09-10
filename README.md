# Map what you've never seen

A trip-planning tool for iNaturalist life-listers. Paste your public
iNaturalist username, pick a place and a month, and get a ranked list of the
species you have never recorded that other people find there at that time of
year. It answers one question naturalists otherwise hand-build every trip:
what could I realistically find here that would be new to me?

The ranking blends how often each species is recorded at that place and month
with how many different people find it, so a species many observers see
outranks one a single power user photographed a hundred times. It is a guide,
not a guarantee.

## How it works

The app is one web service: a Fastify API that also serves a React frontend
from the same origin. It reads only public iNaturalist data through a single
adapter that rate-limits itself to about one request per second and caches
results in memory, so repeat views never re-query iNaturalist. There is no
database and no account system. Your username is the only input, and the app
stores nothing about you between restarts.

## Run it

You need Docker and Docker Compose.

```bash
git clone <this-repo-url>
cd the-naturalist-s-quest-map-what-you-ve-never
cp .env.example .env        # optional: defaults work out of the box
docker compose -f docker-compose.staging.yml up --build
```

The staging compose expects an external Docker network named
`factory-staging-net` and serves on container port 80 without publishing a
host port, because a reverse proxy fronts it in deployment. To run it in
isolation on your machine, create the network once and reach the container
directly:

```bash
docker network create factory-staging-net   # first time only
docker compose -f docker-compose.staging.yml up --build -d
# then browse via the container, e.g.
docker exec the-naturalist-s-quest-map-what-you-ve-never-staging-web \
  wget -qO- http://127.0.0.1/api/health
```

The staging compose sets `SEED_DEMO=1`, so the first screen loads a populated
example quest for California immediately, with no input needed.

### Local development

```bash
npm install
npm run dev:server   # API with hot reload on http://127.0.0.1:8080
npm run dev:web      # Vite frontend on http://127.0.0.1:5173 (proxies /api)
```

Or run both in a container with `docker compose -f docker-compose.dev.yml up`.

## Configuration

Every setting has a safe default. See `.env.example` for the full list. The
ones you are most likely to change:

- `INAT_USER_AGENT` — a polite identifier with a contact address, sent on
  every iNaturalist request.
- `SENTRY_DSN` — error tracking. Unset means error tracking is off.
- `UMAMI_WEBSITE_ID` and `UMAMI_URL` — privacy-friendly analytics. Unset means
  no analytics script loads.
- `SEED_DEMO` — set to `1` to preload the example quest on boot.

No secret is ever committed. `.env` stays out of git; `.env.example` holds
placeholders only.

## Tests

```bash
npm test         # unit and API integration tests (Vitest)
./scripts/e2e.sh # end-to-end browser tests (Playwright, in a container)
```

The unit and integration tests mock iNaturalist and never touch the live API.
The end-to-end suite runs the production build against a local iNaturalist
stub inside the official Playwright container, so it needs no browser install
on your machine.

## Where the code lives

- `server/` — Fastify app, routes, the iNaturalist adapter (`inat/client.ts`),
  the ranking core (`inat/ranking.ts`), and the in-memory cache.
- `web/` — the React frontend (start screen, results screen, designed states).
- `tests/` — unit and integration tests. `e2e/` — Playwright specs and the
  test harness.

Contributions are welcome. Run the tests before opening a pull request. This
project is released under the MIT License.
