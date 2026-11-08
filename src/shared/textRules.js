// Reglas de texto (patrones JSON Schema; Ajv los evalúa con la bandera «u», así que \p{L} = cualquier letra).
// El frontend tiene una copia en catalogos-app/src/core/textRules.js: si cambias una, cambia la otra.

// Caracteres que nunca se aceptan en textos libres: sirven para inyectar HTML, plantillas o comandos.
const FORBIDDEN = "<>{}\\[\\]\\\\`^|~";

export const TEXT_PATTERNS = Object.freeze({
  // Nombres de persona: letras (con acentos y ñ), espacios, punto, apóstrofo y guion. «Ma. José O'Neil».
  PERSON_NAME: "^[\\p{L}\\p{M}]+(?:[ .'-]+[\\p{L}\\p{M}]+)*\\.?$",
  // Calles, colonias, ciudades: letras, números, espacios y . , # ' ° / ( ) -
  PLACE: "^[\\p{L}\\p{M}\\p{N} .,#'°/()-]*$",
  // Número exterior / interior: «123», «4-B», «Depto 2», «S/N».
  HOUSE_NUMBER: "^[\\p{L}\\p{N} /-]*$",
  // Texto libre de una línea (mensajes en el pastel, nombres de opciones): todo menos símbolos peligrosos.
  SAFE_LINE: `^[^${FORBIDDEN}\\p{Cc}]*$`,
  // Texto libre de varias líneas (notas, indicaciones).
  SAFE_MULTILINE: `^(?:[^${FORBIDDEN}\\p{Cc}]|\\r?\\n)*$`,
  // Textos del admin: abiertos, solo sin caracteres de control (salvo saltos de línea y tabulador).
  ADMIN_TEXT: "^(?:[^\\p{Cc}]|[\\r\\n\\t])*$",
  // Correo con formato real: usuario@dominio.ext (vacío permitido donde es opcional).
  EMAIL: "^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)*\\.[A-Za-z]{2,}$",
  OPTIONAL_EMAIL: "^(|[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)*\\.[A-Za-z]{2,})$",
});

export const EMAIL_REGEX = new RegExp(TEXT_PATTERNS.EMAIL);
