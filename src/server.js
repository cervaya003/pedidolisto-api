import { buildApp } from "./app.js";
import { loadEnv } from "./config/env.js";

const SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM"];

let env;
try {
  env = loadEnv();
} catch (error) {
  console.error(`✗ Configuración inválida: ${error.message}`);
  process.exit(1);
}

const app = await buildApp(env).catch((error) => {
  console.error(`✗ No se pudo iniciar el API: ${error.message}`);
  process.exit(1);
});

for (const signal of SHUTDOWN_SIGNALS) {
  process.once(signal, async () => {
    app.log.info(`${signal} recibido, cerrando…`);
    await app.close();
    process.exit(0);
  });
}

await app.listen({ host: env.HOST, port: env.PORT });
