import type { FastifyInstance } from "fastify";
import type { INatClient } from "../inat/client.js";
import { INatError } from "../inat/types.js";

const LOGIN_PATTERN = "^[A-Za-z0-9._-]{1,50}$";

export function registerUsers(app: FastifyInstance, client: INatClient): void {
  app.get<{ Querystring: { login: string } }>(
    "/api/users/validate",
    {
      schema: {
        querystring: {
          type: "object",
          required: ["login"],
          properties: {
            login: { type: "string", pattern: LOGIN_PATTERN },
          },
        },
      },
    },
    async (req, reply) => {
      const login = req.query.login.trim();
      try {
        const profile = await client.validateUser(login);
        if (!profile) {
          return reply.code(404).send({ error: "unknown_user", message: "Check the username and try again." });
        }
        return profile;
      } catch (err) {
        if (err instanceof INatError) {
          return reply.code(502).send({ error: "upstream", message: "iNaturalist is slow right now. Try again in a moment." });
        }
        throw err;
      }
    },
  );
}
