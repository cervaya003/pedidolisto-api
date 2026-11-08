// Uso: pnpm hash-password "mi-contraseña"  → copia el resultado en ADMIN_PASSWORD_HASH del .env
import { hashPassword } from "../src/lib/password.js";

const MIN_LENGTH = 10;
const password = process.argv[2];

if (!password || password.length < MIN_LENGTH) {
  console.error(`Uso: pnpm hash-password "contraseña de al menos ${MIN_LENGTH} caracteres"`);
  process.exit(1);
}

console.log(await hashPassword(password));
