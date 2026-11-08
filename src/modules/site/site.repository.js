// Único módulo que conoce las colecciones de MongoDB.
const SETTINGS_ID = "site";
const COLLECTIONS = Object.freeze({ SETTINGS: "settings", CATEGORIES: "categories", PRODUCTS: "products" });

const toClient = ({ _id, order, ...fields }) => ({ id: _id, ...fields });
const toDocument = ({ id, ...fields }, order) => ({ _id: id, ...fields, order });

export function createSiteRepository({ client, db }) {
  const settings = db.collection(COLLECTIONS.SETTINGS);
  const categories = db.collection(COLLECTIONS.CATEGORIES);
  const products = db.collection(COLLECTIONS.PRODUCTS);

  async function replaceCollection(collection, items, session) {
    const docs = items.map(toDocument);
    await collection.deleteMany({ _id: { $nin: docs.map((doc) => doc._id) } }, { session });
    if (!docs.length) return;

    await collection.bulkWrite(
      docs.map((doc) => ({ replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true } })),
      { session, ordered: false },
    );
  }

  return {
    async ensureIndexes() {
      await Promise.all([categories.createIndex({ order: 1 }), products.createIndex({ active: 1, order: 1 })]);
    },

    async find({ includeHidden }) {
      const [settingsDoc, categoryDocs, productDocs] = await Promise.all([
        settings.findOne({ _id: SETTINGS_ID }),
        categories.find().sort({ order: 1 }).toArray(),
        products.find(includeHidden ? {} : { active: true }).sort({ order: 1 }).toArray(),
      ]);
      if (!settingsDoc) return null;

      const { business, theme, layout } = settingsDoc;
      return { business, theme, layout, categories: categoryDocs.map(toClient), products: productDocs.map(toClient) };
    },

    /** Guarda todo en una transacción: o se publica completo, o no se publica nada. */
    async replaceAll({ business, theme, layout, categories: categoryList, products: productList }) {
      const session = client.startSession();
      try {
        await session.withTransaction(async () => {
          await settings.replaceOne(
            { _id: SETTINGS_ID },
            { business, theme, layout, updatedAt: new Date() },
            { upsert: true, session },
          );
          await replaceCollection(categories, categoryList, session);
          await replaceCollection(products, productList, session);
        });
      } finally {
        await session.endSession();
      }
    },
  };
}
