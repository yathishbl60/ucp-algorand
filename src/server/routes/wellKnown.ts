/**
 * GET /.well-known/ucp
 *
 * Serves the UCP business profile document.
 * Per the UCP spec the response MUST include:
 *   - Cache-Control: public, max-age >= 60
 *   - No redirects
 *   - HTTPS in production
 */

import type { FastifyPluginAsync } from "fastify";
import type { Config } from "../../config.js";
import { buildBusinessProfile } from "../profile.js";

const wellKnownRoutes: FastifyPluginAsync<{ config: Config }> = async (fastify, opts) => {
  // Build once and cache — profile is stable between restarts
  const profile = buildBusinessProfile(opts.config);

  fastify.get(
    "/.well-known/ucp",
    {
      schema: {
        response: {
          200: { type: "object", additionalProperties: true },
        },
      },
    },
    async (_req, reply) => {
      // UCP spec §Profile Requirements §Hosting: must be cacheable
      void reply.header("Cache-Control", "public, max-age=300, stale-while-revalidate=60");
      return reply.send(profile);
    },
  );
};

export default wellKnownRoutes;
