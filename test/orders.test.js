import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { after, before, beforeEach, describe, test } from "node:test";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { API_PREFIX, buildApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";
import { hashPassword } from "../src/lib/password.js";
import { businessEmail, customerEmail, thumbnail } from "../src/modules/orders/email.message.js";
import { formatOrderMessage } from "../src/modules/orders/orders.message.js";
import { PermanentError } from "../src/modules/orders/resend.client.js";

const PASSWORD = "contraseña-de-prueba";
const api = (path) => `${API_PREFIX}${path}`;

// Canales falsos: guardan lo enviado y pueden fallar a voluntad.
function fakeChannel(channel, { appliesTo = () => true, render = formatOrderMessage } = {}) {
  return {
    channel,
    appliesTo,
    sent: [],
    failNext: 0,
    failWith: null,
    async send(order) {
      if (this.failNext > 0) {
        this.failNext--;
        throw this.failWith ?? new Error(`${channel} caído`);
      }
      this.sent.push(render(order));
    },
    reset() {
      this.sent = [];
      this.failNext = 0;
      this.failWith = null;
    },
  };
}

const notifier = fakeChannel("telegram");
// Avisos posteriores (comprobante, cambio de estado): se guardan para revisarlos.
const messengers = {
  proofs: [],
  statuses: [],
  async proofReceived(order) {
    this.proofs.push(order.number);
  },
  async statusChanged(order) {
    this.statuses.push(`${order.number}:${order.status}`);
  },
};
const receiptMail = fakeChannel("customerEmail", { appliesTo: (order) => Boolean(order.customer.email), render: (order) => customerEmail(order).subject });

let mongo;
let app;
let token;
let requestCounter = 0;

const newRequestId = () => `prueba-${Date.now()}-${++requestCounter}`.padEnd(20, "x");

async function waitFor(condition, timeoutMs = 2000) {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error("Se agotó el tiempo de espera");
    await sleep(20);
  }
}

const isoDate = (offsetDays) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

const postOrder = (overrides = {}) =>
  app.inject({
    method: "POST",
    url: api("/orders"),
    payload: {
      requestId: newRequestId(),
      customer: { name: "Ana López", phone: "+525512345678", email: "" },
      deliveryDate: isoDate(1),
      delivery: { type: "point", point: "Oficina centro" },
      items: [{ productId: "pastel", quantity: 2, choices: [{ group: "Sabor", value: "Chocolate" }] }],
      ...overrides,
    },
  });

before(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const env = loadEnv({
    NODE_ENV: "test",
    MONGODB_URI: mongo.getUri(),
    MONGODB_DB_NAME: "catalogo_pedidos_test",
    JWT_SECRET: "x".repeat(48),
    ADMIN_PASSWORD_HASH: await hashPassword(PASSWORD),
    CORS_ORIGINS: "http://localhost:5173",
    ORDER_MAX_PER_WINDOW: "200",
  });
  app = await buildApp(env, { orderNotifiers: [notifier, receiptMail], orderMessengers: messengers });
  await app.ready();

  token = (await app.inject({ method: "POST", url: api("/auth/login"), payload: { password: PASSWORD } })).json().token;
  const headers = { authorization: `Bearer ${token}` };
  const site = (await app.inject({ method: "GET", url: api("/admin/site"), headers })).json();
  const categoryId = site.categories[0].id;

  site.business.deliveryPoints = [{ name: "Oficina centro", details: "Recepción, 9 a 18 h" }];
  site.business.homeDelivery = true;
  site.business.deliveryAreas = [{ city: "Querétaro", state: "Querétaro" }];
  site.business.payment = { ...site.business.payment, enabled: true, bank: "BBVA", holder: "Ana López", clabe: "032180000118359719", depositHours: 24 };
  site.products = [
    {
      id: "pastel",
      name: "Pastel & especial",
      categoryId,
      price: 300,
      customizable: true,
      allowNotes: true,
      options: [
        { name: "Sabor", type: "single", required: true, choices: [{ label: "Vainilla" }, { label: "Chocolate", price: 50 }] },
        { name: "Mensaje", type: "text" },
      ],
    },
    { id: "galletas", name: "Galletas", categoryId, price: 120 },
    { id: "encargo", name: "Pastel por encargo", categoryId, price: 400, depositType: "percent", depositValue: 50 },
    { id: "boda", name: "Pastel de boda", categoryId, price: 1000, depositType: "fixed", depositValue: 300 },
    { id: "oculto", name: "Oculto", categoryId, price: 10, active: false },
  ];
  const saved = await app.inject({ method: "PUT", url: api("/admin/site"), headers, payload: site });
  assert.equal(saved.statusCode, 200, saved.body);
});

after(async () => {
  await app?.close();
  await mongo?.stop();
});

// Espera a que terminen los avisos de la prueba anterior para que no se mezclen.
beforeEach(async () => {
  const orders = app.mongo.db.collection("orders");
  const pending = () => orders.countDocuments({ $or: [{ "notifications.telegram.status": "pending" }, { "notifications.customerEmail.status": "pending" }] });
  let count = await pending();
  const started = Date.now();
  while (count && Date.now() - started < 2000) {
    await sleep(20);
    count = await pending();
  }
  notifier.reset();
  receiptMail.reset();
});

describe("crear pedido", () => {
  test("guarda, recalcula el precio en el servidor y avisa al negocio", async () => {
    const response = await postOrder({ total: 1, items: [{ productId: "pastel", quantity: 2, unitPrice: 1, choices: [{ group: "Sabor", value: "Chocolate" }] }] });
    assert.equal(response.statusCode, 201, response.body);

    const receipt = response.json();
    assert.match(receipt.folio, /^#\d{4}$/);
    assert.equal(receipt.total, 700, "(300 + 50) × 2, sin importar lo que mande el navegador");
    assert.ok(receipt.publicId);
    assert.equal(receipt.customer, undefined, "el recibo no expone datos internos");

    await waitFor(() => notifier.sent.length === 1);
    const [message] = notifier.sent;
    assert.match(message, /Ana López/);
    assert.match(message, /\+52 551 234 5678/);
    assert.match(message, /Oficina centro/);
    assert.match(message, /Sabor: Chocolate/);
    assert.match(message, /\$700\.00/, "los precios llevan .00");
    assert.match(message, /Pastel &amp; especial/, "escapa el HTML");
    assert.match(message, /📅 <b>Para el /, "incluye la fecha de entrega");
    assert.equal(receipt.deliveryDate, isoDate(1));
  });

  test("el mismo requestId no duplica el pedido (doble clic o reintento)", async () => {
    const requestId = newRequestId();
    const first = await postOrder({ requestId });
    const second = await postOrder({ requestId });
    assert.equal(first.statusCode, 201);
    assert.equal(second.json().folio, first.json().folio);
    await sleep(100);
    assert.equal(notifier.sent.length, 1);
  });

  test("acepta nombres reales: acentos, ñ, apóstrofo, punto y guion", async () => {
    for (const name of ["María José Núñez", "Ma. Fernanda O'Neil", "Juan-Pablo Peña Ávila"]) {
      const response = await postOrder({ customer: { name, phone: "+524421234567", email: "Maria.Jose+pedidos@correo.com.mx" } });
      assert.equal(response.statusCode, 201, `${name}: ${response.body}`);
    }
  });

  test("acepta teléfonos de Estados Unidos y Canadá (+1) y los muestra legibles", async () => {
    const response = await postOrder({ customer: { name: "John Smith", phone: "+14155550123", email: "" } });
    assert.equal(response.statusCode, 201, response.body);
    await waitFor(() => notifier.sent.length === 1);
    assert.match(notifier.sent[0], /\+1 \(415\) 555-0123/);
  });

  test("el error de validación dice qué campo y por qué", async () => {
    const response = await postOrder({ customer: { name: "Ana 123", phone: "+525512345678" } });
    assert.equal(response.json().error, "Revisa los datos");
    assert.match(response.json().details[0], /«Nombre» tiene caracteres no permitidos/);
  });

  test("los folios son consecutivos", async () => {
    const a = (await postOrder()).json().number;
    const b = (await postOrder()).json().number;
    assert.equal(b, a + 1);
  });

  test("entrega a domicilio dentro de la zona", async () => {
    const response = await postOrder({
      delivery: {
        type: "home",
        address: { street: "Av. Juárez", exterior: "12", interior: "3", neighborhood: "Centro", postalCode: "76000", city: "querétaro", state: "Querétaro", references: "Portón verde" },
      },
    });
    assert.equal(response.statusCode, 201, response.body);
    await waitFor(() => notifier.sent.length === 1);
    assert.match(notifier.sent[0], /A domicilio/);
    assert.match(notifier.sent[0], /Av\. Juárez #12 int\. 3/);
    assert.match(notifier.sent[0], /google\.com\/maps/);
  });

  test("si Telegram falla, el pedido queda guardado y se reintenta", async () => {
    notifier.failNext = 1;
    const response = await postOrder();
    assert.equal(response.statusCode, 201, "el cliente no se entera de la falla");
    await sleep(100);
    assert.equal(notifier.sent.length, 0);

    // Simula que ya pasó la espera para reintentar.
    await app.mongo.db.collection("orders").updateMany({ "notifications.telegram.status": "failed" }, { $set: { "notifications.telegram.lockedUntil": new Date(0) } });
    const { createOrdersService } = await import("../src/modules/orders/orders.service.js");
    const { createOrdersRepository } = await import("../src/modules/orders/orders.repository.js");
    const { createSiteRepository } = await import("../src/modules/site/site.repository.js");
    const service = createOrdersService({
      repository: createOrdersRepository(app.mongo),
      siteRepository: createSiteRepository(app.mongo),
      notifiers: [notifier],
      log: app.log,
    });
    await service.retryPending();

    assert.equal(notifier.sent.length, 1);
    const order = await app.mongo.db.collection("orders").findOne({ number: response.json().number });
    assert.equal(order.notifications.telegram.status, "sent");
    assert.equal(order.notifications.telegram.attempts, 2);
  });

  test("el comprobante por correo solo se manda si el cliente dejó su correo", async () => {
    const withEmail = await postOrder({ customer: { name: "Ana López", phone: "+525512345678", email: "Ana@Correo.com" } });
    const withoutEmail = await postOrder();
    await waitFor(() => notifier.sent.length === 2);
    await waitFor(() => receiptMail.sent.length === 1);
    assert.match(receiptMail.sent[0], new RegExp(withEmail.json().folio));

    const orders = app.mongo.db.collection("orders");
    assert.equal((await orders.findOne({ number: withEmail.json().number })).customer.email, "ana@correo.com");
    assert.equal((await orders.findOne({ number: withoutEmail.json().number })).notifications.customerEmail.status, "skipped");
  });

  test("si falla el correo, Telegram llega igual (canales independientes)", async () => {
    receiptMail.failNext = 1;
    const response = await postOrder({ customer: { name: "Ana López", phone: "+525512345678", email: "ana@correo.com" } });
    await waitFor(() => notifier.sent.length === 1);
    await sleep(100);
    const order = await app.mongo.db.collection("orders").findOne({ number: response.json().number });
    assert.equal(order.notifications.telegram.status, "sent");
    assert.equal(order.notifications.customerEmail.status, "failed", "se reintentará después");
  });

  test("un error de configuración (p. ej. API key inválida) no se reintenta", async () => {
    receiptMail.failNext = 1;
    receiptMail.failWith = new PermanentError("Resend respondió 401: API key is invalid");
    const response = await postOrder({ customer: { name: "Ana López", phone: "+525512345678", email: "ana@correo.com" } });
    await waitFor(() => notifier.sent.length === 1);
    await sleep(100);
    const order = await app.mongo.db.collection("orders").findOne({ number: response.json().number });
    assert.equal(order.notifications.customerEmail.status, "abandoned");
    assert.match(order.notifications.customerEmail.lastError, /API key is invalid/);
  });

  const rejected = [
    [400, "sin productos", { items: [] }],
    [400, "sin nombre", { customer: { name: "", phone: "+525512345678" } }],
    [400, "un teléfono inválido", { customer: { name: "Ana López", phone: "abc" } }],
    [400, "un correo inválido", { customer: { name: "Ana López", phone: "+525512345678", email: "no-es-correo" } }],
    [400, "cantidad cero", { items: [{ productId: "galletas", quantity: 0 }] }],
    [400, "una opción obligatoria sin elegir", { items: [{ productId: "pastel", quantity: 1 }] }],
    [409, "una alternativa que ya no existe", { items: [{ productId: "pastel", quantity: 1, choices: [{ group: "Sabor", value: "Fresa" }] }] }],
    [409, "una opción que el producto no tiene", { items: [{ productId: "galletas", quantity: 1, choices: [{ group: "Color", value: "Rojo" }] }] }],
    [409, "un producto oculto", { items: [{ productId: "oculto", quantity: 1 }] }],
    [409, "un producto inexistente", { items: [{ productId: "no-existe", quantity: 1 }] }],
    [409, "un lugar de entrega que no existe", { delivery: { type: "point", point: "Luna" } }],
    [400, "un domicilio fuera de la zona", { delivery: { type: "home", address: { street: "X", exterior: "1", neighborhood: "Y", city: "Monterrey", state: "Nuevo León" } } }],
    [400, "un domicilio incompleto", { delivery: { type: "home", address: { street: "X", city: "Querétaro", state: "Querétaro" } } }],
    [400, "«por coordinar» cuando hay opciones de entrega", { delivery: { type: "arrange" } }],
    [400, "el campo trampa lleno (bot)", { website: "http://spam.com" }],
    [400, "un nombre con números", { customer: { name: "Ana 123", phone: "+525512345678" } }],
    [400, "un nombre con HTML", { customer: { name: "<script>alert(1)</script>", phone: "+525512345678" } }],
    [400, "un nombre de más de 80 caracteres", { customer: { name: `Ana ${"a".repeat(80)}`, phone: "5512345678" } }],
    [400, "un teléfono de menos de 10 dígitos", { customer: { name: "Ana López", phone: "+52551234567" } }],
    [400, "un teléfono de más de 10 dígitos", { customer: { name: "Ana López", phone: "+5255123456789" } }],
    [400, "un teléfono sin lada", { customer: { name: "Ana López", phone: "5512345678" } }],
    [400, "una lada que no es de México, EE. UU. ni Canadá", { customer: { name: "Ana López", phone: "+445512345678" } }],
    [400, "un teléfono con letras", { customer: { name: "Ana López", phone: "+52551234567a" } }],
    [400, "un correo sin dominio", { customer: { name: "Ana López", phone: "+525512345678", email: "ana@correo" } }],
    [400, "notas con símbolos peligrosos", { notes: "hola <img src=x onerror=alert(1)>" }],
    [400, "un mensaje personalizado con llaves", { items: [{ productId: "pastel", quantity: 1, choices: [{ group: "Sabor", value: "Vainilla" }, { group: "Mensaje", value: "{{7*7}}" }] }] }],
    [400, "una calle con símbolos", { delivery: { type: "home", address: { street: "Juárez <b>", exterior: "1", neighborhood: "Centro", city: "Querétaro", state: "Querétaro" } } }],
    [400, "sin fecha de entrega", { deliveryDate: undefined }],
    [400, "una fecha que ya pasó", { deliveryDate: isoDate(-3) }],
    [400, "una fecha que no existe", { deliveryDate: "2026-02-30" }],
    [400, "una fecha con formato inválido", { deliveryDate: "14/11/2026" }],
    [400, "una fecha a más de un año", { deliveryDate: isoDate(400) }],
  ];

  for (const [status, label, overrides] of rejected) {
    test(`rechaza ${label} (${status}) sin guardar ni avisar`, async () => {
      const before = await app.mongo.db.collection("orders").countDocuments();
      const response = await postOrder(overrides);
      assert.equal(response.statusCode, status, response.body);
      assert.ok(response.json().error);
      assert.equal(await app.mongo.db.collection("orders").countDocuments(), before);
      assert.equal(notifier.sent.length, 0);
    });
  }
});

describe("mis pedidos", () => {
  const myOrders = (payload) => app.inject({ method: "POST", url: api("/orders/mine"), payload });
  const customer = { name: "Héctor Cervantes", phone: "+524412652301", email: "Cliente.Mis@Pedidos.com" };

  test("devuelve los pedidos de ese correo y teléfono, del más nuevo al más viejo", async () => {
    const first = (await postOrder({ customer })).json();
    const second = (await postOrder({ customer, items: [{ productId: "galletas", quantity: 3 }], notes: "Sin nueces" })).json();
    await postOrder({ customer: { ...customer, email: "otra@persona.com" } });

    // Mayúsculas y formato del teléfono distintos: se normalizan igual que al crear.
    const response = await myOrders({ email: "cliente.mis@pedidos.com", phone: "4412652301" });
    assert.equal(response.statusCode, 200, response.body);
    const { orders } = response.json();
    assert.deepEqual(orders.map((order) => order.folio), [second.folio, first.folio]);

    const [latest] = orders;
    assert.equal(latest.total, 360);
    assert.equal(latest.notes, "Sin nueces");
    assert.equal(latest.delivery.label, "Oficina centro");
    assert.deepEqual(latest.items[0], { productId: "galletas", name: "Galletas", quantity: 3, unitPrice: 120, subtotal: 360, choices: [], note: "" });
    assert.ok(latest.createdAt && latest.deliveryDate);
  });

  test("encuentra también pedidos anteriores guardados sin lada", async () => {
    const created = (await postOrder({ customer: { ...customer, email: "legado@pedidos.com" } })).json();
    // Así se guardaban antes: solo 10 dígitos.
    await app.mongo.db.collection("orders").updateOne({ number: created.number }, { $set: { "customer.phone": "4412652301" } });
    for (const phone of ["+52 441 265 2301", "4412652301"]) {
      const { orders } = (await myOrders({ email: "legado@pedidos.com", phone })).json();
      assert.deepEqual(orders.map((order) => order.folio), [created.folio], phone);
    }
  });

  test("no expone datos internos ni de contacto", async () => {
    await postOrder({ customer });
    const [order] = (await myOrders({ email: customer.email, phone: customer.phone })).json().orders;
    for (const key of ["_id", "requestId", "notifications", "customer", "businessEmail"]) assert.equal(key in order, false, key);
  });

  test("con el teléfono equivocado no devuelve nada", async () => {
    await postOrder({ customer });
    const response = await myOrders({ email: customer.email, phone: "5599998888" });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().orders, []);
  });

  test("exige correo y teléfono válidos", async () => {
    assert.equal((await myOrders({ email: customer.email })).statusCode, 400);
    assert.equal((await myOrders({ email: "no-es-correo", phone: customer.phone })).statusCode, 400);
  });
});

describe("mensaje de Telegram", () => {
  test("marca el total como aproximado si hay precios «desde»", () => {
    const message = formatOrderMessage({
      number: 7,
      currency: "MXN",
      locale: "es-MX",
      customer: { name: "<b>Hack</b>", phone: "5512345678", email: "" },
      delivery: { type: "arrange" },
      items: [{ name: "Pastel", quantity: 1, subtotal: 500, priceFrom: true, choices: [], note: "" }],
      total: 500,
      approximate: true,
      notes: "Sin nueces & sin azúcar",
    });
    assert.match(message, /#0007/);
    assert.match(message, /Total aproximado/);
    assert.match(message, /&lt;b&gt;Hack&lt;\/b&gt;/);
    assert.match(message, /Sin nueces &amp; sin azúcar/);
  });
});

describe("correos", () => {
  const order = {
    number: 12,
    currency: "MXN",
    locale: "es-MX",
    businessName: "Dulce Atelier",
    businessEmail: "hola@dulce.com",
    customer: { name: "Ana <script>", phone: "5512345678", email: "ana@correo.com" },
    deliveryDate: "2026-11-14",
    delivery: { type: "home", address: { street: "Juárez", exterior: "5", neighborhood: "Centro", city: "Querétaro", state: "Querétaro", references: "" } },
    items: [{ name: "Pastel", quantity: 2, subtotal: 700, priceFrom: false, choices: [{ group: "Sabor", value: "Chocolate" }], note: "" }],
    total: 700,
    approximate: false,
    notes: "",
  };

  test("al negocio: folio, cliente y total; responder le contesta al cliente", () => {
    const mail = businessEmail(order);
    assert.match(mail.subject, /#0012/);
    assert.match(mail.subject, /\$700/);
    assert.match(mail.html, /Ana &lt;script&gt;/, "escapa el HTML");
    assert.match(mail.html, /Sabor: Chocolate/);
    assert.match(mail.subject, /para el sábado 14 de noviembre de 2026/);
    assert.equal(mail.replyTo, "ana@correo.com");
  });

  test("usa los colores y el logo del negocio, y miniaturas de los productos", () => {
    const branded = {
      ...order,
      brand: { name: "Dulce Atelier", logoUrl: "https://res.cloudinary.com/demo/image/upload/logo.png", colors: { primary: "#7a1f3d", primaryText: "#ffffff", accent: "#c2410c" } },
      items: [{ ...order.items[0], imageUrl: "https://images.unsplash.com/photo-123?w=1200" }],
    };
    for (const mail of [businessEmail(branded), customerEmail(branded)]) {
      assert.match(mail.html, /background:#7a1f3d/, "encabezado con el color del tema");
      assert.match(mail.html, /<img src="https:\/\/res\.cloudinary\.com\/demo\/image\/upload\/logo\.png"/, "logo");
      assert.match(mail.html, /images\.unsplash\.com\/photo-123\?w=128&amp;h=128&amp;fit=crop/, "miniatura del producto");
    }
  });

  test("sin logo muestra el nombre; pedidos anteriores (sin colores) usan colores neutros", () => {
    const mail = customerEmail({ ...order, brand: undefined });
    assert.match(mail.html, /Dulce Atelier/);
    assert.match(mail.html, /background:#18181b/);
  });

  test("al cliente: solo la tarjeta y el titular para transferir; sin datos, no aparece", () => {
    const payment = { bank: "BBVA", holder: "Ana López", clabe: "032180000118359719", card: "4111111111111111", account: "", phone: "", qrUrl: "", instructions: "Manda tu <comprobante>" };
    const mail = customerEmail({ ...order, brand: { name: "Dulce Atelier", payment } });
    assert.match(mail.html, /Datos para tu pago/);
    assert.match(mail.html, /4111 1111 1111 1111/, "tarjeta en grupos de 4");
    assert.match(mail.html, /Ana López/);
    assert.doesNotMatch(mail.html, /0321 8000/, "con tarjeta no se repite la CLABE");
    assert.match(mail.html, /Manda tu &lt;comprobante&gt;/, "escapa las instrucciones");
    const onlyClabe = customerEmail({ ...order, brand: { payment: { ...payment, card: "" } } });
    assert.match(onlyClabe.html, /0321 8000 0118 3597 19/, "sin tarjeta usa la CLABE");
    assert.doesNotMatch(customerEmail(order).html, /Datos para tu pago/);
    assert.doesNotMatch(businessEmail({ ...order, brand: { payment } }).html, /Datos para tu pago/, "el negocio no necesita sus propios datos");
  });

  test("miniaturas: Unsplash y Cloudinary recortadas; nada de localhost ni http", () => {
    assert.match(thumbnail("https://res.cloudinary.com/x/image/upload/v1/a.webp"), /\/upload\/c_fill,w_128,h_128,q_auto,f_jpg\/v1\/a\.webp$/);
    assert.equal(thumbnail("http://localhost:3000/api/v1/images/abc"), "");
    assert.equal(thumbnail(""), "");
  });

  test("al cliente: comprobante con folio; responder le contesta al negocio", () => {
    const mail = customerEmail(order);
    assert.match(mail.subject, /Recibimos tu pedido #0012/);
    assert.equal(mail.replyTo, "hola@dulce.com");
  });
});

describe("configuración del correo", () => {
  const base = { MONGODB_URI: "x", JWT_SECRET: "x".repeat(48), ADMIN_PASSWORD_HASH: "x", CORS_ORIGINS: "x" };
  const key = `re_${"a".repeat(30)}`;

  test("es opcional", () => {
    assert.equal(loadEnv(base).EMAIL, null);
  });

  test("una configuración válida", () => {
    const env = loadEnv({ ...base, RESEND_API_KEY: key, EMAIL_FROM: "Pedidos <onboarding@resend.dev>", EMAIL_ORDERS_TO: "a@x.com, b@y.com" });
    assert.deepEqual(env.EMAIL.ordersTo, ["a@x.com", "b@y.com"]);
  });

  test("Gmail: contraseña de aplicación (con o sin espacios) y el usuario sale de EMAIL_FROM", () => {
    const env = loadEnv({ ...base, GMAIL_APP_PASSWORD: "abcd efgh ijkl mnop", EMAIL_FROM: "Pedidos <tienda@gmail.com>", EMAIL_ORDERS_TO: "tienda@gmail.com" });
    assert.equal(env.EMAIL.provider, "gmail");
    assert.equal(env.EMAIL.user, "tienda@gmail.com");
    assert.equal(env.EMAIL.appPassword, "abcdefghijklmnop");
  });

  const invalid = [
    ["una API key sin re_", { RESEND_API_KEY: "abc123", EMAIL_FROM: "a@x.com" }, /re_/],
    ["una contraseña de Gmail que no es de aplicación", { GMAIL_APP_PASSWORD: "MiClave123!", EMAIL_FROM: "a@gmail.com" }, /16 letras/],
    ["sin remitente", { RESEND_API_KEY: key }, /EMAIL_FROM/],
    ["un destinatario inválido", { RESEND_API_KEY: key, EMAIL_FROM: "a@x.com", EMAIL_ORDERS_TO: "no-es-correo" }, /EMAIL_ORDERS_TO/],
  ];
  for (const [label, values, message] of invalid) {
    test(`${label}: desactiva el correo pero el API arranca`, () => {
      const env = loadEnv({ ...base, ...values });
      assert.equal(env.EMAIL, null);
      assert.match(env.EMAIL_ERROR, message);
    });
  }
});

describe("configuración de Telegram", () => {
  const base = { MONGODB_URI: "x", JWT_SECRET: "x".repeat(48), ADMIN_PASSWORD_HASH: "x", CORS_ORIGINS: "x" };

  test("es opcional", () => {
    assert.equal(loadEnv(base).TELEGRAM, null);
  });

  test("exige token y chat juntos", () => {
    assert.throws(() => loadEnv({ ...base, TELEGRAM_BOT_TOKEN: "123:abc" }), /TELEGRAM_CHAT_ID/);
  });

  test("valida el formato del token", () => {
    assert.throws(() => loadEnv({ ...base, TELEGRAM_BOT_TOKEN: "token-falso", TELEGRAM_CHAT_ID: "1" }), /BotFather/);
    const env = loadEnv({ ...base, TELEGRAM_BOT_TOKEN: `123456:${"A".repeat(35)}`, TELEGRAM_CHAT_ID: "-100123" });
    assert.equal(env.TELEGRAM.chatId, "-100123");
  });
});

describe("anticipos, comprobantes y estados", () => {
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
  const auth = () => ({ authorization: `Bearer ${token}` });
  const uploadProof = (publicId, body = PNG, type = "image/png") =>
    app.inject({ method: "POST", url: api(`/orders/${publicId}/proof`), headers: { "content-type": type }, payload: body });
  const setStatus = (number, status) => app.inject({ method: "PATCH", url: api(`/admin/orders/${number}/status`), headers: auth(), payload: { status } });
  const encargo = (quantity = 1) => [{ productId: "encargo", quantity }];

  test("un producto con anticipo deja el pedido esperando el pago, con plazo", async () => {
    const response = await postOrder({ items: [...encargo(2), { productId: "boda", quantity: 1 }, { productId: "galletas", quantity: 1 }] });
    assert.equal(response.statusCode, 201, response.body);
    const receipt = response.json();
    // 50 % de 800 + 300 fijos; las galletas no piden anticipo.
    assert.equal(receipt.deposit, 700);
    assert.equal(receipt.status, "awaiting_deposit");
    const hours = (new Date(receipt.depositDueAt) - new Date(receipt.createdAt)) / 3_600_000;
    assert.equal(Math.round(hours), 24);
  });

  test("sin productos con anticipo, el pedido es «nuevo» y sin plazo", async () => {
    const receipt = (await postOrder({ items: [{ productId: "galletas", quantity: 1 }] })).json();
    assert.equal(receipt.deposit, 0);
    assert.equal(receipt.status, "new");
    assert.equal(receipt.depositDueAt, null);
  });

  test("el aviso de Telegram dice cuánto anticipo esperar", async () => {
    await postOrder({ items: encargo() });
    await waitFor(() => notifier.sent.length === 1);
    assert.match(notifier.sent[0], /Anticipo: \$200\.00/);
    assert.match(notifier.sent[0], /resta \$200\.00/);
  });

  test("el cliente sube su comprobante; solo el admin lo puede ver", async () => {
    messengers.proofs = [];
    const receipt = (await postOrder({ items: encargo() })).json();
    const uploaded = await uploadProof(receipt.publicId);
    assert.equal(uploaded.statusCode, 201, uploaded.body);
    assert.equal(uploaded.json().proofCount, 1);
    assert.deepEqual(messengers.proofs, [receipt.number], "avisa al negocio");

    const list = (await app.inject({ method: "GET", url: api("/admin/orders?status=awaiting_deposit"), headers: auth() })).json();
    const order = list.orders.find((item) => item.number === receipt.number);
    assert.equal(order.proofs.length, 1);
    const proofUrl = api(`/admin/orders/proofs/${order.proofs[0].id}`);
    assert.equal((await app.inject({ method: "GET", url: proofUrl })).statusCode, 401, "sin sesión no se ve");
    const image = await app.inject({ method: "GET", url: proofUrl, headers: auth() });
    assert.equal(image.statusCode, 200);
    assert.equal(image.headers["content-type"], "image/png");
    assert.match(image.headers["cache-control"], /no-store/);
  });

  test("rechaza comprobantes que no son imagen, de más o de pedidos inexistentes", async () => {
    const receipt = (await postOrder({ items: encargo() })).json();
    assert.equal((await uploadProof(receipt.publicId, Buffer.from("<script>alert(1)</script>"), "image/png")).statusCode, 415, "firma falsa");
    for (let index = 0; index < 3; index++) assert.equal((await uploadProof(receipt.publicId)).statusCode, 201);
    assert.equal((await uploadProof(receipt.publicId)).statusCode, 409, "máximo 3");
    assert.equal((await uploadProof("00000000-0000-4000-8000-000000000000")).statusCode, 404);
  });

  test("confirmar marca el anticipo como pagado y avisa al cliente; luego se entrega", async () => {
    messengers.statuses = [];
    const receipt = (await postOrder({ items: encargo() })).json();
    const confirmed = await setStatus(receipt.number, "confirmed");
    assert.equal(confirmed.statusCode, 200, confirmed.body);
    assert.equal(confirmed.json().status, "confirmed");
    assert.ok(confirmed.json().depositPaidAt);
    assert.deepEqual(confirmed.json().nextStatuses, ["delivered", "cancelled"]);
    assert.equal((await setStatus(receipt.number, "delivered")).json().status, "delivered");
    assert.deepEqual(messengers.statuses, [`${receipt.number}:confirmed`, `${receipt.number}:delivered`]);
  });

  test("no permite saltos inválidos ni revivir un pedido cancelado", async () => {
    const receipt = (await postOrder({ items: encargo() })).json();
    assert.equal((await setStatus(receipt.number, "delivered")).statusCode, 409, "no se entrega sin confirmar");
    assert.equal((await setStatus(receipt.number, "cancelled")).statusCode, 200);
    assert.equal((await setStatus(receipt.number, "confirmed")).statusCode, 409);
    assert.equal((await uploadProof(receipt.publicId)).statusCode, 409, "un cancelado ya no recibe comprobantes");
    assert.equal((await setStatus(999_999, "confirmed")).statusCode, 404);
  });

  test("la lista del admin exige sesión, filtra y cuenta por estado", async () => {
    assert.equal((await app.inject({ method: "GET", url: api("/admin/orders") })).statusCode, 401);
    const result = (await app.inject({ method: "GET", url: api("/admin/orders?status=open"), headers: auth() })).json();
    assert.ok(result.orders.length > 0);
    assert.ok(result.orders.every((order) => ["awaiting_deposit", "new", "confirmed"].includes(order.status)));
    assert.ok(result.counts.awaiting_deposit > 0);
    assert.equal(result.orders[0].requestId, undefined, "sin datos internos");
  });

  test("«Mis pedidos» muestra estado, anticipo y comprobantes del cliente", async () => {
    const customer = { name: "Ana López", phone: "+525598765432", email: "ana.anticipo@correo.com" };
    const receipt = (await postOrder({ customer, items: encargo() })).json();
    await uploadProof(receipt.publicId);
    const mine = (await app.inject({ method: "POST", url: api("/orders/mine"), payload: { email: customer.email, phone: customer.phone } })).json();
    const order = mine.orders.find((item) => item.publicId === receipt.publicId);
    assert.equal(order.status, "awaiting_deposit");
    assert.equal(order.deposit, 200);
    assert.equal(order.proofCount, 1);
  });

  test("el comprobante del cliente muestra el anticipo y los pasos para pagar", () => {
    const mail = customerEmail({
      number: 7,
      customer: { name: "Ana", phone: "+525512345678", email: "a@b.com" },
      delivery: { type: "arrange" },
      items: [],
      total: 800,
      deposit: 400,
      depositDueAt: new Date("2026-11-10T19:00:00Z"),
      currency: "MXN",
      locale: "es-MX",
    });
    assert.match(mail.subject, /falta tu anticipo/);
    assert.match(mail.html, /\$400\.00/);
    assert.match(mail.html, /1:00 p\.m\./, "hora de México");
  });
});
