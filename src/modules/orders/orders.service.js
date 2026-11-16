// Crear un pedido: 1) validar y recalcular con el catálogo, 2) GUARDAR, 3) avisar al negocio
// (primer intento, con tope de tiempo; ver `notifyBeforeReply`), 4) responder al cliente.
// Si el aviso falla, el pedido ya está guardado y se reintenta solo (ver `retryPending`).
import { randomUUID } from "node:crypto";
import { httpError } from "../../lib/httpError.js";
import { DEFAULT_SITE } from "../../shared/defaults.js";
import { formatAddress, formatFolio } from "./orders.message.js";
import { NOTIFICATION, isDuplicateKeyError, newNotification } from "./orders.repository.js";
import { PHONE_PATTERN, buildItems, cleanText, localPhone, normalizeCustomer, orderDeposit, resolveDelivery, resolveDeliveryDate } from "./orders.rules.js";
import { LIMITS, ORDER_STATUSES, ORDER_TRANSITIONS } from "../../shared/catalog.js";

const MY_ORDERS_LIMIT = 50;
const ADMIN_PAGE = 30;
const HOUR_MS = 60 * 60 * 1000;
// Mientras el pedido no se confirme ni se cancele, el cliente puede subir su comprobante.
const PROOF_STATUSES = ["awaiting_deposit", "new"];

const MIN_PHONE_DIGITS = 10;
export const NOTIFY_POLICY = Object.freeze({
  LOCK_MS: 30_000,
  // Tope de espera de los avisos antes de responder al cliente (Telegram tarda <1 s, Gmail 1-3 s).
  WAIT_BEFORE_REPLY_MS: 8_000,
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
  deposit: order.deposit ?? 0,
  depositDueAt: order.depositDueAt ?? null,
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
  deposit: order.deposit ?? 0,
  depositDueAt: order.depositDueAt ?? null,
  depositPaidAt: order.depositPaidAt ?? null,
  proofCount: order.proofs?.length ?? 0,
});

/** Un pedido para el panel: todo menos datos internos de envío. Los comprobantes, solo por id. */
const toAdminOrder = (order) => ({
  number: order.number,
  folio: formatFolio(order.number),
  status: order.status ?? "new",
  statusLabel: ORDER_STATUSES[order.status] ?? ORDER_STATUSES.new,
  nextStatuses: ORDER_TRANSITIONS[order.status ?? "new"] ?? [],
  createdAt: order.createdAt,
  statusChangedAt: order.statusChangedAt ?? null,
  customer: order.customer,
  deliveryDate: order.deliveryDate,
  delivery: { type: order.delivery?.type ?? "arrange", label: describeDelivery(order.delivery) },
  items: (order.items ?? []).map(({ name, quantity, subtotal, choices = [], note = "", deposit = 0 }) => ({ name, quantity, subtotal, choices, note, deposit })),
  notes: order.notes ?? "",
  total: order.total,
  approximate: Boolean(order.approximate),
  deposit: order.deposit ?? 0,
  depositDueAt: order.depositDueAt ?? null,
  depositPaidAt: order.depositPaidAt ?? null,
  proofs: (order.proofs ?? []).map(({ id, uploadedAt }) => ({ id, uploadedAt })),
  currency: order.currency,
  locale: order.locale,
});

const PAYMENT_FIELDS = ["bank", "holder", "clabe", "card", "account", "phone", "qrUrl", "instructions"];
const paymentSnapshot = (payment) => Object.fromEntries(PAYMENT_FIELDS.map((key) => [key, payment[key] ?? ""]));

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
    // Datos de transferencia vigentes al hacer el pedido: el comprobante muestra a dónde pagar ESE pedido.
    payment: business.payment?.enabled ? paymentSnapshot(business.payment) : null,
  };
}

const CHANNEL_LABELS = { telegram: "Telegram", businessEmail: "correo al negocio", customerEmail: "comprobante al cliente" };

/** `notifiers`: canales configurados (ver notifiers.js). Cada uno se envía y reintenta por separado. */
export function createOrdersService({ repository, siteRepository, notifiers = [], messengers = null, log }) {
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

  /**
   * Manda los avisos (en paralelo) y espera a que terminen antes de responder, con un tope de tiempo.
   * No se dejan «en segundo plano»: en hostings que congelan el CPU al responder (Cloud Run, Render,
   * Railway…) el envío se quedaba detenido hasta la siguiente petición y llegaba 10-20 min tarde.
   * Si pasa el tope, la respuesta sale igual y el aviso sigue (o lo toma `retryPending`).
   */
  async function notifyBeforeReply(orderId) {
    const tasks = notifiers.map(({ channel }) => {
      const task = notify(orderId, channel)
        .catch((error) => log.error({ err: error }, "Error al avisar el pedido"))
        .finally(() => inFlight.delete(task));
      inFlight.add(task);
      return task;
    });
    let timer;
    const limit = new Promise((resolve) => {
      timer = setTimeout(resolve, NOTIFY_POLICY.WAIT_BEFORE_REPLY_MS);
    });
    await Promise.race([Promise.allSettled(tasks), limit]);
    clearTimeout(timer);
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
      // El anticipo solo aplica si el negocio tiene a dónde recibirlo.
      const paymentOn = Boolean(business.payment?.enabled);
      if (!paymentOn) for (const item of items) item.deposit = 0;
      const deposit = orderDeposit(items);
      const createdAt = new Date();
      const status = deposit > 0 ? "awaiting_deposit" : "new";

      const draft = {
        requestId: input.requestId,
        publicId: randomUUID(),
        number: await repository.nextNumber(),
        status,
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
        createdAt,
        deposit,
        depositDueAt: deposit > 0 ? new Date(createdAt.getTime() + (business.payment.depositHours ?? 24) * HOUR_MS) : null,
        depositPaidAt: null,
        proofs: [],
        statusHistory: [{ status, at: createdAt }],
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

      await notifyBeforeReply(order._id);
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

    /**
     * El cliente sube la foto de su comprobante. `publicId` (UUID que solo tiene el cliente) es la llave:
     * no se puede adivinar ni recorrer como un folio.
     */
    async addProof(publicId, image) {
      const order = await repository.findByPublicId(publicId);
      if (!order) throw httpError(404, "No encontramos ese pedido");
      if (!PROOF_STATUSES.includes(order.status)) throw httpError(409, "Este pedido ya no recibe comprobantes. Escríbenos si necesitas ayuda.");
      if ((order.proofs?.length ?? 0) >= LIMITS.ORDER_PROOFS) throw httpError(409, `Ya subiste ${LIMITS.ORDER_PROOFS} comprobantes para este pedido`);

      const updated = await repository.addProof(publicId, image, { statuses: PROOF_STATUSES, max: LIMITS.ORDER_PROOFS });
      if (!updated) throw httpError(409, "No se pudo agregar el comprobante. Recarga e inténtalo de nuevo.");
      await messengers?.proofReceived(updated).catch((error) => log.warn({ folio: formatFolio(updated.number), reason: error.message }, "No se pudo avisar del comprobante"));
      return { proofCount: updated.proofs.length };
    },

    // ── Admin ───────────────────────────────────────────────────────────────────────────────

    /** `status`: un estado, "open" (por atender) o vacío (todos). `before`: folio para la página siguiente. */
    async listForAdmin({ status, before }) {
      const statuses = status === "open" ? ["awaiting_deposit", "new", "confirmed"] : status ? [status] : null;
      const [found, counts] = await Promise.all([repository.listForAdmin({ statuses, before, limit: ADMIN_PAGE + 1 }), repository.countByStatus()]);
      return { orders: found.slice(0, ADMIN_PAGE).map(toAdminOrder), hasMore: found.length > ADMIN_PAGE, counts };
    },

    /** Mueve el pedido al siguiente estado (solo transiciones permitidas) y avisa al cliente. */
    async changeStatus(number, to) {
      const current = await repository.findByNumber(number);
      if (!current) throw httpError(404, "No encontramos ese pedido");
      const from = Object.keys(ORDER_TRANSITIONS).filter((status) => ORDER_TRANSITIONS[status].includes(to));
      const fromStatus = current.status ?? "new";
      if (!from.includes(fromStatus)) {
        throw httpError(409, `Un pedido «${ORDER_STATUSES[fromStatus] ?? fromStatus}» no puede pasar a «${ORDER_STATUSES[to] ?? to}»`);
      }

      const now = new Date();
      // Confirmar un pedido que esperaba anticipo = el anticipo llegó.
      const set = fromStatus === "awaiting_deposit" && to === "confirmed" ? { depositPaidAt: now } : {};
      const updated = await repository.changeStatus(number, { from: [fromStatus], to, set, now });
      if (!updated) throw httpError(409, "El pedido cambió mientras tanto. Recarga la lista.");

      log.info({ folio: formatFolio(number), from: fromStatus, to }, "Estado del pedido actualizado");
      await messengers?.statusChanged(updated).catch((error) => log.warn({ folio: formatFolio(number), reason: error.message }, "No se pudo avisar al cliente del cambio"));
      return toAdminOrder(updated);
    },

    /** Imagen de un comprobante (solo admin). */
    async getProof(id) {
      const proof = await repository.findProof(id);
      if (!proof) throw httpError(404, "Comprobante no encontrado");
      return proof;
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
