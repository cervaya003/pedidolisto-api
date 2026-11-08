// Envío de correos desde una cuenta de Gmail (SMTP con «contraseña de aplicación» de Google).
// Puede escribir a cualquier destinatario; límite de Gmail: ~500 correos al día.
import nodemailer from "nodemailer";
import { PermanentError } from "./resend.client.js";

const TIMEOUT_MS = 15_000;
// Usuario o contraseña rechazados: reintentar no sirve, hay que corregir el .env.
const AUTH_ERRORS = new Set(["EAUTH"]);

export function createGmailClient({ user, appPassword, from }) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass: appPassword },
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
  });

  return {
    async send({ to, subject, html, replyTo }) {
      try {
        await transporter.sendMail({ from, to, subject, html, ...(replyTo ? { replyTo } : {}) });
      } catch (error) {
        const message = `Gmail: ${error.response ?? error.message}`;
        if (AUTH_ERRORS.has(error.code) || error.responseCode === 535) {
          throw new PermanentError(`${message} (revisa EMAIL_FROM y GMAIL_APP_PASSWORD)`);
        }
        throw new Error(message);
      }
    },
  };
}
