// Imágenes guardadas en MongoDB. Cada una pesa pocos cientos de KB (el admin las comprime antes de subirlas).
import { randomBytes } from "node:crypto";
import { Binary } from "mongodb";

const COLLECTION = "images";
const ID_BYTES = 12;

export function createImagesRepository({ db }) {
  const images = db.collection(COLLECTION);

  return {
    async insert({ contentType, data }) {
      const id = randomBytes(ID_BYTES).toString("hex");
      await images.insertOne({ _id: id, contentType, size: data.length, data: new Binary(data), createdAt: new Date() });
      return id;
    },

    async findById(id) {
      const doc = await images.findOne({ _id: id });
      return doc ? { contentType: doc.contentType, data: Buffer.from(doc.data.buffer) } : null;
    },
  };
}
