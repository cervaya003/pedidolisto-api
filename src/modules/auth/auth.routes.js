import { httpError } from "../../lib/httpError.js";
import { verifyPassword } from "../../lib/password.js";
import { ADMIN_ROLE } from "../../plugins/auth.js";

const loginSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["password"],
    properties: { password: { type: "string", minLength: 1, maxLength: 200 } },
  },
};

export default async function authRoutes(app, { passwordHash, expiresIn, maxAttempts, window }) {
  app.post(
    "/auth/login",
    {
      schema: loginSchema,
      config: { rateLimit: { max: maxAttempts, timeWindow: window } },
    },
    async (request) => {
      const isValid = await verifyPassword(request.body.password, passwordHash);
      if (!isValid) throw httpError(401, "Contraseña incorrecta");

      return { token: app.jwt.sign({ role: ADMIN_ROLE }), expiresIn };
    },
  );
}
