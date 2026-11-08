// Envía mensajes a un chat (o grupo) de Telegram con la Bot API. Sin librerías: un fetch.
const TELEGRAM_API = "https://api.telegram.org";
const REQUEST_TIMEOUT_MS = 10_000;
// Límite de Telegram por mensaje; un pedido enorme se recorta en vez de fallar para siempre.
const MAX_MESSAGE_LENGTH = 4096;

// Recortar HTML podría partir una etiqueta: si no cabe, se manda como texto plano.
const toPlainText = (html) =>
  html.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

function fitMessage(html) {
  if (html.length <= MAX_MESSAGE_LENGTH) return { text: html, parse_mode: "HTML" };
  const plain = toPlainText(html);
  return { text: plain.length <= MAX_MESSAGE_LENGTH ? plain : `${plain.slice(0, MAX_MESSAGE_LENGTH - 30)}\n… (mensaje recortado)` };
}

export function createTelegramNotifier({ botToken, chatId }) {
  const endpoint = `${TELEGRAM_API}/bot${botToken}/sendMessage`;

  return {
    async send(html) {
      let response;
      try {
        response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, ...fitMessage(html), link_preview_options: { is_disabled: true } }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        // Nunca se incluye la URL: lleva el token del bot.
        throw new Error(`Sin conexión con Telegram (${error.name})`);
      }

      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) throw new Error(`Telegram respondió ${response.status}: ${data?.description ?? "sin detalle"}`);
    },
  };
}
