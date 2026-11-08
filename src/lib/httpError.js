/** Error con código HTTP. El manejador global lo convierte en respuesta JSON. */
export function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}
