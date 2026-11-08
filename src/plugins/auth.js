import jwt from "@fastify/jwt";
import fp from "fastify-plugin";
import { httpError } from "../lib/httpError.js";

export const ADMIN_ROLE = "admin";
const ALGORITHM = "HS256";

/** Agrega `app.authenticate`: úsalo como `onRequest` en las rutas protegidas. */
async function authPlugin(app, { secret, expiresIn }) {
  await app.register(jwt, {
    secret,
    sign: { algorithm: ALGORITHM, expiresIn },
    verify: { algorithms: [ALGORITHM] },
  });

  app.decorate("authenticate", async (request) => {
    try {
      const payload = await request.jwtVerify();
      if (payload.role !== ADMIN_ROLE) throw new Error("Rol inválido");
    } catch {
      throw httpError(401, "Tu sesión expiró. Inicia sesión de nuevo.");
    }
  });
}

export default fp(authPlugin, { name: "auth" });
