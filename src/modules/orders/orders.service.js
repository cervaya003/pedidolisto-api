// Crear un pedido: 1) validar y recalcular con el catálogo, 2) GUARDAR, 3) responder al cliente,
// 4) avisar al negocio en segundo plano. Si el aviso falla, el pedido ya está guardado
// y se reintenta solo (ver `retryPending`).
import { randomUUID } from "node:crypto";
import { httpError } from "../../lib/httpError.js";
import { DEFAULT_SITE } from "../../shared/defaults.js";
import { formatAddress, formatFolio } from "./orders.message.js";
import { NOTIFICATION, isDuplicateKeyError, newNotification } from "./orders.repository.js";
import { PHONE_PATTERN, buildItems, cleanText, localPhone, normalizeCustomer, resolveDelivery, resolveDeliveryDate } from "./orders.rules.js";

const MY_ORDERS_LIMIT = 50;

const MIN_PHONE_DIGITS = 10;
export const NOTIFY_POLICY = Object.freeze({
  LOCK_MS: 30_000,
  // 1, 2, 4, 8, 16 y luego cada 30 min: cubre una caída de Telegram o del correo de varias horas.
  MAX_ATTEMPTS: 12,
  FIRST_RETRY_MS: 60_000,
  MAX_RETRY_MS: 30 * 60_000,
  // Al configurar un canal tarde, solo se envían los pedidos recientes (no todo el historial).
  RETRY_WINDOW_MS: 24 * 60 * 60 * 1000,
  BATCH: 20,
});

/** Lo que ve el cliente al terminar: nunca datos internos. */
const toReceipt = (order) => ({
  number: order.number,
  folio: formatFolio(order.number),
  publicId: order.publicId,
  status: order.status,
  total: order.total,
  approximate: order.approximate,
  deliveryDate: order.deliveryDate,
  createdAt: order.createdAt,
});

/** Entrega en una línea legible para el cliente. */
function describeDelivery(delivery) {
  if (delivery?.type === "point") return delivery.point?.name ?? "Punto de entrega";
  if (delivery?.type === "home") return formatAddress(delivery.address ?? {});
  return "Por acordar con el negocio";
}

/** Un pedido como lo ve su propio cliente en «Mis pedidos»: sin datos internos ni de contacto. */
const toCustomerOrder = (order) => ({
  folio: formatFolio(order.number),
  publicId: order.publicId,
  status: order.status,
  createdAt: order.createdAt,
  deliveryDate: order.deliveryDate,
  delivery: { type: order.delivery?.type ?? "arrange", label: describeDelivery(order.delivery) },
  items: (order.items ?? []).map((item) => ({
    productId: item.productId,
    name: item.name,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    subtotal: item.subtotal,
    choices: (item.choices ?? []).map(({ group, value }) => ({ group, value })),
    note: item.note ?? "",
  })),
  total: order.total,
  approximate: Boolean(order.approximate),
  notes: order.notes ?? "",
  name: order.customer?.name ?? "",
});

const BRAND_COLORS = ["primary", "primaryText", "accent", "background", "surface", "text", "muted"];

function brandSnapshot(business, theme) {
  return {
    name: business.name,
    tagline: business.tagline ?? "",
    logoUrl: business.logoUrl ?? "",
    email: business.email ?? "",
    whatsapp: business.whatsapp ?? "",
    address: business.address ?? "",
    hours: business.hours ?? "",
    instagram: business.instagram ?? "",
    facebook: business.facebook ?? "",
    colors: Object.fromEntries(BRAND_COLORS.map((key) => [key, theme?.colors?.[key] ?? ""])),
  };
}

const CHANNEL_LABELS = { telegram: "Telegram", businessEmail: "correo al negocio", customerEmail: "comprobante al cliente" };

/** `notifiers`: canales configurados (ver notifiers.js). Cada uno se envía y reintenta por separado. */
export function createOrdersService({ repository, siteRepository, notifiers = [], log }) {
  const inFlight = new Set();
  const byChannel = new Map(notifiers.map((notifier) => [notifier.channel, notifier]));

  async function loadCatalog() {
    const site = (await siteRepository.find({ includeHidden: false })) ?? DEFAULT_SITE;
    return { business: site.business, theme: site.theme, products: site.products.filter((product) => product.active) };
  }

  async function notify(orderId, channel) {
    const notifier = byChannel.get(channel);
    if (!notifier) return;
    const order = await repository.claimForNotification(orderId, channel, { lockMs: NOTIFY_POLICY.LOCK_MS });
    if (!order) return;
    if (!notifier.appliesTo(order)) return repository.markSkipped(order._id, channel);

    const folio = formatFolio(order.number);
    const label = CHANNEL_LABELS[channel] ?? channel;
    const { attempts } = order.notifications[channel];
    try {
      await notifier.send(order);
      await repository.markSent(order._id, channel);
      log.info({ folio }, `Pedido avisado: ${label}`);
    } catch (error) {
      // Un error de configuración (clave inválida…) no se arregla reintentando.
      const giveUp = Boolean(error.permanent) || attempts >= NOTIFY_POLICY.MAX_ATTEMPTS;
      log.warn({ folio, attempt: attempts, reason: error.message }, `No se pudo enviar: ${label}`);
      const delay = Math.min(NOTIFY_POLICY.FIRST_RETRY_MS * 2 ** (attempts - 1), NOTIFY_POLICY.MAX_RETRY_MS);
      await repository.markFailed(order._id, channel, error.message, { giveUp, retryAt: new Date(Date.now() + delay) });
    }
  }

  /** Corre los avisos sin bloquear la respuesta; se esperan al cerrar el servidor. */
  function notifyInBackground(orderId) {
    for (const { channel } of notifiers) {
      const task = notify(orderId, channel)
        .catch((error) => log.error({ err: error }, "Error al avisar el pedido"))
        .finally(() => inFlight.delete(task));
      inFlight.add(task);
    }
  }

  return {
    async create(input) {
      if (input.website) throw httpError(400, "No se pudo procesar el pedido");

      const existing = await repository.findByRequestId(input.requestId);
      if (existing) return toReceipt(existing);

      const customer = normalizeCustomer(input.customer);
      if (!PHONE_PATTERN.test(customer.phone)) throw httpError(400, "Revisa tu teléfono: 10 dígitos de México, EE. UU. o Canadá");
      if (customer.name.length < 3) throw httpError(400, "Escribe tu nombre completo");

      const { business, theme, products } = await loadCatalog();
      const items = buildItems(products, input.items);
      const delivery = resolveDelivery(business, input.delivery);
      const deliveryDate = resolveDeliveryDate(input.deliveryDate);

      const draft = {
        requestId: input.requestId,
        publicId: randomUUID(),
        number: await repository.nextNumber(),
        status: "new",
        customer,
        deliveryDate,
        delivery,
        items,
        total: items.reduce((sum, item) => sum + item.subtotal, 0),
        approximate: items.some((item) => item.priceFrom),
        notes: cleanText(input.notes),
        businessName: business.name,
        businessEmail: business.email ?? "",
        // Imagen del negocio al momento del pedido: los correos se ven igual aunque luego cambie el tema.
        brand: brandSnapshot(business, theme),
        currency: business.currency,
        locale: business.locale,
        createdAt: new Date(),
        notifications: {},
      };
      for (const notifier of notifiers) {
        draft.notifications[notifier.channel] = notifier.appliesTo(draft) ? newNotification() : { status: NOTIFICATION.SKIPPED };
      }

      let order;
      try {
        order = await repository.insert(draft);
      } catch (error) {
        // Doble clic o reintento simultáneo con el mismo requestId: se devuelve el primero.
        if (isDuplicateKeyError(error)) return toReceipt(await repository.findByRequestId(input.requestId));
        throw error;
      }

      notifyInBackground(order._id);
      return toReceipt(order);
    },

    /** «Mis pedidos»: los pedidos hechos con ese correo y ese teléfono. Normaliza igual que al crear. */
    async findMine({ email, phone }) {
      const customer = normalizeCustomer({ name: "", phone, email });
      if (!customer.email || customer.phone.replace(/\D/g, "").length < MIN_PHONE_DIGITS) return [];
      // También los pedidos anteriores, guardados con solo los 10 dígitos.
      const phones = [...new Set([customer.phone, localPhone(customer.phone)])];
      const found = await repository.findByCustomer({ email: customer.email, phones, limit: MY_ORDERS_LIMIT });
      return found.map(toCustomerOrder);
    },

    /** Reintenta los avisos de pedidos recientes que no se pudieron enviar. */
    async retryPending() {
      const pending = await repository.findPending({
        channels: [...byChannel.keys()],
        since: new Date(Date.now() - NOTIFY_POLICY.RETRY_WINDOW_MS),
        maxAttempts: NOTIFY_POLICY.MAX_ATTEMPTS,
        limit: NOTIFY_POLICY.BATCH,
      });
      for (const { id, channel } of pending) await notify(id, channel);
    },

    /** Espera los avisos en curso (al apagar el servidor). */
    drain: () => Promise.allSettled([...inFlight]),
  };
}
