import type { FastifyInstance } from "fastify";
import type { INatClient } from "../inat/client.js";
import { INatError } from "../inat/types.js";

export function registerPlaces(app: FastifyInstance, client: INatClient): void {
  app.get<{ Querystring: { q?: string } }>(
    "/api/places/autocomplete",
    {
      schema: {
        querystring: {
          type: "object",
          properties: { q: { type: "string", maxLength: 100 } },
        },
      },
    },
    async (req, reply) => {
      const q = (req.query.q ?? "").trim();
      // Under 2 chars makes no upstream call: an empty result set, cheaply.
      if (q.length < 2) return { results: [] };
      try {
        const results = await client.placesAutocomplete(q);
        return { results };
      } catch (err) {
        if (err instanceof INatError) {
          return reply.code(502).send({ error: "upstream", message: "iNaturalist is slow right now. Try again in a moment." });
        }
        throw err;
      }
    },
  );
}
