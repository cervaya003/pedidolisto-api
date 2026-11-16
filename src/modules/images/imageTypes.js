// Tipos de imagen aceptados. Se valida el contenido real (firma del archivo), no solo la cabecera Content-Type.
const SIGNATURES = {
  "image/jpeg": (data) => data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff,
  "image/png": (data) => data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/webp": (data) => data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP",
};

export const IMAGE_TYPES = Object.keys(SIGNATURES);
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

/** Tipo de la imagen si el cuerpo es realmente una JPG, PNG o WebP; si no, null. */
export function imageTypeOf(request) {
  const contentType = request.headers["content-type"]?.split(";")[0].trim();
  const data = request.body;
  return Buffer.isBuffer(data) && SIGNATURES[contentType]?.(data) ? contentType : null;
}
