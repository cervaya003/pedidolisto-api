// Único módulo que conoce las colecciones de pedidos.
const COLLECTIONS = Object.freeze({ ORDERS: "orders", COUNTERS: "counters" });
const ORDER_COUNTER_ID = "orders";
const DUPLICATE_KEY = 11000;

export const NOTIFICATION = Object.freeze({ PENDING: "pending", SENT: "sent", FAILED: "failed", ABANDONED: "abandoned", SKIPPED: "skipped" });
const OPEN_STATUSES = [NOTIFICATION.PENDING, NOTIFICATION.FAILED];
// Sin estado (null): el canal se configuró después de crear el pedido; también se envía.
const OPEN_OR_MISSING = [...OPEN_STATUSES, null];

export const isDuplicateKeyError = (error) => error?.code === DUPLICATE_KEY;

// Estado de cada canal en `notifications.<canal>`: { status, attempts, lastError, lockedUntil, sentAt }.
const field = (channel, key) => `notifications.${channel}.${key}`;

export const newNotification = () => ({ status: NOTIFICATION.PENDING, attempts: 0, lastError: "", lockedUntil: null });

export function createOrdersRepository({ db }) {
  const orders = db.collection(COLLECTIONS.ORDERS);
  const counters = db.collection(COLLECTIONS.COUNTERS);

  return {
    async ensureIndexes() {
      await Promise.all([
        orders.createIndex({ requestId: 1 }, { unique: true }),
        orders.createIndex({ publicId: 1 }, { unique: true }),
        orders.createIndex({ number: -1 }),
        orders.createIndex({ createdAt: -1 }),
        // «Mis pedidos»: búsqueda por correo del cliente, del más nuevo al más viejo.
        orders.createIndex({ "customer.email": 1, createdAt: -1 }),
      ]);
      // Pedidos de la versión anterior (un solo canal en `notification`): pasan a `notifications.telegram`.
      await orders.updateMany({ notification: { $exists: true } }, [{ $set: { "notifications.telegram": "$notification" } }, { $unset: "notification" }]);
    },

    findByRequestId: (requestId) => orders.findOne({ requestId }),

    /** Pedidos de un cliente: deben coincidir correo Y teléfono (`phones`: formatos aceptados). Del más nuevo al más viejo. */
    findByCustomer: ({ email, phones, limit }) =>
      orders
        .find({ "customer.email": email, "customer.phone": { $in: phones } }, { projection: { notifications: 0, requestId: 0 } })
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray(),

    /** Folio consecutivo (1, 2, 3…) atómico aunque lleguen dos pedidos al mismo tiempo. */
    async nextNumber() {
      const counter = await counters.findOneAndUpdate({ _id: ORDER_COUNTER_ID }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: "after" });
      return counter.seq;
    },

    async insert(order) {
      const { insertedId } = await orders.insertOne(order);
      return { ...order, _id: insertedId };
    },

    /**
     * Aparta un canal del pedido para avisarlo (evita que el envío inmediato y el reintento lo manden dos veces).
     * Devuelve el pedido, o null si ya se envió, si otro proceso lo está enviando o si aún no toca reintentar.
     */
    claimForNotification(id, channel, { now = new Date(), lockMs }) {
      return orders.findOneAndUpdate(
        {
          _id: id,
          [field(channel, "status")]: { $in: OPEN_OR_MISSING },
          $or: [{ [field(channel, "lockedUntil")]: null }, { [field(channel, "lockedUntil")]: { $lt: now } }],
        },
        { $set: { [field(channel, "lockedUntil")]: new Date(now.getTime() + lockMs) }, $inc: { [field(channel, "attempts")]: 1 } },
        { returnDocument: "after" },
      );
    },

    /** El canal no aplica a este pedido (p. ej. comprobante sin correo del cliente). */
    markSkipped: (id, channel) => orders.updateOne({ _id: id }, { $set: { [field(channel, "status")]: NOTIFICATION.SKIPPED, [field(channel, "lockedUntil")]: null } }),

    markSent: (id, channel) =>
      orders.updateOne(
        { _id: id },
        { $set: { [field(channel, "status")]: NOTIFICATION.SENT, [field(channel, "sentAt")]: new Date(), [field(channel, "lastError")]: "", [field(channel, "lockedUntil")]: null } },
      ),

    /** `retryAt`: no se vuelve a intentar antes de esa fecha (espera progresiva). */
    markFailed: (id, channel, message, { giveUp, retryAt }) =>
      orders.updateOne(
        { _id: id },
        {
          $set: {
            [field(channel, "status")]: giveUp ? NOTIFICATION.ABANDONED : NOTIFICATION.FAILED,
            [field(channel, "lastError")]: String(message).slice(0, 300),
            [field(channel, "lockedUntil")]: giveUp ? null : retryAt,
          },
        },
      ),

    /** Avisos pendientes de pedidos recientes: [{ id, channel }], del pedido más viejo al más nuevo. */
    async findPending({ channels, since, maxAttempts, limit }) {
      if (!channels.length) return [];
      const isOpen = (channel) => ({ [field(channel, "status")]: { $in: OPEN_OR_MISSING }, [field(channel, "attempts")]: { $not: { $gte: maxAttempts } } });
      const docs = await orders
        .find({ createdAt: { $gte: since }, $or: channels.map(isOpen) }, { projection: { notifications: 1 } })
        .sort({ createdAt: 1 })
        .limit(limit)
        .toArray();
      return docs.flatMap((doc) =>
        channels
          .filter((channel) => {
            const state = doc.notifications?.[channel];
            return (!state || OPEN_STATUSES.includes(state.status)) && (state?.attempts ?? 0) < maxAttempts;
          })
          .map((channel) => ({ id: doc._id, channel })),
      );
    },
  };
}
