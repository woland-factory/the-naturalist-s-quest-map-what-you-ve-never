import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config.js";
import type { Cache } from "../cache.js";
import type { INatClient } from "../inat/client.js";
import { INatError, type BBox } from "../inat/types.js";
import { buildTargets, paginate, resolveSeasonMonth, RANK_BASIS, RANKING_NOTE, type BuiltTargets } from "../targets.js";
import { pollMelt } from "../melt.js";
import type { MeltedTarget, QuestRecord, QuestStore } from "../store/quests.js";

const LOGIN_PATTERN = "^[A-Za-z0-9._-]{1,50}$";
const UUID_PATTERN = "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$";

// A quest as returned to the client: the durable record plus its last-build
// figures, so the list and quest screens render without another round-trip.
export interface QuestSummary {
  id: string;
  login: string; // display casing
  placeId: number;
  placeName: string;
  placeBbox: BBox | null;
  taxonRootId: number | null;
  seasonMonth: number;
  targetCount: number;
  totalAvailable: number;
  createdAt: number;
  lastRefreshedAt: number;
  openCount: number; // live open count from the last build (= targetCount)
  meltedCount: number; // how many targets have crossed themselves off
}

function toSummary(rec: QuestRecord): QuestSummary {
  return {
    id: rec.id,
    login: rec.loginDisplay,
    placeId: rec.placeId,
    placeName: rec.placeName,
    placeBbox: rec.placeBbox,
    taxonRootId: rec.taxonRootId,
    seasonMonth: rec.lastSeasonMonth,
    targetCount: rec.lastTargetCount,
    totalAvailable: rec.lastTotalAvailable,
    createdAt: rec.createdAt,
    lastRefreshedAt: rec.lastRefreshedAt,
    // On create/open lastTargetCount is set from the fresh build, so it is the
    // live open count there too; on the list endpoint (no build) it is the
    // last-known open count, which is exactly what the list should show.
    openCount: rec.lastTargetCount,
    meltedCount: rec.melted.length,
  };
}

// Melted targets, newest completion first, for the Found surface.
function meltedForDisplay(melted: MeltedTarget[]): MeltedTarget[] {
  return [...melted].sort((a, b) => b.meltedAt - a.meltedAt);
}

interface CreateBody {
  login: string;
  placeId: number;
  placeName: string;
  taxonRootId?: number;
}

interface QuestDeps {
  client: INatClient;
  cache: Cache;
  config: AppConfig;
  store: QuestStore;
  now?: () => number;
}

export function registerQuests(app: FastifyInstance, deps: QuestDeps): void {
  const { client, cache, config, store } = deps;
  const now = deps.now ?? Date.now;
  const mutationRateLimit = {
    config: { rateLimit: { max: config.questsRateLimitMax, timeWindow: config.rateLimitWindow } },
  };

  // The paginated response shape shared by create and reopen, so the quest
  // screen renders with no extra round-trip.
  function questPayload(
    rec: QuestRecord,
    built: BuiltTargets,
    page: number,
    perPage: number,
    newlyMelted: MeltedTarget[] = [],
  ) {
    return {
      quest: toSummary(rec),
      page,
      perPage,
      totalTargets: built.totalTargets,
      totalAvailable: built.totalAvailable,
      rankBasis: RANK_BASIS,
      note: RANKING_NOTE,
      results: paginate(built, page, perPage),
      melted: meltedForDisplay(rec.melted),
      newlyMelted: newlyMelted.map((m) => m.taxonId),
    };
  }

  app.post<{ Body: CreateBody }>(
    "/api/quests",
    {
      ...mutationRateLimit,
      schema: {
        body: {
          type: "object",
          required: ["login", "placeId", "placeName"],
          additionalProperties: false,
          properties: {
            login: { type: "string", pattern: LOGIN_PATTERN },
            placeId: { type: "integer", minimum: 1 },
            placeName: { type: "string", minLength: 1, maxLength: 120 },
            taxonRootId: { type: "integer", minimum: 1 },
          },
        },
      },
    },
    async (req, reply) => {
      const body = req.body;
      const login = body.login.trim();
      const loginLower = login.toLowerCase();

      try {
        const profile = await client.validateUser(login);
        if (!profile) {
          return reply.code(404).send({ error: "unknown_user", message: "Check the username and try again." });
        }

        if (store.countByLogin(loginLower) >= config.maxQuestsPerUser) {
          return reply.code(409).send({
            error: "quest_limit",
            message: "You've saved the most quests we keep. Open one you have, or remove one to add another.",
          });
        }

        // Bounding box is best-effort framing. A failure never fails create.
        let placeBbox: BBox | null = null;
        try {
          const details = await client.placeDetails(body.placeId);
          placeBbox = details.bbox;
        } catch {
          placeBbox = null;
        }

        const month = resolveSeasonMonth(now);
        const built = await buildTargets(
          { client, cache, config, now },
          { login, placeId: body.placeId, month, taxonRootId: body.taxonRootId },
        );

        const ts = now();
        const rec = store.create({
          id: randomUUID(),
          loginLower,
          loginDisplay: login,
          inatUserId: profile.id,
          placeId: body.placeId,
          placeName: body.placeName.trim(),
          placeBbox,
          taxonRootId: body.taxonRootId ?? null,
          createdAt: ts,
          lastRefreshedAt: ts,
          lastSeasonMonth: month,
          lastTargetCount: built.totalTargets,
          lastTotalAvailable: built.totalAvailable,
          // Snapshot the just-built unobserved target set. No melt poll on
          // create: species already confirmed were excluded by
          // unobserved_by_user_id, so the intersection is provably empty and a
          // poll would be a wasted upstream call.
          targetTaxonIds: built.targets.map((t) => t.taxonId),
          melted: [],
          lastMeltPolledAt: 0,
        });

        return reply.code(201).send(questPayload(rec, built, 1, config.pageSize));
      } catch (err) {
        if (err instanceof INatError) {
          return reply.code(502).send({ error: "upstream", message: "iNaturalist is slow right now. Try again in a moment." });
        }
        throw err;
      }
    },
  );

  app.get<{ Querystring: { login: string } }>(
    "/api/quests",
    {
      schema: {
        querystring: {
          type: "object",
          required: ["login"],
          properties: { login: { type: "string", pattern: LOGIN_PATTERN } },
        },
      },
    },
    async (req) => {
      const loginLower = req.query.login.trim().toLowerCase();
      return { quests: store.listByLogin(loginLower).map(toSummary) };
    },
  );

  app.get<{ Params: { id: string }; Querystring: { page?: number; perPage?: number } }>(
    "/api/quests/:id",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", pattern: UUID_PATTERN } },
        },
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            page: { type: "integer", minimum: 1, default: 1 },
            perPage: { type: "integer", minimum: 1, maximum: 50 },
          },
        },
      },
    },
    async (req, reply) => {
      const rec = store.get(req.params.id);
      if (!rec) {
        return reply.code(404).send({ error: "not_found", message: "That quest is not here." });
      }

      const page = req.query.page ?? 1;
      const perPage = req.query.perPage ?? config.pageSize;

      try {
        // Melt first, against the PREVIOUS target snapshot: a target the user
        // just confirmed is still in that snapshot, so it is captured in
        // `melted` before the snapshot is refreshed below. Best-effort: this
        // never throws out and never fails the open.
        const meltRes = await pollMelt({ client, cache, config, now, logger: app.log }, rec);

        const month = resolveSeasonMonth(now);
        const built = await buildTargets(
          { client, cache, config, now },
          { login: rec.loginDisplay, placeId: rec.placeId, month, taxonRootId: rec.taxonRootId ?? undefined },
        );

        const updated =
          store.update(rec.id, {
            lastRefreshedAt: now(),
            lastSeasonMonth: month,
            lastTargetCount: built.totalTargets,
            lastTotalAvailable: built.totalAvailable,
            melted: meltRes.melted,
            // Refresh the snapshot from the fresh build (which excludes the
            // just-observed species); the melt above already ran on the old one.
            targetTaxonIds: built.targets.map((t) => t.taxonId),
            lastMeltPolledAt: now(),
          }) ?? rec;

        return questPayload(updated, built, page, perPage, meltRes.newlyMelted);
      } catch (err) {
        if (err instanceof INatError) {
          return reply.code(502).send({ error: "upstream", message: "iNaturalist is slow right now. Try again in a moment." });
        }
        throw err;
      }
    },
  );

  app.delete<{ Params: { id: string }; Querystring: { login: string } }>(
    "/api/quests/:id",
    {
      ...mutationRateLimit,
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", pattern: UUID_PATTERN } },
        },
        querystring: {
          type: "object",
          required: ["login"],
          properties: { login: { type: "string", pattern: LOGIN_PATTERN } },
        },
      },
    },
    async (req, reply) => {
      const loginLower = req.query.login.trim().toLowerCase();
      const removed = store.delete(req.params.id, loginLower);
      if (!removed) {
        return reply.code(404).send({ error: "not_found", message: "That quest is not here." });
      }
      return reply.code(204).send();
    },
  );
}
