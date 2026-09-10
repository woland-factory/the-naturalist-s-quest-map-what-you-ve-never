import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config.js";
import type { Cache } from "../cache.js";
import type { INatClient } from "../inat/client.js";
import { INatError } from "../inat/types.js";
import { buildTargets, paginate, RANK_BASIS } from "../targets.js";

// The one-line, honest statement of what the ranking means. Kept verbatim
// from the spec; swept for banned copy.
export const RANKING_NOTE =
  "Ranked by how often people record each species here this month, and by how many different people find it. It's a guide, not a guarantee.";

interface TargetsBody {
  login: string;
  placeId: number;
  month: number;
  taxonRootId?: number;
  page?: number;
  perPage?: number;
}

export function registerTargets(
  app: FastifyInstance,
  deps: { client: INatClient; cache: Cache; config: AppConfig },
): void {
  const { client, cache, config } = deps;

  app.post<{ Body: TargetsBody }>(
    "/api/targets",
    {
      // The expensive route gets its own tighter rate limit.
      config: {
        rateLimit: {
          max: config.targetsRateLimitMax,
          timeWindow: config.rateLimitWindow,
        },
      },
      schema: {
        body: {
          type: "object",
          required: ["login", "placeId", "month"],
          additionalProperties: false,
          properties: {
            login: { type: "string", pattern: "^[A-Za-z0-9._-]{1,50}$" },
            placeId: { type: "integer", minimum: 1 },
            month: { type: "integer", minimum: 1, maximum: 12 },
            taxonRootId: { type: "integer", minimum: 1 },
            page: { type: "integer", minimum: 1, default: 1 },
            perPage: { type: "integer", minimum: 1, maximum: 50 },
          },
        },
      },
    },
    async (req, reply) => {
      const body = req.body;
      const page = body.page ?? 1;
      const perPage = body.perPage ?? config.pageSize;
      const login = body.login.trim();

      try {
        const profile = await client.validateUser(login);
        if (!profile) {
          return reply.code(404).send({ error: "unknown_user", message: "Check the username and try again." });
        }

        const built = await buildTargets(
          { client, cache, config },
          { login, placeId: body.placeId, month: body.month, taxonRootId: body.taxonRootId },
        );

        return {
          page,
          perPage,
          totalTargets: built.totalTargets,
          totalAvailable: built.totalAvailable,
          rankBasis: RANK_BASIS,
          note: RANKING_NOTE,
          results: paginate(built, page, perPage),
        };
      } catch (err) {
        if (err instanceof INatError) {
          return reply
            .code(502)
            .send({ error: "upstream", message: "iNaturalist is slow right now. Try again in a moment." });
        }
        throw err;
      }
    },
  );
}
