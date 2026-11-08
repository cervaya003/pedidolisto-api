const REQUIRED_KEYS = ["MONGODB_URI", "JWT_SECRET", "ADMIN_PASSWORD_HASH", "CORS_ORIGINS"];
const MIN_SECRET_LENGTH = 32;

const toList = (value) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const CLOUDINARY_KEYS = ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"];

/** Cloudinary es opcional: o están las tres variables, o ninguna. */
function loadCloudinary(source) {
  const present = CLOUDINARY_KEYS.filter((key) => source[key]?.trim());
  if (!present.length) return null;
  if (present.length < CLOUDINARY_KEYS.length) {
    const missing = CLOUDINARY_KEYS.filter((key) => !present.includes(key));
    throw new Error(`Para usar Cloudinary faltan: ${missing.join(", ")} (o borra las tres para guardar en MongoDB)`);
  }
  return Object.freeze({
    cloudName: source.CLOUDINARY_CLOUD_NAME.trim(),
    apiKey: source.CLOUDINARY_API_KEY.trim(),
    apiSecret: source.CLOUDINARY_API_SECRET.trim(),
    folder: source.CLOUDINARY_FOLDER?.trim() || "catalogo",
  });
}

const TELEGRAM_KEYS = ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"];

/** Telegram es opcional: sin él los pedidos se guardan igual y se envían cuando se configure. */
function loadTelegram(source) {
  const present = TELEGRAM_KEYS.filter((key) => source[key]?.trim());
  if (!present.length) return null;
  if (present.length < TELEGRAM_KEYS.length) {
    const missing = TELEGRAM_KEYS.filter((key) => !present.includes(key));
    throw new Error(`Para avisar los pedidos por Telegram faltan: ${missing.join(", ")}`);
  }
  const botToken = source.TELEGRAM_BOT_TOKEN.trim();
  if (!/^\d+:[\w-]{30,}$/.test(botToken)) throw new Error("TELEGRAM_BOT_TOKEN no tiene el formato que entrega @BotFather (123456:ABC…)");
  return Object.freeze({ botToken, chatId: source.TELEGRAM_CHAT_ID.trim() });
}

const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
// "correo@dominio.com" o "Nombre <correo@dominio.com>"
const FROM_PATTERN = /^([^<>]+<[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>|[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+)$/;

// "Nombre <correo@x.com>" → "correo@x.com"
const addressOf = (from) => (from.match(/<([^>]+)>/)?.[1] ?? from).trim();

/**
 * Correo (opcional). Dos formas:
 * - Gmail: GMAIL_APP_PASSWORD (contraseña de aplicación de Google) + EMAIL_FROM con esa cuenta de Gmail.
 * - Resend: RESEND_API_KEY (re_…) + EMAIL_FROM de un dominio verificado (o onboarding@resend.dev para probar).
 * EMAIL_ORDERS_TO (correos del negocio) es opcional.
 */
function loadEmail(source) {
  const appPassword = source.GMAIL_APP_PASSWORD?.replace(/\s+/g, "");
  const apiKey = source.RESEND_API_KEY?.trim();
  if (!appPassword && !apiKey) return null;

  const from = source.EMAIL_FROM?.trim();
  if (!from) throw new Error("Falta EMAIL_FROM (el correo desde el que se envían los avisos)");
  if (!FROM_PATTERN.test(from)) throw new Error("EMAIL_FROM debe ser «correo@dominio.com» o «Nombre <correo@dominio.com>»");

  const ordersTo = toList(source.EMAIL_ORDERS_TO ?? "");
  const invalid = ordersTo.find((address) => !EMAIL_PATTERN.test(address));
  if (invalid) throw new Error(`EMAIL_ORDERS_TO tiene un correo inválido: ${invalid}`);

  if (appPassword) {
    if (!/^[a-zA-Z]{16}$/.test(appPassword)) {
      throw new Error("GMAIL_APP_PASSWORD debe ser la contraseña de aplicación de Google: 16 letras (myaccount.google.com/apppasswords), no tu contraseña normal");
    }
    return Object.freeze({ provider: "gmail", user: addressOf(from), appPassword, from, ordersTo: Object.freeze(ordersTo) });
  }

  if (!/^re_\w{10,}$/.test(apiKey)) {
    throw new Error("RESEND_API_KEY no parece una API key de Resend: debe empezar con «re_». Si lo que tienes es una contraseña de aplicación de Gmail (16 letras), ponla en GMAIL_APP_PASSWORD");
  }
  return Object.freeze({ provider: "resend", apiKey, from, ordersTo: Object.freeze(ordersTo) });
}

/** Un correo mal configurado NO debe impedir recibir pedidos: se desactiva y se avisa en el log. */
function tryLoadEmail(source) {
  try {
    return { EMAIL: loadEmail(source), EMAIL_ERROR: "" };
  } catch (error) {
    return { EMAIL: null, EMAIL_ERROR: error.message };
  }
}

/** Valida y congela la configuración. Falla al arrancar si algo falta: nunca en plena petición. */
export function loadEnv(source = process.env) {
  const missing = REQUIRED_KEYS.filter((key) => !source[key]);
  if (missing.length) throw new Error(`Faltan variables de entorno: ${missing.join(", ")}`);

  if (source.JWT_SECRET.length < MIN_SECRET_LENGTH) {
    throw new Error(`JWT_SECRET debe tener al menos ${MIN_SECRET_LENGTH} caracteres`);
  }

  return Object.freeze({
    NODE_ENV: source.NODE_ENV ?? "development",
    HOST: source.HOST ?? "0.0.0.0",
    PORT: Number(source.PORT ?? 3000),
    MONGODB_URI: source.MONGODB_URI,
    MONGODB_DB_NAME: source.MONGODB_DB_NAME ?? "catalogo",
    JWT_SECRET: source.JWT_SECRET,
    JWT_EXPIRES_IN: source.JWT_EXPIRES_IN ?? "8h",
    ADMIN_PASSWORD_HASH: source.ADMIN_PASSWORD_HASH,
    CORS_ORIGINS: toList(source.CORS_ORIGINS),
    LOGIN_MAX_ATTEMPTS: Number(source.LOGIN_MAX_ATTEMPTS ?? 5),
    LOGIN_WINDOW: source.LOGIN_WINDOW ?? "15 minutes",
    CLOUDINARY: loadCloudinary(source),
    TELEGRAM: loadTelegram(source),
    ...tryLoadEmail(source),
    ORDER_MAX_PER_WINDOW: Number(source.ORDER_MAX_PER_WINDOW ?? 10),
    ORDER_WINDOW: source.ORDER_WINDOW ?? "10 minutes",
  });
}
