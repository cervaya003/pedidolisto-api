// Canales de aviso de un pedido. Cada uno se envía y reintenta por separado:
// si falla el correo, Telegram no se repite (y al revés).
import { businessEmail, customerEmail } from "./email.message.js";
import { formatOrderMessage } from "./orders.message.js";
import { createGmailClient } from "./gmail.client.js";
import { createResendClient } from "./resend.client.js";
import { createTelegramNotifier } from "./telegram.notifier.js";

/**
 * Un canal: `{ channel, appliesTo(order), send(order) }`.
 * `appliesTo` decide si el pedido usa el canal (p. ej. el comprobante solo si el cliente dejó correo).
 */
export function createNotifiers({ telegram, email }) {
  const notifiers = [];

  if (telegram) {
    const client = createTelegramNotifier(telegram);
    notifiers.push({ channel: "telegram", appliesTo: () => true, send: (order) => client.send(formatOrderMessage(order)) });
  }

  if (email) {
    const client = email.provider === "gmail" ? createGmailClient(email) : createResendClient(email);
    if (email.ordersTo.length) {
      notifiers.push({ channel: "businessEmail", appliesTo: () => true, send: (order) => client.send({ to: email.ordersTo, ...businessEmail(order) }) });
    }
    notifiers.push({
      channel: "customerEmail",
      appliesTo: (order) => Boolean(order.customer.email),
      send: (order) => client.send({ to: [order.customer.email], ...customerEmail(order) }),
    });
  }

  return notifiers;
}
