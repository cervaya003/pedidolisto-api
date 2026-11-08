// Reglas del pedido sin base de datos: valida contra el catálogo publicado y calcula precios.
// Mismo formato de personalización que el carrito: [{ group: "Sabor", value: "Vainilla" }, …].
import { httpError } from "../../lib/httpError.js";

const clean = (value = "") => value.trim().replace(/\s+/g, " ");
const sameText = (a = "", b = "") => clean(a).toLowerCase() === clean(b).toLowerCase();

// 409: el carrito del cliente quedó viejo (el dueño cambió el producto después de que lo agregó).
const staleCart = (productName) =>
  httpError(409, `«${productName}» cambió desde que lo agregaste. Quítalo del carrito y vuelve a agregarlo.`);

function resolveChoices(product, item) {
  const options = product.customizable ? (product.options ?? []) : [];
  const known = new Set(options.map((option) => option.name));
  if (item.choices.some((choice) => !known.has(choice.group))) throw staleCart(product.name);

  return options.flatMap((option) => {
    const picked = item.choices.filter((choice) => choice.group === option.name);
    if (option.required && !picked.some((choice) => clean(choice.value))) {
      throw httpError(400, `Falta elegir «${option.name}» en «${product.name}»`);
    }

    if (option.type === "text") {
      const value = clean(picked[0]?.value);
      return value ? [{ group: option.name, value, price: 0 }] : [];
    }

    if (option.type === "single" && picked.length > 1) throw staleCart(product.name);
    const values = new Set(picked.map((choice) => choice.value));
    if (values.size !== picked.length) throw staleCart(product.name);
    // En el orden en que el dueño definió las alternativas.
    const chosen = option.choices.filter((choice) => values.has(choice.label));
    if (chosen.length !== values.size) throw staleCart(product.name);
    return chosen.map((choice) => ({ group: option.name, value: choice.label, price: choice.price ?? 0 }));
  });
}

/** Líneas del pedido con nombre y precio vigentes. `products` son solo los visibles. */
export function buildItems(products, items) {
  const byId = new Map(products.map((product) => [product.id, product]));

  return items.map((item) => {
    const product = byId.get(item.productId);
    if (!product) throw httpError(409, "Uno de los productos de tu carrito ya no está disponible. Revisa tu carrito.");

    const choices = resolveChoices(product, item);
    const unitPrice = product.price + choices.reduce((sum, choice) => sum + choice.price, 0);
    return {
      productId: product.id,
      name: product.name,
      quantity: item.quantity,
      unitPrice,
      subtotal: unitPrice * item.quantity,
      priceFrom: Boolean(product.priceFrom),
      // Foto para la miniatura del correo.
      imageUrl: product.imageUrl ?? "",
      choices,
      note: product.customizable && product.allowNotes ? clean(item.note) : "",
    };
  });
}

/** Valida la forma de entrega contra lo que configuró el negocio y la deja normalizada. */
export function resolveDelivery(business, delivery) {
  const points = business.deliveryPoints ?? [];
  const areas = business.deliveryAreas ?? [];
  const homeDelivery = Boolean(business.homeDelivery);

  if (delivery.type === "point") {
    const point = points.find((item) => sameText(item.name, delivery.point));
    if (!point) throw httpError(409, "Ese lugar de entrega ya no está disponible. Elige otro.");
    return { type: "point", point: { name: point.name, details: point.details ?? "" } };
  }

  if (delivery.type === "home") {
    if (!homeDelivery) throw httpError(409, "Por ahora no tenemos entrega a domicilio. Elige otro lugar de entrega.");

    const address = Object.fromEntries(Object.entries(delivery.address ?? {}).map(([key, value]) => [key, clean(value)]));
    const missing = [
      ["street", "la calle"],
      ["exterior", "el número exterior"],
      ["neighborhood", "la colonia"],
      ["city", "la ciudad"],
    ].find(([key]) => !address[key]);
    if (missing) throw httpError(400, `Falta ${missing[1]} de tu domicilio`);

    if (areas.length) {
      const area = areas.find((item) => sameText(item.city, address.city) && (!item.state || sameText(item.state, address.state)));
      if (!area) throw httpError(400, `Solo entregamos a domicilio en: ${areas.map((item) => item.city).join(", ")}`);
      address.city = area.city;
      address.state = area.state ?? "";
    }
    return { type: "home", address };
  }

  // «Por coordinar» solo cuando el negocio no ofrece ni lugares ni domicilio.
  if (points.length || homeDelivery) throw httpError(400, "Elige dónde quieres recibir tu pedido");
  return { type: "arrange" };
}

const DAY_MS = 24 * 60 * 60 * 1000;
// El cliente puede estar en otra zona horaria que el servidor: se acepta desde «ayer» en UTC
// (nadie en América puede elegir un día que ya pasó en su país y que sea anterior a eso).
const PAST_TOLERANCE_DAYS = 1;
export const MAX_DAYS_AHEAD = 365;

/** Valida la fecha de entrega: real, no pasada y a menos de un año. Devuelve "AAAA-MM-DD". */
export function resolveDeliveryDate(value, now = new Date()) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw httpError(400, "La fecha de entrega no es válida");
  }
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (date.getTime() < today - PAST_TOLERANCE_DAYS * DAY_MS) throw httpError(400, "La fecha de entrega ya pasó. Elige hoy o un día posterior.");
  if (date.getTime() > today + MAX_DAYS_AHEAD * DAY_MS) throw httpError(400, "Elige una fecha dentro del próximo año");
  return value;
}

// Ladas aceptadas: México (+52, por defecto), Estados Unidos y Canadá (+1). Siempre 10 dígitos.
export const PHONE_PATTERN = /^\+(?:52|1)\d{10}$/;

/**
 * Teléfono en formato internacional: "+524421234567". Sin lada (10 dígitos) se asume México.
 * Así se puede tocar para llamar y se compara igual en «Mis pedidos».
 */
export function normalizePhone(phone) {
  const digits = phone.replace(/\D/g, "");
  if (phone.trim().startsWith("+")) return `+${digits}`;
  return digits.length === 10 ? `+52${digits}` : `+${digits}`;
}

/** Los 10 dígitos locales (pedidos anteriores se guardaron así, sin lada). */
export const localPhone = (phone) => phone.replace(/\D/g, "").slice(-10);

export const normalizeCustomer = ({ name, phone, email }) => ({
  name: clean(name),
  phone: normalizePhone(phone),
  email: clean(email).toLowerCase(),
});

export const cleanText = clean;
