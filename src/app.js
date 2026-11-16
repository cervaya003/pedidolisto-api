import Fastify from "fastify";
import authRoutes from "./modules/auth/auth.routes.js";
import imagesRoutes from "./modules/images/images.routes.js";
import metaRoutes from "./modules/meta/meta.routes.js";
import ordersRoutes from "./modules/orders/orders.routes.js";
import siteRoutes from "./modules/site/site.routes.js";
import authPlugin from "./plugins/auth.js";
import errorsPlugin from "./plugins/errors.js";
import mongoPlugin from "./plugins/mongo.js";
import securityPlugin from "./plugins/security.js";

export const API_PREFIX = "/api/v1";
const BODY_LIMIT_BYTES = 1024 * 1024;

const loggerFor = (env) =>
  env.NODE_ENV === "test"
    ? false
    : env.NODE_ENV === "production"
      ? { level: "info" }
      : { level: "info", transport: { target: "pino-pretty", options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" } } };

/**
 * Construye la app sin escuchar en un puerto: así se reutiliza en el servidor y en las pruebas.
 * `orderNotifiers` y `orderMessengers` reemplazan a Telegram y al correo (pruebas).
 */
export async function buildApp(env, { orderNotifiers, orderMessengers } = {}) {
  const app = Fastify({
    logger: loggerFor(env),
    bodyLimit: BODY_LIMIT_BYTES,
    trustProxy: true,
    ajv: { customOptions: { removeAdditional: "all", allErrors: false } },
  });

  await app.register(errorsPlugin);
  await app.register(securityPlugin, { corsOrigins: env.CORS_ORIGINS });
  await app.register(mongoPlugin, { uri: env.MONGODB_URI, dbName: env.MONGODB_DB_NAME });
  await app.register(authPlugin, { secret: env.JWT_SECRET, expiresIn: env.JWT_EXPIRES_IN });

  app.get("/health", async () => {
    await app.mongo.db.command({ ping: 1 });
    return { status: "ok" };
  });

  await app.register(
    async (api) => {
      await api.register(metaRoutes);
      await api.register(authRoutes, {
        passwordHash: env.ADMIN_PASSWORD_HASH,
        expiresIn: env.JWT_EXPIRES_IN,
        maxAttempts: env.LOGIN_MAX_ATTEMPTS,
        window: env.LOGIN_WINDOW,
      });
      await api.register(siteRoutes);
      await api.register(imagesRoutes, { cloudinary: env.CLOUDINARY });
      await api.register(ordersRoutes, {
        telegram: env.TELEGRAM,
        email: env.EMAIL,
        emailError: env.EMAIL_ERROR,
        notifiers: orderNotifiers,
        messengers: orderMessengers,
        maxPerWindow: env.ORDER_MAX_PER_WINDOW,
        window: env.ORDER_WINDOW,
      });
    },
    { prefix: API_PREFIX },
  );

  return app;
}
