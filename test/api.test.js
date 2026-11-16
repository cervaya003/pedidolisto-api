import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { API_PREFIX, buildApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";
import { hashPassword } from "../src/lib/password.js";

const PASSWORD = "contraseña-de-prueba";
const ALLOWED_ORIGIN = "http://localhost:5173";

let mongo;
let app;
let token;

const api = (path) => `${API_PREFIX}${path}`;
const authHeader = () => ({ authorization: `Bearer ${token}` });

async function getAdminSite() {
  const response = await app.inject({ method: "GET", url: api("/admin/site"), headers: authHeader() });
  return response.json();
}

const saveSite = (payload) => app.inject({ method: "PUT", url: api("/admin/site"), headers: authHeader(), payload });

before(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const env = loadEnv({
    NODE_ENV: "test",
    MONGODB_URI: mongo.getUri(),
    MONGODB_DB_NAME: "catalogo_test",
    JWT_SECRET: "x".repeat(48),
    ADMIN_PASSWORD_HASH: await hashPassword(PASSWORD),
    CORS_ORIGINS: ALLOWED_ORIGIN,
    LOGIN_MAX_ATTEMPTS: "20",
  });
  app = await buildApp(env);
});

after(async () => {
  await app?.close();
  await mongo?.stop();
});

describe("configuración", () => {
  test("rechaza arrancar sin variables obligatorias", () => {
    assert.throws(() => loadEnv({}), /Faltan variables de entorno/);
  });

  test("rechaza un JWT_SECRET corto", () => {
    assert.throws(
      () => loadEnv({ MONGODB_URI: "x", JWT_SECRET: "corto", ADMIN_PASSWORD_HASH: "x", CORS_ORIGINS: "x" }),
      /JWT_SECRET/,
    );
  });
});

describe("público", () => {
  test("GET /health responde ok", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: "ok" });
  });

  test("GET /meta entrega el catálogo de opciones", async () => {
    const response = await app.inject({ method: "GET", url: api("/meta") });
    assert.equal(response.statusCode, 200);
    assert.ok(response.json().fonts.length > 0);
    assert.ok(response.json().sectionDefaults.menu);
  });

  test("GET /site con la base vacía entrega el contenido inicial", async () => {
    const response = await app.inject({ method: "GET", url: api("/site") });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().business.name, "Dulce Atelier");
  });

  test("CORS solo permite los orígenes configurados", async () => {
    const allowed = await app.inject({ method: "GET", url: api("/site"), headers: { origin: ALLOWED_ORIGIN } });
    const denied = await app.inject({ method: "GET", url: api("/site"), headers: { origin: "https://malicioso.com" } });
    assert.equal(allowed.headers["access-control-allow-origin"], ALLOWED_ORIGIN);
    assert.equal(denied.headers["access-control-allow-origin"], undefined);
  });

  test("incluye cabeceras de seguridad", async () => {
    const response = await app.inject({ method: "GET", url: api("/site") });
    assert.equal(response.headers["x-content-type-options"], "nosniff");
  });

  test("ruta inexistente responde 404 en JSON", async () => {
    const response = await app.inject({ method: "GET", url: api("/nada") });
    assert.equal(response.statusCode, 404);
    assert.equal(response.json().error, "Recurso no encontrado");
  });
});

describe("autenticación", () => {
  test("contraseña incorrecta responde 401", async () => {
    const response = await app.inject({ method: "POST", url: api("/auth/login"), payload: { password: "otra" } });
    assert.equal(response.statusCode, 401);
  });

  test("contraseña correcta entrega un token", async () => {
    const response = await app.inject({ method: "POST", url: api("/auth/login"), payload: { password: PASSWORD } });
    assert.equal(response.statusCode, 200);
    token = response.json().token;
    assert.ok(token);
  });

  test("las rutas de admin exigen token", async () => {
    const response = await app.inject({ method: "GET", url: api("/admin/site") });
    assert.equal(response.statusCode, 401);
  });

  test("un token alterado se rechaza", async () => {
    const response = await app.inject({ method: "GET", url: api("/admin/site"), headers: { authorization: `Bearer ${token}x` } });
    assert.equal(response.statusCode, 401);
  });
});

describe("guardar el sitio", () => {
  test("publica los cambios y oculta los productos inactivos", async () => {
    const site = await getAdminSite();
    site.business.name = "Tacos El Güero";
    site.theme.fonts.heading = "Bebas Neue";
    site.theme.template = "market";
    site.products[0].active = false;

    const response = await saveSite(site);
    assert.equal(response.statusCode, 200);

    const published = (await app.inject({ method: "GET", url: api("/site") })).json();
    assert.equal(published.business.name, "Tacos El Güero");
    assert.equal(published.theme.fonts.heading, "Bebas Neue");
    assert.equal(published.theme.template, "market");
    assert.equal(published.products.length, site.products.length - 1);
  });

  test("guarda la personalización del producto", async () => {
    const site = await getAdminSite();
    Object.assign(site.products[0], {
      ingredients: ["Harina", "Mantequilla"],
      gallery: ["https://res.cloudinary.com/demo/image/upload/a.webp", "/images/b.webp"],
      customizable: true,
      allowNotes: true,
      options: [
        { name: "Sabor", type: "single", required: true, choices: [{ label: "Vainilla" }, { label: "Chocolate", price: 50 }] },
        { name: "Mensaje", type: "text" },
      ],
    });
    assert.equal((await saveSite(site)).statusCode, 200);
    const saved = (await getAdminSite()).products[0];
    assert.deepEqual(saved.ingredients, ["Harina", "Mantequilla"]);
    assert.equal(saved.gallery.length, 2);
    assert.equal(saved.options[0].choices[0].price, 0, "el precio extra por defecto es 0");
    assert.equal(saved.options[1].required, false);
    assert.deepEqual(saved.options[1].choices, []);
  });

  test("elimina campos que no están en el contrato", async () => {
    const site = await getAdminSite();
    site.business.$where = "inyección";
    assert.equal((await saveSite(site)).statusCode, 200);
    assert.equal((await getAdminSite()).business.$where, undefined);
  });

  test("guarda los datos para transferencia y los publica", async () => {
    const site = await getAdminSite();
    assert.equal(site.business.payment.enabled, false, "desactivado por defecto");
    site.business.payment = { ...site.business.payment, enabled: true, bank: "BBVA", holder: "Ana López", clabe: "032180000118359719", card: "4111111111111111" };
    assert.equal((await saveSite(site)).statusCode, 200);
    const published = (await app.inject({ method: "GET", url: api("/site") })).json();
    assert.equal(published.business.payment.clabe, "032180000118359719");
  });

  test("un sitio guardado antes de existir los pagos recibe los valores por defecto", async () => {
    const site = await getAdminSite();
    delete site.business.payment;
    assert.equal((await saveSite(site)).statusCode, 200);
    assert.equal((await getAdminSite()).business.payment.enabled, false);
  });

  const withPayment = (fields) => (site) => (site.business.payment = { ...site.business.payment, enabled: true, holder: "Ana López", ...fields });

  const invalidCases = [
    ["una CLABE con dígito verificador incorrecto", withPayment({ clabe: "032180000118359718" })],
    ["una CLABE incompleta", withPayment({ clabe: "03218000011835" })],
    ["una CLABE con letras", withPayment({ clabe: "03218000011835971a" })],
    ["una tarjeta que no pasa la prueba de Luhn", withPayment({ card: "4111111111111112" })],
    ["pagos activados sin ningún dato para pagar", withPayment({ clabe: "", card: "", account: "", phone: "", qrUrl: "" })],
    ["pagos activados sin titular", withPayment({ clabe: "032180000118359719", holder: " " })],
    [
      "un producto con anticipo sin datos para transferir",
      (site) => {
        site.business.payment = { ...site.business.payment, enabled: false };
        Object.assign(site.products[0], { depositType: "percent", depositValue: 50 });
      },
    ],
    [
      "un anticipo de más de 100 %",
      (site) => {
        withPayment({ clabe: "032180000118359719" })(site);
        Object.assign(site.products[0], { depositType: "percent", depositValue: 150 });
      },
    ],
    [
      "un anticipo fijo en cero",
      (site) => {
        withPayment({ clabe: "032180000118359719" })(site);
        Object.assign(site.products[0], { depositType: "fixed", depositValue: 0 });
      },
    ],
    ["un tipo de anticipo inexistente", (site) => (site.products[0].depositType = "todo")],
    ["un color inválido", (site) => (site.theme.colors.primary = "rojo")],
    ["una plantilla que no existe", (site) => (site.theme.template = "inventada")],
    ["una fuente fuera del catálogo", (site) => (site.theme.fonts.body = "Comic Sans")],
    ["un precio negativo", (site) => (site.products[0].price = -1)],
    ["una URL javascript:", (site) => (site.products[0].imageUrl = "javascript:alert(1)")],
    ["un WhatsApp con letras", (site) => (site.business.whatsapp = "55-abc")],
    ["un correo del negocio sin dominio", (site) => (site.business.email = "hola@negocio")],
    ["un nombre de producto con HTML", (site) => (site.products[0].name = "<script>x</script>")],
    ["un texto con caracteres de control", (site) => (site.business.tagline = "hola\u0000mundo")],
    ["un producto sin categoría válida", (site) => (site.products[0].categoryId = "no-existe")],
    [
      "más de 10 productos en favoritos",
      (site) => {
        const extra = Array.from({ length: 11 }, (_, index) => ({ ...site.products[0], id: `extra-${index}` }));
        site.products = [...site.products, ...extra].map((product) => ({ ...product, featured: true }));
      },
    ],
    [
      "una opción de elegir sin alternativas en un producto personalizable",
      (site) => Object.assign(site.products[0], { customizable: true, options: [{ name: "Sabor", type: "single", choices: [] }] }),
    ],
    [
      "dos opciones con el mismo nombre",
      (site) =>
        Object.assign(site.products[0], {
          customizable: true,
          options: [
            { name: "Sabor", type: "text" },
            { name: "sabor", type: "text" },
          ],
        }),
    ],
    ["más de 5 fotos en un producto", (site) => (site.products[0].gallery = Array.from({ length: 5 }, (_, i) => `https://x.com/${i}.webp`))],
    ["una foto con URL javascript: en la galería", (site) => (site.products[0].gallery = ["javascript:alert(1)"])],
    ["un tipo de opción inexistente", (site) => (site.products[0].options = [{ name: "X", type: "inventado" }])],
    ["ids de producto duplicados", (site) => (site.products[1].id = site.products[0].id)],
    ["el nombre del negocio vacío", (site) => (site.business.name = "")],
  ];

  for (const [label, mutate] of invalidCases) {
    test(`rechaza ${label} sin modificar lo publicado`, async () => {
      const before = await getAdminSite();
      const site = structuredClone(before);
      mutate(site);

      const response = await saveSite(site);
      assert.equal(response.statusCode, 400);
      assert.deepEqual(await getAdminSite(), before);
    });
  }
});

describe("imágenes", () => {
  // PNG real de 1×1 píxel.
  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
  const upload = (payload, contentType, headers = authHeader()) =>
    app.inject({ method: "POST", url: api("/admin/images"), headers: { ...headers, "content-type": contentType }, payload });

  test("subir exige token", async () => {
    const response = await upload(PNG, "image/png", {});
    assert.equal(response.statusCode, 401);
  });

  test("sube una imagen y se puede ver públicamente con caché largo", async () => {
    const response = await upload(PNG, "image/png");
    assert.equal(response.statusCode, 201);
    const { url: path } = response.json();
    assert.match(path, /^\/images\/[a-f0-9]{24}$/);

    const image = await app.inject({ method: "GET", url: api(path) });
    assert.equal(image.statusCode, 200);
    assert.equal(image.headers["content-type"], "image/png");
    assert.match(image.headers["cache-control"], /immutable/);
    assert.deepEqual(image.rawPayload, PNG);
  });

  test("rechaza un archivo que no es imagen aunque diga serlo", async () => {
    const response = await upload(Buffer.from("<script>alert(1)</script>"), "image/png");
    assert.equal(response.statusCode, 415);
  });

  test("rechaza tipos no permitidos", async () => {
    const response = await upload(Buffer.from("GIF89a"), "image/gif");
    assert.equal(response.statusCode, 415);
  });

  test("una imagen inexistente responde 404", async () => {
    const response = await app.inject({ method: "GET", url: api(`/images/${"a".repeat(24)}`) });
    assert.equal(response.statusCode, 404);
  });
});
