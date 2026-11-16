// Canales de aviso de un pedido. Cada uno se envía y reintenta por separado:
// si falla el correo, Telegram no se repite (y al revés).
import { businessEmail, customerEmail, statusEmail } from "./email.message.js";
import { formatFolio, formatOrderMessage, formatProofMessage } from "./orders.message.js";
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

/**
 * Avisos de lo que pasa DESPUÉS de crear el pedido (comprobante subido, pedido confirmado o cancelado).
 * Son de mejor esfuerzo: si fallan se registra el error, pero la acción del cliente o del admin no se revierte.
 */
export function createMessengers({ telegram, email }) {
  const chat = telegram ? createTelegramNotifier(telegram) : null;
  const mail = email ? (email.provider === "gmail" ? createGmailClient(email) : createResendClient(email)) : null;
  const ordersTo = email?.ordersTo ?? [];

  return {
    /** Al negocio: Telegram y, si hay, correo. */
    async proofReceived(order) {
      const tasks = [];
      if (chat) tasks.push(chat.send(formatProofMessage(order)));
      if (mail && ordersTo.length) {
        tasks.push(
          mail.send({
            to: ordersTo,
            subject: `📎 Comprobante recibido · pedido ${formatFolio(order.number)}`,
            html: `<p>${formatProofMessage(order).replaceAll("\n", "<br>")}</p>`,
          }),
        );
      }
      return Promise.all(tasks);
    },

    /** Al cliente (si dejó correo): su pedido se confirmó o se canceló. */
    async statusChanged(order) {
      const message = statusEmail(order);
      if (!mail || !message || !order.customer?.email) return;
      await mail.send({ to: [order.customer.email], ...message });
    },
  };
}
