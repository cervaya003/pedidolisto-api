import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fp from "fastify-plugin";

const GLOBAL_RATE_LIMIT = { max: 300, timeWindow: "1 minute" };
const CORS_MAX_AGE_SECONDS = 600;

async function securityPlugin(app, { corsOrigins }) {
  await app.register(helmet, {
    // Es un API JSON consumido desde otro dominio: permitir lectura cross-origin.
    crossOriginResourcePolicy: { policy: "cross-origin" },
  });

  await app.register(cors, {
    origin: corsOrigins,
    methods: ["GET", "POST", "PUT"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: CORS_MAX_AGE_SECONDS,
  });

  await app.register(rateLimit, {
    ...GLOBAL_RATE_LIMIT,
    errorResponseBuilder: (_request, context) => ({
      statusCode: context.statusCode,
      error: `Demasiadas solicitudes. Intenta de nuevo en ${context.after}.`,
    }),
  });
}

export default fp(securityPlugin, { name: "security" });
