// Envío de correos con la API de Resend (resend.com). Sin librerías: un fetch.
const RESEND_ENDPOINT = "https://api.resend.com/emails";
const REQUEST_TIMEOUT_MS = 10_000;

/** Error que no se arregla reintentando (clave inválida, remitente no verificado…). */
export class PermanentError extends Error {
  permanent = true;
}

export function createResendClient({ apiKey, from }) {
  return {
    async send({ to, subject, html, replyTo }) {
      let response;
      try {
        response = await fetch(RESEND_ENDPOINT, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "User-Agent": "catalogos-api" },
          body: JSON.stringify({ from, to, subject, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        throw new Error(`Sin conexión con Resend (${error.name})`);
      }
      if (response.ok) return;

      const data = await response.json().catch(() => null);
      const message = `Resend respondió ${response.status}: ${data?.message ?? data?.name ?? "sin detalle"}`;
      // 4xx (salvo 429) son errores de configuración: reintentar no sirve.
      if (response.status >= 400 && response.status < 500 && response.status !== 429) throw new PermanentError(message);
      throw new Error(message);
    },
  };
}
