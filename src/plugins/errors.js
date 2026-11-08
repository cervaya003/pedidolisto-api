import fp from "fastify-plugin";

// Nombre legible de cada campo para los mensajes de error.
const FIELD_LABELS = {
  name: "Nombre",
  phone: "Teléfono",
  email: "Correo",
  street: "Calle",
  exterior: "Número exterior",
  interior: "Número interior",
  neighborhood: "Colonia",
  postalCode: "Código postal",
  city: "Ciudad",
  state: "Estado",
  references: "Referencias",
  notes: "Notas",
  note: "Indicaciones",
  value: "Texto de personalización",
  group: "Opción",
  deliveryDate: "Fecha de entrega",
  password: "Contraseña",
  label: "Alternativa",
  details: "Detalles",
  description: "Descripción",
  tagline: "Lema",
  title: "Título",
  text: "Texto",
  whatsapp: "WhatsApp",
  address: "Dirección",
  hours: "Horario",
  badge: "Etiqueta",
  price: "Precio",
};
// Para el admin: en qué elemento de la lista está el error («producto 3»).
const LIST_LABELS = { products: "producto", categories: "categoría", sections: "sección", options: "opción", choices: "alternativa", items: "elemento", deliveryPoints: "lugar de entrega", deliveryAreas: "ciudad" };

function formatValidationIssue(issue) {
  const parts = issue.instancePath.split("/").filter(Boolean);
  const key = issue.keyword === "required" ? issue.params.missingProperty : parts.filter((part) => !/^\d+$/.test(part)).pop();
  const label = FIELD_LABELS[key] ?? key ?? "Dato";
  const where = parts
    .map((part, index) => (/^\d+$/.test(part) && LIST_LABELS[parts[index - 1]] ? `${LIST_LABELS[parts[index - 1]]} ${Number(part) + 1}` : null))
    .filter(Boolean)
    .join(", ");
  const limit = issue.params?.limit;
  const problem =
    {
      pattern: "tiene caracteres no permitidos o un formato inválido",
      format: "tiene un formato inválido",
      maxLength: `es demasiado largo (máximo ${limit} caracteres)`,
      minLength: limit <= 1 ? "es obligatorio" : `es demasiado corto (mínimo ${limit} caracteres)`,
      required: "es obligatorio",
      minimum: `debe ser mayor o igual a ${limit}`,
      maximum: `debe ser menor o igual a ${limit}`,
      maxItems: `tiene demasiados elementos (máximo ${limit})`,
      minItems: "no puede estar vacío",
      enum: "no es una opción válida",
      type: "tiene un formato inválido",
    }[issue.keyword] ?? issue.message;
  return `«${label}»${where ? ` (${where})` : ""} ${problem}`;
}

/** Respuestas de error uniformes: { error, details? }. Nunca filtra detalles internos en 5xx. */
async function errorsPlugin(app) {
  app.setErrorHandler((error, request, reply) => {
    if (error.validation) {
      return reply.status(400).send({ error: "Revisa los datos", details: error.validation.map(formatValidationIssue) });
    }

    const statusCode = error.statusCode ?? 500;
    if (statusCode >= 500) {
      request.log.error({ err: error }, "Error no controlado");
      // `expose`: error de un servicio externo con un mensaje pensado para el usuario.
      if (error.expose) return reply.status(statusCode).send({ error: error.message });
      return reply.status(500).send({ error: "Error interno del servidor" });
    }

    return reply.status(statusCode).send({ error: error.message });
  });

  app.setNotFoundHandler((_request, reply) => reply.status(404).send({ error: "Recurso no encontrado" }));
}

export default fp(errorsPlugin, { name: "errors" });
