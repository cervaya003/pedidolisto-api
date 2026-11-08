import fp from "fastify-plugin";
import { MongoClient } from "mongodb";

const SERVER_SELECTION_TIMEOUT_MS = 10_000;
const MAX_POOL_SIZE = 10;

/** Una sola conexión (singleton) compartida por toda la app como `app.mongo`. */
async function mongoPlugin(app, { uri, dbName }) {
  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: SERVER_SELECTION_TIMEOUT_MS,
    maxPoolSize: MAX_POOL_SIZE,
  });

  await client.connect();
  app.decorate("mongo", { client, db: client.db(dbName) });
  app.addHook("onClose", () => client.close());
  app.log.info({ dbName }, "Conectado a MongoDB");
}

export default fp(mongoPlugin, { name: "mongo" });
