import {
  CARD_SIZES,
  CARD_STYLES,
  CURRENCIES,
  DESKTOP_COLUMNS,
  FONT_OPTIONS,
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
import { PRODUCT_DEFAULTS, SECTION_DEFAULT_PROPS } from "../../shared/defaults.js";

const META = Object.freeze({
  templates: TEMPLATES,
  fonts: FONT_OPTIONS,
  themeColors: THEME_COLORS,
  radiusOptions: RADIUS_OPTIONS,
  sectionTypes: SECTION_TYPES,
  sectionDefaults: SECTION_DEFAULT_PROPS,
  productDefaults: PRODUCT_DEFAULTS,
  optionTypes: OPTION_TYPES,
  cardSizes: CARD_SIZES,
  cardStyles: CARD_STYLES,
  rowHeights: ROW_HEIGHTS,
  desktopColumns: DESKTOP_COLUMNS,
  mobileColumns: MOBILE_COLUMNS,
  currencies: CURRENCIES,
  locales: LOCALES,
  limits: LIMITS,
});

const CACHE_CONTROL = "public, max-age=3600";

/** Opciones válidas del sistema: el frontend arma sus formularios con esto. */
export default async function metaRoutes(app) {
  app.get("/meta", async (_request, reply) => reply.header("Cache-Control", CACHE_CONTROL).send(META));
}
