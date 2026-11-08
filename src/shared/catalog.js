// Catálogo de opciones válidas. Lo usan los esquemas de validación y se publica en GET /meta.

export const FONT_OPTIONS = [
  { family: "Inter", fallback: "sans-serif", weights: "400;500;600;700" },
  { family: "DM Sans", fallback: "sans-serif", weights: "400;500;600;700" },
  { family: "Poppins", fallback: "sans-serif", weights: "400;500;600;700" },
  { family: "Montserrat", fallback: "sans-serif", weights: "400;500;600;700" },
  { family: "Nunito", fallback: "sans-serif", weights: "400;500;600;700" },
  { family: "Lato", fallback: "sans-serif", weights: "400;700" },
  { family: "Raleway", fallback: "sans-serif", weights: "400;500;600;700" },
  { family: "Open Sans", fallback: "sans-serif", weights: "400;500;600;700" },
  { family: "Oswald", fallback: "sans-serif", weights: "400;500;600;700" },
  { family: "Bebas Neue", fallback: "sans-serif", weights: "400" },
  { family: "Fraunces", fallback: "serif", weights: "400;500;600;700" },
  { family: "Playfair Display", fallback: "serif", weights: "400;500;600;700" },
  { family: "Lora", fallback: "serif", weights: "400;500;600;700" },
  { family: "Cormorant Garamond", fallback: "serif", weights: "400;500;600;700" },
  { family: "Merriweather", fallback: "serif", weights: "400;700" },
  { family: "Libre Baskerville", fallback: "serif", weights: "400;700" },
  { family: "Pacifico", fallback: "cursive", weights: "400" },
  { family: "Dancing Script", fallback: "cursive", weights: "400;500;600;700" },
];

export const FONT_FAMILIES = FONT_OPTIONS.map((font) => font.family);

export const THEME_COLORS = {
  background: "Fondo",
  surface: "Superficie (tarjetas, pie de página)",
  text: "Texto",
  muted: "Texto secundario",
  primary: "Botones",
  primaryText: "Texto de botones",
  accent: "Acento",
  inverse: "Sección oscura",
  inverseText: "Texto de sección oscura",
};

export const RADIUS_OPTIONS = {
  none: { label: "Rectas", value: "0px" },
  sm: { label: "Sutiles", value: "0.5rem" },
  md: { label: "Medias", value: "1rem" },
  lg: { label: "Redondeadas", value: "1.5rem" },
  xl: { label: "Muy redondeadas", value: "2rem" },
};

// Plantillas del sitio público: cada una tiene sus propios componentes en catalogos-app.
export const TEMPLATES = {
  classic: "Clásica",
  market: "Tienda",
  carta: "Carta",
};

export const SECTION_TYPES = {
  hero: "Portada",
  featured: "Carrusel de destacados",
  menu: "Menú de productos",
  steps: "Pasos",
};

// Cómo elige el cliente en cada opción de personalización.
export const OPTION_TYPES = { single: "Elegir una", multiple: "Elegir varias", text: "Texto libre" };

export const CARD_SIZES = { normal: "Normal", wide: "Ancha (2×1)", large: "Grande (2×2)" };
export const CARD_STYLES = { overlay: "Texto sobre la foto", classic: "Texto debajo de la foto" };
export const ROW_HEIGHTS = { sm: "Baja", md: "Media", lg: "Alta" };
export const DESKTOP_COLUMNS = [2, 3, 4, 5];
export const MOBILE_COLUMNS = [1, 2];
export const CURRENCIES = ["MXN", "USD", "EUR", "COP", "PEN", "CLP", "ARS", "GTQ"];
export const LOCALES = ["es-MX", "es-ES", "es-CO", "es-AR", "es-CL", "es-PE", "en-US"];

export const LIMITS = Object.freeze({
  SECTIONS: 20,
  CATEGORIES: 50,
  PRODUCTS: 500,
  FEATURED_PRODUCTS: 10,
  PRODUCT_DETAILS: 10,
  PRODUCT_INGREDIENTS: 30,
  // Fotos adicionales a la principal (imageUrl): 1 + 4 = 5 por producto.
  PRODUCT_GALLERY: 4,
  PRODUCT_OPTIONS: 8,
  OPTION_CHOICES: 20,
  SECTION_ITEMS: 8,
  DELIVERY_POINTS: 20,
  DELIVERY_AREAS: 20,
  ORDER_ITEMS: 50,
  ORDER_QUANTITY: 99,
});

// Cómo recibe el cliente su pedido: en un lugar que define el negocio, a domicilio,
// o «lo coordinamos» (solo cuando el negocio no configuró ninguna de las dos).
export const DELIVERY_TYPES = { point: "Punto de entrega", home: "A domicilio", arrange: "Por coordinar" };

// Ciclo de vida de un pedido.
export const ORDER_STATUSES = { new: "Nuevo", confirmed: "Confirmado", onTheWay: "En camino", delivered: "Entregado", cancelled: "Cancelado" };
