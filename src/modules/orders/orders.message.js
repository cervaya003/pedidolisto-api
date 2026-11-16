// Mensaje que recibe el negocio. Formato HTML de Telegram: todo texto del cliente se escapa.
const FALLBACK_REGION = { locale: "es-MX", currency: "MXN" };

const escape = (value = "") => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function priceFormatter({ locale, currency }) {
  try {
    // Decimales de la moneda (MXN, USD, EUR: 2 → «$650.00»).
    return new Intl.NumberFormat(locale, { style: "currency", currency });
  } catch {
    return new Intl.NumberFormat(FALLBACK_REGION.locale, { style: "currency", currency: FALLBACK_REGION.currency });
  }
}

/** "sábado 12 de diciembre de 2026" (la fecha llega como AAAA-MM-DD y se lee tal cual, sin zona horaria). */
export function formatDeliveryDate(value, locale = FALLBACK_REGION.locale) {
  if (!value) return "";
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const options = { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" };
  try {
    return date.toLocaleDateString(locale, options).replace(",", "");
  } catch {
    return date.toLocaleDateString(FALLBACK_REGION.locale, options).replace(",", "");
  }
}

/** "+524421234567" → "+52 442 123 4567"; "+14155550123" → "+1 (415) 555-0123". */
export function formatPhone(phone = "") {
  const mexico = phone.match(/^\+52(\d{3})(\d{3})(\d{4})$/);
  if (mexico) return `+52 ${mexico[1]} ${mexico[2]} ${mexico[3]}`;
  const northAmerica = phone.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  if (northAmerica) return `+1 (${northAmerica[1]}) ${northAmerica[2]}-${northAmerica[3]}`;
  return phone;
}

// Zona horaria del negocio para fechas con hora (el servidor puede correr en UTC).
export const BUSINESS_TIME_ZONE = "America/Mexico_City";

/** "lunes, 10 de noviembre, 1:00 p.m." en la hora del negocio. */
export function formatDateTime(value, locale = FALLBACK_REGION.locale) {
  if (!value) return "";
  const options = { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit", timeZone: BUSINESS_TIME_ZONE };
  try {
    return new Date(value).toLocaleString(locale, options);
  } catch {
    return new Date(value).toLocaleString(FALLBACK_REGION.locale, options);
  }
}

export const formatFolio = (number) => `#${String(number).padStart(4, "0")}`;

export function formatAddress(address) {
  const street = [address.street, address.exterior && `#${address.exterior}`, address.interior && `int. ${address.interior}`].filter(Boolean).join(" ");
  const area = [address.neighborhood && `Col. ${address.neighborhood}`, address.postalCode && `C.P. ${address.postalCode}`].filter(Boolean).join(", ");
  const city = [address.city, address.state].filter(Boolean).join(", ");
  return [street, area, city].filter(Boolean).join(", ");
}

const mapsLink = (address) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(formatAddress(address))}`;

function deliveryLines(delivery) {
  if (delivery.type === "point") {
    return [`📍 <b>Entrega en:</b> ${escape(delivery.point.name)}`, delivery.point.details ? `   ${escape(delivery.point.details)}` : null];
  }
  if (delivery.type === "home") {
    const { address } = delivery;
    return [
      "🏠 <b>A domicilio</b>",
      `   ${escape(formatAddress(address))}`,
      address.references ? `   Referencias: ${escape(address.references)}` : null,
      `   <a href="${escape(mapsLink(address))}">Ver en el mapa</a>`,
    ];
  }
  return ["📍 <b>Entrega:</b> por coordinar con el cliente"];
}

export function formatOrderMessage(order) {
  const price = priceFormatter(order);
  const { customer } = order;

  const items = order.items.flatMap((item) => [
    `• ${item.quantity} × ${escape(item.name)} — ${price.format(item.subtotal)}${item.priceFrom ? " (desde)" : ""}`,
    ...item.choices.map((choice) => `   ◦ ${escape(choice.group)}: ${escape(choice.value)}`),
    item.note ? `   ◦ Indicaciones: ${escape(item.note)}` : null,
  ]);

  return [
    `🛒 <b>Nuevo pedido ${formatFolio(order.number)}</b>`,
    "",
    `👤 <b>${escape(customer.name)}</b>`,
    `📞 ${escape(formatPhone(customer.phone))}`,
    customer.email ? `✉️ ${escape(customer.email)}` : null,
    "",
    order.deliveryDate ? `📅 <b>Para el ${escape(formatDeliveryDate(order.deliveryDate, order.locale))}</b>` : null,
    ...deliveryLines(order.delivery),
    "",
    "🧾 <b>Productos</b>",
    ...items,
    "",
    `💰 <b>Total${order.approximate ? " aproximado" : ""}: ${price.format(order.total)}</b>`,
    ...depositLines(order, price),
    order.notes ? `\n📝 <b>Notas:</b> ${escape(order.notes)}` : null,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

function depositLines(order, price) {
  if (!(order.deposit > 0)) return [];
  return [
    `💳 <b>Anticipo: ${price.format(order.deposit)}</b> · resta ${price.format(order.total - order.deposit)}`,
    `⏳ Esperando anticipo hasta el ${escape(formatDateTime(order.depositDueAt, order.locale))}`,
    "   Confírmalo en el admin → Pedidos cuando lo veas en tu banco.",
  ];
}

/** Aviso al negocio: el cliente subió un comprobante. */
export function formatProofMessage(order) {
  const price = priceFormatter(order);
  return [
    `📎 <b>Comprobante recibido · pedido ${formatFolio(order.number)}</b>`,
    `👤 ${escape(order.customer.name)}`,
    order.deposit > 0 ? `💳 Anticipo esperado: <b>${price.format(order.deposit)}</b>` : `💰 Total: <b>${price.format(order.total)}</b>`,
    "",
    "Revisa en tu app del banco que el dinero sí llegó y confírmalo en el admin → Pedidos.",
  ].join("\n");
}
