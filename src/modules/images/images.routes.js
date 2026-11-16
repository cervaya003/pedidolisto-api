import { httpError } from "../../lib/httpError.js";
import { createCloudinaryStorage } from "./cloudinary.storage.js";
import { IMAGE_TYPES, MAX_IMAGE_BYTES, imageTypeOf } from "./imageTypes.js";
import { createMongoStorage } from "./mongo.storage.js";

const UPLOAD_RATE_LIMIT = { max: 60, timeWindow: "1 minute" };
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
const ID_PARAMS = { type: "object", properties: { id: { type: "string", pattern: "^[a-f0-9]{24}$" } }, required: ["id"] };

export { IMAGE_TYPES, MAX_IMAGE_BYTES };

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
      const contentType = imageTypeOf(request);
      if (!contentType) throw httpError(415, "Solo se aceptan imágenes JPG, PNG o WebP");

      const url = await storage.save({ contentType, data: request.body });
      return reply.status(201).send({ url });
    });
  });
}
