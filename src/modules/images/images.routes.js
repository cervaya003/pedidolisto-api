import { httpError } from "../../lib/httpError.js";
import { createCloudinaryStorage } from "./cloudinary.storage.js";
import { createMongoStorage } from "./mongo.storage.js";

export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const UPLOAD_RATE_LIMIT = { max: 60, timeWindow: "1 minute" };
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
const ID_PARAMS = { type: "object", properties: { id: { type: "string", pattern: "^[a-f0-9]{24}$" } }, required: ["id"] };

// Se valida el contenido real (firma del archivo), no solo la cabecera Content-Type.
const SIGNATURES = {
  "image/jpeg": (data) => data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff,
  "image/png": (data) => data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/webp": (data) => data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP",
};
export const IMAGE_TYPES = Object.keys(SIGNATURES);

/** Con CLOUDINARY_* en el .env las imágenes van a Cloudinary; sin ellas, a MongoDB. */
export default async function imagesRoutes(app, { cloudinary } = {}) {
  const mongoStorage = createMongoStorage(app.mongo);
  const storage = cloudinary ? createCloudinaryStorage(cloudinary) : mongoStorage;
  const { repository } = mongoStorage;
  app.log.info(`Imágenes: se guardan en ${cloudinary ? "Cloudinary" : "MongoDB"}`);

  app.get("/images/:id", { schema: { params: ID_PARAMS } }, async (request, reply) => {
    const image = await repository.findById(request.params.id);
    if (!image) throw httpError(404, "Imagen no encontrada");
    return reply.type(image.contentType).header("Cache-Control", IMMUTABLE_CACHE).send(image.data);
  });

  app.register(async (admin) => {
    admin.addHook("onRequest", app.authenticate);
    admin.addContentTypeParser(IMAGE_TYPES, { parseAs: "buffer", bodyLimit: MAX_IMAGE_BYTES }, (_request, body, done) => done(null, body));

    admin.post("/admin/images", { config: { rateLimit: UPLOAD_RATE_LIMIT } }, async (request, reply) => {
      const contentType = request.headers["content-type"]?.split(";")[0].trim();
      const data = request.body;
      if (!Buffer.isBuffer(data) || !SIGNATURES[contentType]?.(data)) {
        throw httpError(415, "Solo se aceptan imágenes JPG, PNG o WebP");
      }

      const url = await storage.save({ contentType, data });
      return reply.status(201).send({ url });
    });
  });
}
