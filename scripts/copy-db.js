// Copia todas las colecciones (documentos + índices) de una BD a otra en el mismo cluster.
// Uso: node --env-file=.env scripts/copy-db.js <origen> <destino> [--force]
//   --force  borra las colecciones del destino antes de copiar
import dns from 'node:dns';
import { MongoClient } from 'mongodb';

// En Windows el DNS local a veces rechaza las consultas SRV de mongodb+srv
dns.setServers(['8.8.8.8', '1.1.1.1']);

const [source, target] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const force = process.argv.includes('--force');

if (!source || !target || source === target) {
  console.error('Uso: node --env-file=.env scripts/copy-db.js <origen> <destino> [--force]');
  process.exit(1);
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();

try {
  const src = client.db(source);
  const dst = client.db(target);

  const existing = await dst.listCollections({}, { nameOnly: true }).toArray();
  if (existing.length && !force) {
    console.error(`La BD "${target}" ya tiene colecciones (${existing.map((c) => c.name).join(', ')}). Usa --force para reemplazarlas.`);
    process.exit(1);
  }

  const collections = await src.listCollections({ type: 'collection' }).toArray();
  for (const { name, options } of collections) {
    if (name.startsWith('system.')) continue;
    if (force) await dst.collection(name).drop().catch(() => {});

    await dst.createCollection(name, options);
    const docs = await src.collection(name).find().toArray();
    if (docs.length) await dst.collection(name).insertMany(docs, { ordered: false });

    const indexes = (await src.collection(name).indexes()).filter((i) => i.name !== '_id_');
    for (const { key, v, ns, ...opts } of indexes) {
      await dst.collection(name).createIndex(key, opts);
    }
    console.log(`✔ ${name}: ${docs.length} docs, ${indexes.length} índices`);
  }
  console.log(`Copia de "${source}" → "${target}" terminada.`);
} finally {
  await client.close();
}
