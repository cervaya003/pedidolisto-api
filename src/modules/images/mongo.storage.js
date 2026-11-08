// Guarda las imágenes en MongoDB; las entrega el propio API en GET /images/:id.
import { createImagesRepository } from "./images.repository.js";

export function createMongoStorage(mongo) {
  const repository = createImagesRepository(mongo);
  return {
    repository,
    /** Devuelve una ruta relativa al API; el admin le antepone VITE_API_URL. */
    async save(image) {
      return `/images/${await repository.insert(image)}`;
    },
  };
}
