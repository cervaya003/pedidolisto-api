import { createSiteRepository } from "../site/site.repository.js";
import { createNotifiers } from "./notifiers.js";
import { createOrdersRepository } from "./orders.repository.js";
import { createOrderSchema, myOrdersSchema } from "./orders.schemas.js";
import { createOrdersService } from "./orders.service.js";

const RETRY_EVERY_MS = 60_000;
// Consultas de «Mis pedidos» por IP: de sobra para abrir la ventana varias veces, poco para adivinar datos.
const MY_ORDERS_MAX_PER_WINDOW = 30;
const MY_ORDERS_WINDOW = "10 minutes";

/**
 * POST /orders es público (lo usa el carrito). POST /orders/mine devuelve los pedidos de un cliente. Avisa por Telegram y/o correo según el .env.
 * `notifiers` permite inyectar canales falsos en pruebas.
 */
export default async function ordersRoutes(app, { telegram, email, emailError, notifiers: injected, maxPerWindow, window }) {
  const repository = createOrdersRepository(app.mongo);
  await repository.ensureIndexes();

  if (emailError) app.log.warn(`Correo desactivado: ${emailError}`);
  const notifiers = injected ?? createNotifiers({ telegram, email });
  const channels = notifiers.map((notifier) => notifier.channel);
  if (!notifiers.length) app.log.warn("Ni Telegram ni correo configurados: los pedidos se guardan, pero nadie recibe el aviso.");
  else app.log.info(`Avisos de pedidos: ${channels.join(", ")}${email ? ` (correo por ${email.provider === "gmail" ? "Gmail" : "Resend"})` : ""}`);
  if (email && !email.ordersTo.length) app.log.warn("EMAIL_ORDERS_TO vacío: el negocio no recibirá los pedidos por correo (solo el comprobante al cliente).");

  const service = createOrdersService({ repository, siteRepository: createSiteRepository(app.mongo), notifiers, log: app.log });

  app.post(
    "/orders",
    { schema: { body: createOrderSchema }, config: { rateLimit: { max: maxPerWindow, timeWindow: window } } },
    async (request, reply) => reply.status(201).send(await service.create(request.body)),
  );

  // «Mis pedidos» del sitio público. Pide correo Y teléfono: con solo el correo, cualquiera que conociera
  // un correo ajeno vería los pedidos (con dirección y teléfono) de esa persona. Límite propio contra abuso.
  app.post(
    "/orders/mine",
    { schema: { body: myOrdersSchema }, config: { rateLimit: { max: MY_ORDERS_MAX_PER_WINDOW, timeWindow: MY_ORDERS_WINDOW } } },
    async (request) => ({ orders: await service.findMine(request.body) }),
  );

  // Reintentos: al arrancar (avisos que quedaron pendientes) y cada minuto.
  if (notifiers.length) {
    const retry = () => service.retryPending().catch((error) => app.log.error({ err: error }, "Error al reintentar avisos de pedidos"));
    let timer;
    app.addHook("onReady", async () => {
      timer = setInterval(retry, RETRY_EVERY_MS);
      timer.unref();
      retry();
    });
    app.addHook("onClose", async () => {
      clearInterval(timer);
      await service.drain();
    });
  }
}
