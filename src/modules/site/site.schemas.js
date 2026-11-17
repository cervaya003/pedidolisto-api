// Contrato de datos del sitio. Fastify valida y limpia (quita campos extra) cada petición con esto.
import {
  CARD_SIZES,
  CARD_STYLES,
  CURRENCIES,
  DEPOSIT_TYPES,
  DESKTOP_COLUMNS,
  FONT_FAMILIES,
  LIMITS,
  LOCALES,
  MOBILE_COLUMNS,
  OPTION_TYPES,
  RADIUS_OPTIONS,
  ROW_HEIGHTS,
  SECTION_TYPES,
  TEMPLATES,
  THEME_COLORS,
} from "../../shared/catalog.js";
import { TEXT_PATTERNS as P } from "../../shared/textRules.js";

// Admin: textos abiertos (sin caracteres de control). Los nombres que el cliente ve en su pedido, además, sin < > { } …
const text = (maxLength) => ({ type: "string", maxLength, default: "", pattern: P.ADMIN_TEXT });
const name = (maxLength) => ({ type: "string", minLength: 1, maxLength, pattern: P.SAFE_LINE });
const object = (properties, required = []) => ({ type: "object", additionalProperties: false, required, properties });

const ID = { type: "string", pattern: "^[A-Za-z0-9_-]{1,64}$" };
const HEX_COLOR = { type: "string", pattern: "^#[0-9a-fA-F]{6}$" };
// http(s) o una ruta relativa sin ":" (bloquea javascript:, data:, etc.).
const URL_PATTERN = "^(https?://[^\\s]+|[\\w./-]+)?$";
const URL = { type: "string", maxLength: 2048, default: "", pattern: URL_PATTERN };
const IMAGE_URL = { type: "string", minLength: 1, maxLength: 2048, pattern: URL_PATTERN };

const textItems = (maxItems) => ({
  type: "array",
  maxItems,
  default: [],
  items: object({ title: text(60), text: text(300) }),
});

const business = object(
  {
    name: name(80),
    logoUrl: URL,
    tagline: text(120),
    description: text(600),
    whatsapp: { type: "string", pattern: "^\\d{0,15}$", default: "" },
    email: { type: "string", maxLength: 120, default: "", pattern: P.OPTIONAL_EMAIL },
    instagram: URL,
    facebook: URL,
    address: text(200),
    hours: text(120),
    currency: { type: "string", enum: CURRENCIES, default: "MXN" },
    locale: { type: "string", enum: LOCALES, default: "es-MX" },
    // Entregas: lugares fijos que elige el dueño (oficina, centro…) y/o entrega a domicilio.
    deliveryPoints: {
      type: "array",
      maxItems: LIMITS.DELIVERY_POINTS,
      default: [],
      items: object({ name: name(60), details: text(200) }, ["name"]),
    },
    homeDelivery: { type: "boolean", default: false },
    // Ciudades donde sí hay entrega a domicilio. Vacío: cualquier ciudad.
    deliveryAreas: {
      type: "array",
      maxItems: LIMITS.DELIVERY_AREAS,
      default: [],
      items: object({ city: { ...name(60), pattern: P.PLACE }, state: { type: "string", maxLength: 60, default: "", pattern: P.PLACE } }, ["city"]),
    },
    // Pago por transferencia: lo ve el cliente al terminar su pedido y en su comprobante por correo.
    // CLABE y tarjeta se revisan (dígito verificador) en site.service.
    payment: {
      ...object({
        enabled: { type: "boolean", default: false },
        bank: text(60),
        // Color de la tarjeta que ve el cliente. Vacío: el del banco (si es de la lista) o el del tema.
        cardColor: { type: "string", pattern: "^(#[0-9a-fA-F]{6})?$", default: "" },
        holder: text(100),
        clabe: { type: "string", pattern: "^[0-9]{0,18}$", default: "" },
        card: { type: "string", pattern: "^[0-9]{0,16}$", default: "" },
        account: { type: "string", pattern: "^[0-9]{0,20}$", default: "" },
        // Celular para DiMo / transferencia con número de celular.
        phone: { type: "string", pattern: "^[0-9]{0,10}$", default: "" },
        qrUrl: URL,
        instructions: text(300),
        // Plazo para mandar el anticipo de los productos que lo piden.
        depositHours: { type: "integer", minimum: LIMITS.DEPOSIT_HOURS_MIN, maximum: LIMITS.DEPOSIT_HOURS_MAX, default: 24 },
      }),
      default: {},
    },
  },
  ["name"],
);

const theme = object(
  {
    template: { type: "string", enum: Object.keys(TEMPLATES), default: "classic" },
    colors: object(
      Object.fromEntries(Object.keys(THEME_COLORS).map((key) => [key, HEX_COLOR])),
      Object.keys(THEME_COLORS),
    ),
    fonts: object(
      {
        heading: { type: "string", enum: FONT_FAMILIES },
        body: { type: "string", enum: FONT_FAMILIES },
      },
      ["heading", "body"],
    ),
    radius: { type: "string", enum: Object.keys(RADIUS_OPTIONS), default: "lg" },
    backgroundImageUrl: URL,
  },
  ["colors", "fonts"],
);

// Un solo esquema con todos los campos posibles de las secciones; cada tipo usa los suyos.
const sectionProps = object({
  navLabel: text(40),
  eyebrow: text(60),
  title: text(160),
  highlight: text(80),
  text: text(600),
  ctaLabel: text(40),
  // Por defecto "Favoritos": si faltara, al publicar se guardaría vacío y el filtro desaparecería.
  categoryLabel: { type: "string", maxLength: 40, default: "Favoritos" },
  imageUrl: URL,
  secondaryImageUrl: URL,
  badgeTitle: text(60),
  badgeText: text(80),
  highlights: textItems(6),
  items: textItems(LIMITS.SECTION_ITEMS),
  columns: { type: "integer", enum: DESKTOP_COLUMNS },
  mobileColumns: { type: "integer", enum: MOBILE_COLUMNS },
  cardStyle: { type: "string", enum: Object.keys(CARD_STYLES) },
  rowHeight: { type: "string", enum: Object.keys(ROW_HEIGHTS) },
  showFilters: { type: "boolean" },
});

const section = object(
  {
    id: { type: "string", pattern: "^[a-z0-9-]{1,40}$" },
    type: { type: "string", enum: Object.keys(SECTION_TYPES) },
    enabled: { type: "boolean", default: true },
    props: sectionProps,
  },
  ["id", "type", "props"],
);

// Personalización: el dueño define grupos (Sabor, Tamaño…) y el cliente elige al pedir.
const optionChoice = object(
  {
    label: name(40),
    price: { type: "number", minimum: 0, maximum: 1_000_000, default: 0 },
  },
  ["label"],
);

const productOption = object(
  {
    name: name(40),
    type: { type: "string", enum: Object.keys(OPTION_TYPES), default: "single" },
    required: { type: "boolean", default: false },
    choices: { type: "array", maxItems: LIMITS.OPTION_CHOICES, default: [], items: optionChoice },
  },
  ["name"],
);

const category = object({ id: ID, name: name(60) }, ["id", "name"]);

const product = object(
  {
    id: ID,
    name: name(100),
    categoryId: ID,
    price: { type: "number", minimum: 0, maximum: 10_000_000 },
    priceFrom: { type: "boolean", default: false },
    description: text(600),
    details: { type: "array", maxItems: LIMITS.PRODUCT_DETAILS, default: [], items: { type: "string", maxLength: 120 } },
    ingredients: { type: "array", maxItems: LIMITS.PRODUCT_INGREDIENTS, default: [], items: { type: "string", maxLength: 80 } },
    imageUrl: URL,
    gallery: { type: "array", maxItems: LIMITS.PRODUCT_GALLERY, default: [], items: IMAGE_URL },
    badge: text(30),
    size: { type: "string", enum: Object.keys(CARD_SIZES), default: "normal" },
    featured: { type: "boolean", default: false },
    active: { type: "boolean", default: true },
    customizable: { type: "boolean", default: false },
    allowNotes: { type: "boolean", default: false },
    options: { type: "array", maxItems: LIMITS.PRODUCT_OPTIONS, default: [], items: productOption },
    // Anticipo para apartar el pedido (pasteles por encargo…). `depositValue`: % (1-100) o monto por pieza.
    depositType: { type: "string", enum: Object.keys(DEPOSIT_TYPES), default: "none" },
    depositValue: { type: "number", minimum: 0, maximum: 10_000_000, default: 0 },
  },
  ["id", "name", "categoryId", "price"],
);

export const siteBodySchema = object(
  {
    business,
    theme,
    layout: object({ sections: { type: "array", maxItems: LIMITS.SECTIONS, items: section } }, ["sections"]),
    categories: { type: "array", maxItems: LIMITS.CATEGORIES, items: category },
    products: { type: "array", maxItems: LIMITS.PRODUCTS, items: product },
  },
  ["business", "theme", "layout", "categories", "products"],
);
