// Correos del pedido: aviso al negocio y comprobante para el cliente.
// Diseño con tablas y estilos en línea (lo único que respetan Gmail, Outlook y Apple Mail), con los colores
// y el logo del negocio guardados en el pedido (`order.brand`) y miniaturas de los productos.
// Todo texto que viene del cliente o del negocio se escapa.
import { formatAddress, formatDateTime, formatDeliveryDate, formatFolio, formatPhone, priceFormatter } from "./orders.message.js";

const escape = (value = "") => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const WIDTH = 640;
const THUMB = 64;
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const DEFAULT_COLORS = { primary: "#18181b", primaryText: "#ffffff", accent: "#18181b", background: "#ffffff", surface: "#f4f4f5", text: "#18181b", muted: "#71717a" };

const isHex = (value) => /^#[0-9a-f]{6}$/i.test(value ?? "");

/** Colores del tema guardados en el pedido; si faltan (pedidos anteriores), los neutros. */
function palette(order) {
  const brand = order.brand?.colors ?? {};
  return Object.fromEntries(Object.entries(DEFAULT_COLORS).map(([key, fallback]) => [key, isHex(brand[key]) ? brand[key] : fallback]));
}

/** Versión clara de un color (mezclado con blanco): los correos no soportan rgba de forma fiable. */
function tint(hex, amount) {
  const value = Number.parseInt(hex.slice(1), 16);
  const mix = (channel) => Math.round(255 - (255 - channel) * amount);
  return `#${[(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => mix(channel).toString(16).padStart(2, "0")).join("")}`;
}

/** Miniatura cuadrada. Solo URLs https públicas: Gmail no puede descargar fotos de localhost. */
export function thumbnail(url, size = THUMB * 2) {
  if (!/^https:\/\//.test(url ?? "")) return "";
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "images.unsplash.com") {
      for (const [key, value] of Object.entries({ w: size, h: size, fit: "crop", q: 70, fm: "jpg" })) parsed.searchParams.set(key, value);
      return parsed.toString();
    }
    if (parsed.hostname === "res.cloudinary.com" && parsed.pathname.includes("/upload/")) {
      return url.replace("/upload/", `/upload/c_fill,w_${size},h_${size},q_auto,f_jpg/`);
    }
    return url;
  } catch {
    return "";
  }
}

function deliveryParts(delivery) {
  if (delivery.type === "point") return { icon: "📍", title: delivery.point.name, detail: delivery.point.details };
  if (delivery.type === "home") {
    return {
      icon: "🏠",
      title: "A domicilio",
      detail: [formatAddress(delivery.address), delivery.address.references && `Ref.: ${delivery.address.references}`].filter(Boolean).join(" · "),
    };
  }
  return { icon: "🤝", title: "Por coordinar", detail: "Te contactaremos para acordar la entrega." };
}

const mapsLink = (address) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(formatAddress(address))}`;

// ── Piezas del diseño ──────────────────────────────────────────────────────────────────────────

function header(order, colors) {
  const brand = order.brand ?? {};
  const name = escape(brand.name || order.businessName || "Tu pedido");
  const logo = /^https:\/\//.test(brand.logoUrl ?? "")
    ? `<img src="${escape(brand.logoUrl)}" alt="${name}" height="44" style="display:block;height:44px;max-width:220px;width:auto;border:0;margin:0 auto">`
    : `<div style="font-size:24px;font-weight:700;letter-spacing:-.01em;color:${colors.primaryText}">${name}</div>`;
  return `<tr><td align="center" style="background:${colors.primary};padding:28px 32px;border-radius:16px 16px 0 0">
    ${logo}
    ${brand.tagline ? `<div style="margin-top:6px;font-size:13px;color:${colors.primaryText};opacity:.8">${escape(brand.tagline)}</div>` : ""}
  </td></tr>`;
}

const button = (href, label, colors, { primary = true } = {}) =>
  `<a href="${escape(href)}" style="display:inline-block;margin:4px;padding:12px 20px;border-radius:999px;font-size:14px;font-weight:600;text-decoration:none;${
    primary ? `background:${colors.primary};color:${colors.primaryText}` : `background:#ffffff;color:${colors.text};border:1px solid ${tint(colors.text, 0.2)}`
  }">${label}</a>`;

/** Dos tarjetas lado a lado: día de entrega y lugar. */
function infoCards(order, colors) {
  const delivery = deliveryParts(order.delivery);
  const card = (icon, label, title, detail, link) => `<td valign="top" width="50%" style="padding:6px">
    <div style="background:${tint(colors.accent, 0.06)};border-radius:12px;padding:16px">
      <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${colors.muted}">${icon} ${label}</div>
      <div style="margin-top:6px;font-size:16px;font-weight:700;color:${colors.text}">${escape(title)}</div>
      ${detail ? `<div style="margin-top:4px;font-size:13px;line-height:1.45;color:${colors.muted}">${escape(detail)}</div>` : ""}
      ${link ? `<div style="margin-top:8px"><a href="${escape(link)}" style="font-size:13px;font-weight:600;color:${colors.accent}">Ver en el mapa →</a></div>` : ""}
    </div>
  </td>`;
  // "lunes 9 de noviembre de 2026" → título «9 de noviembre de 2026» y debajo «Lunes».
  const date = order.deliveryDate ? formatDeliveryDate(order.deliveryDate, order.locale) : "";
  const [weekday, ...rest] = date.split(" ");
  const dateCard = date
    ? card("📅", "Para el día", rest.join(" "), weekday.charAt(0).toUpperCase() + weekday.slice(1), null)
    : card("📅", "Para el día", "Por confirmar", "", null);
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
    ${dateCard}
    ${card(delivery.icon, "Entrega", delivery.title, delivery.detail, order.delivery.type === "home" ? mapsLink(order.delivery.address) : null)}
  </tr></table>`;
}

function itemsTable(order, colors) {
  const price = priceFormatter(order);
  const line = `border-bottom:1px solid ${tint(colors.text, 0.08)}`;
  const rows = order.items
    .map((item) => {
      const image = thumbnail(item.imageUrl);
      const details = [...(item.choices ?? []).map((choice) => `${choice.group}: ${choice.value}`), item.note && `Indicaciones: ${item.note}`].filter(Boolean);
      const photo = image
        ? `<img src="${escape(image)}" width="${THUMB}" height="${THUMB}" alt="" style="display:block;width:${THUMB}px;height:${THUMB}px;border-radius:10px;object-fit:cover;border:0">`
        : `<div style="width:${THUMB}px;height:${THUMB}px;border-radius:10px;background:${colors.surface};text-align:center;line-height:${THUMB}px;font-size:24px">🛍️</div>`;
      return `<tr>
        <td width="${THUMB}" valign="top" style="padding:14px 14px 14px 0;${line}">${photo}</td>
        <td valign="top" style="padding:14px 0;${line}">
          <div style="font-size:15px;font-weight:700;color:${colors.text}">${escape(item.name)}</div>
          ${details.map((detail) => `<div style="margin-top:2px;font-size:13px;color:${colors.muted}">${escape(detail)}</div>`).join("")}
          <div style="margin-top:6px;font-size:13px;color:${colors.muted}">${item.quantity} × ${price.format(item.unitPrice)}${item.priceFrom ? " (desde)" : ""}</div>
        </td>
        <td valign="top" align="right" style="padding:14px 0 14px 12px;${line};white-space:nowrap;font-size:15px;font-weight:700;color:${colors.text}">${price.format(item.subtotal)}</td>
      </tr>`;
    })
    .join("");
  const count = order.items.reduce((sum, item) => sum + item.quantity, 0);
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0">${rows}
    <tr>
      <td colspan="2" style="padding:18px 0 4px;font-size:14px;color:${colors.muted}">${count} ${count === 1 ? "producto" : "productos"} · ${order.approximate ? "Total aproximado" : "Total"}</td>
      <td align="right" style="padding:18px 0 4px;white-space:nowrap;font-size:24px;font-weight:800;color:${colors.primary}">${price.format(order.total)}</td>
    </tr>
    ${order.approximate ? `<tr><td colspan="3" style="font-size:12px;color:${colors.muted}">Algunos precios son «desde»: el total final se confirma contigo.</td></tr>` : ""}
  </table>`;
}

const sectionTitle = (text, colors) =>
  `<div style="margin:28px 0 8px;font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${colors.muted}">${text}</div>`;

const notesBlock = (order, colors) =>
  order.notes
    ? `${sectionTitle("📝 Notas del pedido", colors)}<div style="background:${colors.surface};border-radius:12px;padding:14px 16px;font-size:14px;line-height:1.5;color:${colors.text}">${escape(order.notes)}</div>`
    : "";

/** Dígitos en grupos de 4 para leerlos y dictarlos sin error. */
export const groupDigits = (value = "") => value.replace(/(\d{4})(?=\d)/g, "$1 ");

/** Anticipo pendiente: cuánto, hasta cuándo y cuánto resta. */
function depositBlock(order, colors) {
  if (!(order.deposit > 0)) return "";
  const price = priceFormatter(order);
  return `${sectionTitle("⏳ Anticipo para confirmar tu pedido", colors)}
    <div style="border:2px solid ${colors.accent};border-radius:12px;padding:16px;text-align:center">
      <div style="font-size:13px;color:${colors.muted}">Transfiere</div>
      <div style="margin:2px 0;font-size:30px;font-weight:800;color:${colors.accent}">${price.format(order.deposit)}</div>
      <div style="font-size:13px;color:${colors.text}">antes del <strong>${escape(formatDateTime(order.depositDueAt, order.locale))}</strong></div>
      <div style="margin-top:8px;font-size:12px;color:${colors.muted}">Resta ${price.format(order.total - order.deposit)} al recibir tu pedido. Si no recibimos el anticipo a tiempo, el pedido puede cancelarse.</div>
    </div>`;
}

/** Datos para pagar por transferencia (si el negocio los activó al momento del pedido). */
function paymentBlock(order, colors) {
  const payment = order.brand?.payment;
  if (!payment) return "";
  // Lo indispensable para transferir: tarjeta (o CLABE / cuenta si no hay tarjeta) y titular.
  const number = payment.card ? ["Tarjeta", groupDigits(payment.card)] : payment.clabe ? ["CLABE", groupDigits(payment.clabe)] : payment.account ? ["Cuenta", payment.account] : null;
  const rows = [number, ["Titular", payment.holder]]
    .filter((row) => row?.[1])
    .map(
      ([label, value]) => `<tr>
        <td style="padding:6px 0;font-size:13px;color:${colors.muted}">${label}</td>
        <td align="right" style="padding:6px 0;font-size:15px;font-weight:700;color:${colors.text};font-family:ui-monospace,Menlo,Consolas,monospace">${escape(value)}</td>
      </tr>`,
    )
    .join("");
  const qr = /^https:\/\//.test(payment.qrUrl ?? "")
    ? `<div style="margin-top:12px;text-align:center"><img src="${escape(payment.qrUrl)}" width="180" alt="Código QR para pagar" style="display:inline-block;width:180px;max-width:100%;border:0;border-radius:8px"></div>`
    : "";
  return `${sectionTitle("💳 Datos para tu pago", colors)}
    <div style="background:${tint(colors.accent, 0.06)};border-radius:12px;padding:12px 16px">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${rows}</table>
      ${qr}
      ${payment.instructions ? `<div style="margin-top:10px;font-size:13px;line-height:1.5;color:${colors.text}">${escape(payment.instructions)}</div>` : ""}
    </div>`;
}

function footer(order, colors, closing) {
  const brand = order.brand ?? {};
  const lines = [brand.address && `📍 ${escape(brand.address)}`, brand.hours && `🕒 ${escape(brand.hours)}`].filter(Boolean);
  const link = (href, label) => `<a href="${escape(href)}" style="color:${colors.accent};font-weight:600;text-decoration:none">${label}</a>`;
  const links = [
    brand.whatsapp && link(`https://wa.me/${brand.whatsapp}`, "WhatsApp"),
    /^https?:\/\//.test(brand.instagram ?? "") && link(brand.instagram, "Instagram"),
    /^https?:\/\//.test(brand.facebook ?? "") && link(brand.facebook, "Facebook"),
  ].filter(Boolean);
  return `<tr><td align="center" style="padding:24px 32px 32px;font-size:12px;line-height:1.6;color:${colors.muted}">
    <div style="font-size:14px;font-weight:700;color:${colors.text}">${escape(brand.name || order.businessName || "")}</div>
    ${lines.length ? `<div style="margin-top:4px">${lines.join(" &nbsp;·&nbsp; ")}</div>` : ""}
    ${links.length ? `<div style="margin-top:6px">${links.join(" &nbsp;·&nbsp; ")}</div>` : ""}
    <div style="margin-top:12px">${closing}</div>
  </td></tr>`;
}

/** Esqueleto común: fondo con el color del tema, tarjeta de 640 px y texto de vista previa (lo que se lee en la bandeja). */
function layout(colors, order, { preheader, body, closing }) {
  const background = tint(colors.primary, 0.06);
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${escape(preheader)}</title></head>
<body style="margin:0;padding:0;background:${background};font-family:${FONT};-webkit-font-smoothing:antialiased">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${escape(preheader)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${background}"><tr><td align="center" style="padding:24px 12px">
    <table role="presentation" width="${WIDTH}" cellspacing="0" cellpadding="0" style="width:100%;max-width:${WIDTH}px;background:#ffffff;border-radius:16px;box-shadow:0 8px 30px rgba(0,0,0,.06)">
      ${header(order, colors)}
      <tr><td style="padding:32px 32px 8px">${body}</td></tr>
      ${footer(order, colors, closing)}
    </table>
  </td></tr></table>
</body></html>`;
}

const folioPill = (order, colors) =>
  `<span style="display:inline-block;padding:6px 14px;border-radius:999px;background:${tint(colors.accent, 0.1)};color:${colors.accent};font-size:14px;font-weight:700;letter-spacing:.02em">Folio ${formatFolio(order.number)}</span>`;

// ── Correos ────────────────────────────────────────────────────────────────────────────────────

/** Aviso al negocio: todo para preparar y entregar, con botones para contactar al cliente. */
export function businessEmail(order) {
  const colors = palette(order);
  const { customer } = order;
  const price = priceFormatter(order);
  const date = order.deliveryDate ? formatDeliveryDate(order.deliveryDate, order.locale) : "";

  const body = `
    <div style="text-align:center">
      <div style="font-size:40px;line-height:1">🛒</div>
      <h1 style="margin:12px 0 10px;font-size:26px;line-height:1.2;color:${colors.text}">¡Tienes un pedido nuevo!</h1>
      ${folioPill(order, colors)}
      <div style="margin-top:14px;font-size:32px;font-weight:800;color:${colors.primary}">${price.format(order.total)}${
        order.approximate ? `<span style="font-size:14px;font-weight:600;color:${colors.muted}"> aprox.</span>` : ""
      }</div>
      ${
        order.deposit > 0
          ? `<div style="margin-top:8px;font-size:14px;color:${colors.text}">💳 Anticipo: <strong>${price.format(order.deposit)}</strong> · esperando pago hasta el ${escape(formatDateTime(order.depositDueAt, order.locale))}</div>`
          : ""
      }
    </div>

    ${sectionTitle("👤 Cliente", colors)}
    <div style="font-size:18px;font-weight:700;color:${colors.text}">${escape(customer.name)}</div>
    <div style="margin-top:2px;font-size:14px;color:${colors.muted}">${escape(formatPhone(customer.phone))}${customer.email ? ` · ${escape(customer.email)}` : ""}</div>
    <div style="margin-top:10px">
      ${button(`tel:${customer.phone}`, "📞 Llamar", colors)}
      ${button(`https://wa.me/${customer.phone.replace(/\D/g, "")}`, "💬 WhatsApp", colors, { primary: false })}
      ${customer.email ? button(`mailto:${customer.email}?subject=${encodeURIComponent(`Tu pedido ${formatFolio(order.number)}`)}`, "✉️ Correo", colors, { primary: false }) : ""}
    </div>

    ${sectionTitle("🚚 Entrega", colors)}
    ${infoCards(order, colors)}

    ${sectionTitle("🧾 Productos", colors)}
    ${itemsTable(order, colors)}
    ${notesBlock(order, colors)}`;

  return {
    subject: `🛒 Nuevo pedido ${formatFolio(order.number)} · ${customer.name}${date ? ` · para el ${date}` : ""} · ${price.format(order.total)}`,
    html: layout(colors, order, {
      preheader: `${customer.name} pidió ${price.format(order.total)}${date ? ` para el ${date}` : ""}.`,
      body,
      closing: "Aviso automático de tu tienda en línea. También te llegó por Telegram.",
    }),
    replyTo: customer.email || undefined,
  };
}

/** Comprobante para el cliente: certeza de que el pedido llegó, qué pidió y qué sigue. */
export function customerEmail(order) {
  const colors = palette(order);
  const name = order.brand?.name || order.businessName || "Tu pedido";
  const price = priceFormatter(order);
  const whatsapp = order.brand?.whatsapp;

  const hasDeposit = order.deposit > 0;
  const steps = (
    hasDeposit
      ? ["Transfiere tu anticipo usando tu folio como concepto.", "Sube la foto de tu comprobante en «Mis pedidos» o mándala por WhatsApp.", "Al ver el pago en el banco confirmamos tu pedido y te avisamos."]
      : ["Revisamos tu pedido y la disponibilidad.", "Te contactamos para confirmar el total y la entrega.", "Recibes tu pedido el día que elegiste."]
  )
    .map(
      (text, index) => `<tr>
        <td width="34" valign="top" style="padding:6px 0"><div style="width:24px;height:24px;border-radius:999px;background:${tint(colors.accent, 0.12)};color:${colors.accent};text-align:center;line-height:24px;font-size:12px;font-weight:700">${index + 1}</div></td>
        <td style="padding:6px 0;font-size:14px;line-height:24px;color:${colors.text}">${text}</td>
      </tr>`,
    )
    .join("");

  const body = `
    <div style="text-align:center">
      <div style="margin:0 auto;width:64px;height:64px;border-radius:999px;background:${tint(colors.accent, 0.12)};color:${colors.accent};line-height:64px;font-size:30px;font-weight:700">✓</div>
      <h1 style="margin:16px 0 6px;font-size:26px;line-height:1.2;color:${colors.text}">¡Gracias, ${escape(order.customer.name.split(" ")[0])}!</h1>
      <div style="font-size:16px;color:${colors.muted}">Recibimos tu pedido correctamente.</div>
      <div style="margin-top:14px">${folioPill(order, colors)}</div>
      <div style="margin-top:12px;font-size:14px;color:${colors.muted}">Te contactaremos al <strong style="color:${colors.text}">${escape(formatPhone(order.customer.phone))}</strong> para confirmarlo.</div>
    </div>

    ${sectionTitle("🚚 Entrega", colors)}
    ${infoCards(order, colors)}

    ${sectionTitle("🧾 Tu pedido", colors)}
    ${itemsTable(order, colors)}
    ${notesBlock(order, colors)}

    ${depositBlock(order, colors)}
    ${paymentBlock(order, colors)}

    ${sectionTitle("¿Qué sigue?", colors)}
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${steps}</table>

    ${
      whatsapp
        ? `<div style="margin-top:24px;text-align:center">${button(`https://wa.me/${whatsapp}?text=${encodeURIComponent(`Hola, tengo una pregunta sobre mi pedido ${formatFolio(order.number)}`)}`, "💬 ¿Dudas? Escríbenos", colors)}</div>`
        : ""
    }`;

  return {
    subject: hasDeposit
      ? `⏳ Recibimos tu pedido ${formatFolio(order.number)}: falta tu anticipo · ${name}`
      : `✅ Recibimos tu pedido ${formatFolio(order.number)} · ${name}`,
    html: layout(colors, order, {
      preheader: `Folio ${formatFolio(order.number)} · ${price.format(order.total)}. Te contactaremos para confirmarlo.`,
      body,
      closing: `Recibiste este correo porque hiciste un pedido en ${escape(name)}. Guárdalo por si necesitas preguntar por tu pedido; también puedes responder a este correo.`,
    }),
    replyTo: order.businessEmail || order.brand?.email || undefined,
  };
}

/** Correo al cliente cuando el negocio confirma o cancela su pedido. `null` si ese cambio no se avisa. */
export function statusEmail(order) {
  const colors = palette(order);
  const name = order.brand?.name || order.businessName || "Tu pedido";
  const price = priceFormatter(order);
  const folio = formatFolio(order.number);
  const whatsapp = order.brand?.whatsapp;
  const first = escape(order.customer.name.split(" ")[0]);
  const ask = whatsapp
    ? `<div style="margin-top:24px;text-align:center">${button(`https://wa.me/${whatsapp}?text=${encodeURIComponent(`Hola, tengo una pregunta sobre mi pedido ${folio}`)}`, "💬 Escríbenos", colors)}</div>`
    : "";

  if (order.status === "confirmed") {
    const paid = order.deposit > 0;
    const body = `
      <div style="text-align:center">
        <div style="margin:0 auto;width:64px;height:64px;border-radius:999px;background:${tint(colors.accent, 0.12)};color:${colors.accent};line-height:64px;font-size:30px;font-weight:700">✓</div>
        <h1 style="margin:16px 0 6px;font-size:26px;line-height:1.2;color:${colors.text}">¡Tu pedido está confirmado, ${first}!</h1>
        <div style="font-size:16px;color:${colors.muted}">${paid ? `Recibimos tu anticipo de <strong style="color:${colors.text}">${price.format(order.deposit)}</strong>.` : "Ya estamos trabajando en él."}</div>
        <div style="margin-top:14px">${folioPill(order, colors)}</div>
      </div>
      ${sectionTitle("🚚 Entrega", colors)}
      ${infoCards(order, colors)}
      ${
        paid
          ? `<div style="margin-top:16px;background:${colors.surface};border-radius:12px;padding:14px 16px;font-size:14px;color:${colors.text}">Resta por pagar al recibir: <strong>${price.format(order.total - order.deposit)}</strong>${order.approximate ? " (aproximado)" : ""}</div>`
          : ""
      }
      ${ask}`;
    return {
      subject: `✅ Tu pedido ${folio} está confirmado · ${name}`,
      html: layout(colors, order, { preheader: `Pedido ${folio} confirmado.`, body, closing: `Recibiste este correo por tu pedido en ${escape(name)}.` }),
      replyTo: order.businessEmail || order.brand?.email || undefined,
    };
  }

  if (order.status === "cancelled") {
    const body = `
      <div style="text-align:center">
        <h1 style="margin:8px 0 6px;font-size:24px;line-height:1.2;color:${colors.text}">Tu pedido ${folio} fue cancelado</h1>
        <div style="font-size:15px;line-height:1.5;color:${colors.muted}">${
          order.deposit > 0 && !order.depositPaidAt
            ? "No recibimos tu anticipo a tiempo. Si ya lo pagaste, respóndenos con tu comprobante y lo revisamos."
            : "Si crees que es un error o quieres hacer un nuevo pedido, escríbenos."
        }</div>
      </div>
      ${ask}`;
    return {
      subject: `Tu pedido ${folio} fue cancelado · ${name}`,
      html: layout(colors, order, { preheader: `Pedido ${folio} cancelado.`, body, closing: `Recibiste este correo por tu pedido en ${escape(name)}.` }),
      replyTo: order.businessEmail || order.brand?.email || undefined,
    };
  }

  return null;
}
