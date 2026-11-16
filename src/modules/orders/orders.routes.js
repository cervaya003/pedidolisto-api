import { createSiteRepository } from "../site/site.repository.js";
import { IMAGE_TYPES, MAX_IMAGE_BYTES, imageTypeOf } from "../images/imageTypes.js";
import { httpError } from "../../lib/httpError.js";
import { createMessengers, createNotifiers } from "./notifiers.js";
import { createOrdersRepository } from "./orders.repository.js";
import {
  adminListSchema,
  changeStatusSchema,
  createOrderSchema,
  myOrdersSchema,
  orderNumberParamsSchema,
  proofIdParamsSchema,
  proofParamsSchema,
} from "./orders.schemas.js";
import { createOrdersService } from "./orders.service.js";

const RETRY_EVERY_MS = 60_000;
// Consultas de «Mis pedidos» por IP: de sobra para abrir la ventana varias veces, poco para adivinar datos.
const MY_ORDERS_MAX_PER_WINDOW = 30;
const MY_ORDERS_WINDOW = "10 minutes";
// Comprobantes por IP: suficiente para reintentar, poco para llenar la base de datos.
const PROOF_RATE_LIMIT = { max: 10, timeWindow: "10 minutes" };

/**
 * POST /orders es público (lo usa el carrito). POST /orders/mine devuelve los pedidos de un cliente. Avisa por Telegram y/o correo según el .env.
 * `notifiers` permite inyectar canales falsos en pruebas.
 */
export default async function ordersRoutes(app, { telegram, email, emailError, notifiers: injected, messengers: injectedMessengers, maxPerWindow, window }) {
  const repository = createOrdersRepository(app.mongo);
  await repository.ensureIndexes();

  if (emailError) app.log.warn(`Correo desactivado: ${emailError}`);
  const notifiers = injected ?? createNotifiers({ telegram, email });
  const channels = notifiers.map((notifier) => notifier.channel);
  if (!notifiers.length) app.log.warn("Ni Telegram ni correo configurados: los pedidos se guardan, pero nadie recibe el aviso.");
  else app.log.info(`Avisos de pedidos: ${channels.join(", ")}${email ? ` (correo por ${email.provider === "gmail" ? "Gmail" : "Resend"})` : ""}`);
  if (email && !email.ordersTo.length) app.log.warn("EMAIL_ORDERS_TO vacío: el negocio no recibirá los pedidos por correo (solo el comprobante al cliente).");

  const messengers = injectedMessengers ?? createMessengers({ telegram, email });
  const service = createOrdersService({ repository, siteRepository: createSiteRepository(app.mongo), notifiers, messengers, log: app.log });

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

  // El cliente sube la foto de su comprobante (imagen tal cual, ya comprimida por el navegador).
  app.register(async (proofs) => {
    proofs.addContentTypeParser(IMAGE_TYPES, { parseAs: "buffer", bodyLimit: MAX_IMAGE_BYTES }, (_request, body, done) => done(null, body));
    proofs.post(
      "/orders/:publicId/proof",
      { schema: { params: proofParamsSchema }, config: { rateLimit: PROOF_RATE_LIMIT } },
      async (request, reply) => {
        const contentType = imageTypeOf(request);
        if (!contentType) throw httpError(415, "Sube una foto JPG, PNG o WebP de tu comprobante");
        return reply.status(201).send(await service.addProof(request.params.publicId, { contentType, data: request.body }));
      },
    );
  });

  // Panel: lista de pedidos, cambio de estado y comprobantes (con sesión).
  app.register(async (admin) => {
    admin.addHook("onRequest", app.authenticate);
    admin.get("/admin/orders", { schema: { querystring: adminListSchema } }, async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      return service.listForAdmin(request.query);
    });
    admin.patch("/admin/orders/:number/status", { schema: { params: orderNumberParamsSchema, body: changeStatusSchema } }, async (request) =>
      service.changeStatus(request.params.number, request.body.status),
    );
    admin.get("/admin/orders/proofs/:id", { schema: { params: proofIdParamsSchema } }, async (request, reply) => {
      const proof = await service.getProof(request.params.id);
      // Datos bancarios del cliente: nunca en caché compartida.
      return reply.type(proof.contentType).header("Cache-Control", "private, no-store").send(proof.data);
    });
  });

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
