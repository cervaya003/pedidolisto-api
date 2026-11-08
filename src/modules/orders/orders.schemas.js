// Contrato de POST /orders. Fastify valida y quita campos extra. Los precios NO viajan:
// el servidor los recalcula con el catálogo publicado.
import { DELIVERY_TYPES, LIMITS } from "../../shared/catalog.js";
import { TEXT_PATTERNS as P } from "../../shared/textRules.js";

// Cada texto público tiene un largo máximo y un patrón de caracteres permitidos.
const text = (maxLength, pattern = P.SAFE_LINE) => ({ type: "string", maxLength, pattern, default: "" });
const object = (properties, required = []) => ({ type: "object", additionalProperties: false, required, properties });

const address = object({
  street: text(100, P.PLACE),
  exterior: text(10, P.HOUSE_NUMBER),
  interior: text(10, P.HOUSE_NUMBER),
  neighborhood: text(80, P.PLACE),
  postalCode: { type: "string", pattern: "^(\\d{4,6})?$", default: "" },
  city: text(60, P.PLACE),
  state: text(60, P.PLACE),
  references: text(200, P.SAFE_MULTILINE),
});

const orderItem = object(
  {
    productId: { type: "string", pattern: "^[A-Za-z0-9_-]{1,64}$" },
    quantity: { type: "integer", minimum: 1, maximum: LIMITS.ORDER_QUANTITY },
    choices: {
      type: "array",
      maxItems: LIMITS.PRODUCT_OPTIONS * LIMITS.OPTION_CHOICES,
      default: [],
      items: object(
        {
          group: { type: "string", minLength: 1, maxLength: 40, pattern: P.SAFE_LINE },
          value: { type: "string", minLength: 1, maxLength: 120, pattern: P.SAFE_LINE },
        },
        ["group", "value"],
      ),
    },
    note: text(300, P.SAFE_MULTILINE),
  },
  ["productId", "quantity"],
);

export const createOrderSchema = object(
  {
    // Lo genera el navegador una vez por pedido: si se reintenta el envío, no se duplica.
    requestId: { type: "string", pattern: "^[A-Za-z0-9-]{16,64}$" },
    customer: object(
      {
        name: { type: "string", minLength: 3, maxLength: 80, pattern: P.PERSON_NAME },
        // +52 (México), +1 (EE. UU. / Canadá) y exactamente 10 dígitos: "+524421234567".
        phone: { type: "string", pattern: "^\\+(?:52|1)[0-9]{10}$" },
        email: { type: "string", maxLength: 120, default: "", pattern: P.OPTIONAL_EMAIL },
      },
      ["name", "phone"],
    ),
    // Día en que el cliente quiere su pedido (AAAA-MM-DD, fecha local del cliente).
    deliveryDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    delivery: object({ type: { type: "string", enum: Object.keys(DELIVERY_TYPES) }, point: text(60), address }, ["type"]),
    items: { type: "array", minItems: 1, maxItems: LIMITS.ORDER_ITEMS, items: orderItem },
    notes: text(500, P.SAFE_MULTILINE),
    // Trampa para bots: un campo oculto que una persona nunca llena.
    website: text(200),
  },
  ["requestId", "customer", "deliveryDate", "delivery", "items"],
);

// Contrato de POST /orders/mine: los pedidos de un cliente. Va en el cuerpo (no en la URL)
// para que el correo y el teléfono no queden en historiales ni en logs de acceso.
export const myOrdersSchema = object(
  {
    email: { type: "string", minLength: 3, maxLength: 120, pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$" },
    phone: { type: "string", pattern: "^\\+?[0-9 ().-]{8,20}$" },
  },
  ["email", "phone"],
);
