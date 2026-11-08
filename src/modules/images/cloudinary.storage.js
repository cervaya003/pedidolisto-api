// Guarda las imágenes en Cloudinary con una subida firmada. El secreto nunca sale del API.
import { createHash } from "node:crypto";

const UPLOAD_TIMEOUT_MS = 30_000;

/** Firma de Cloudinary: parámetros ordenados "a=1&b=2" + secreto, en SHA-1. */
export function signParams(params, apiSecret) {
  const payload = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  return createHash("sha1").update(payload + apiSecret).digest("hex");
}

// Error de un servicio externo con un mensaje pensado para el usuario (el manejador global lo muestra).
const uploadError = (message, cause) => Object.assign(new Error(message), { statusCode: 502, expose: true, cause });

export function createCloudinaryStorage({ cloudName, apiKey, apiSecret, folder }) {
  const endpoint = `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`;

  return {
    /** Sube la imagen y devuelve su URL pública (https://res.cloudinary.com/…). */
    async save({ contentType, data }) {
      const params = { folder, timestamp: Math.floor(Date.now() / 1000) };
      const form = new FormData();
      form.append("file", new Blob([data], { type: contentType }), "imagen");
      for (const [key, value] of Object.entries(params)) if (value) form.append(key, String(value));
      form.append("api_key", apiKey);
      form.append("signature", signParams(params, apiSecret));

      let response;
      try {
        response = await fetch(endpoint, { method: "POST", body: form, signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS) });
      } catch (cause) {
        throw uploadError("No se pudo conectar con Cloudinary. Intenta de nuevo.", cause);
      }

      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.secure_url) {
        const detail = body?.error?.message ?? `HTTP ${response.status}`;
        throw uploadError(`Cloudinary rechazó la imagen (${detail}). Revisa las variables CLOUDINARY_* del .env.`);
      }
      return body.secure_url;
    },
  };
}
