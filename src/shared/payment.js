// Datos para que el cliente pague por transferencia. Se validan aquí para no publicar una cuenta mal escrita:
// un dígito equivocado manda el dinero del cliente a otra persona o el banco lo rechaza.

const CLABE_WEIGHTS = [3, 7, 1];

/** CLABE: 18 dígitos con dígito verificador (algoritmo de Banxico). */
export function isValidClabe(clabe) {
  if (!/^\d{18}$/.test(clabe)) return false;
  const sum = [...clabe.slice(0, 17)].reduce((total, digit, index) => total + ((Number(digit) * CLABE_WEIGHTS[index % 3]) % 10), 0);
  return (10 - (sum % 10)) % 10 === Number(clabe[17]);
}

/** Tarjeta de débito: 15 o 16 dígitos que pasan la prueba de Luhn. */
export function isValidCard(card) {
  if (!/^\d{15,16}$/.test(card)) return false;
  let sum = 0;
  for (let index = 0; index < card.length; index++) {
    let digit = Number(card[card.length - 1 - index]);
    if (index % 2 === 1) digit = digit * 2 > 9 ? digit * 2 - 9 : digit * 2;
    sum += digit;
  }
  return sum % 10 === 0;
}

/** Mensaje de error o `null`. Solo se exige cuando el apartado está activado. */
export function paymentProblem(payment) {
  if (!payment?.enabled) return null;
  const { clabe, card, account, phone, qrUrl } = payment;
  if (!clabe && !card && !account && !phone && !qrUrl) return "Activaste los pagos por transferencia, pero falta la CLABE, la tarjeta, la cuenta, el celular o el QR";
  if (clabe && !isValidClabe(clabe)) return "La CLABE no es válida: revisa los 18 dígitos";
  if (card && !isValidCard(card)) return "El número de tarjeta no es válido: revisa los dígitos";
  if (!payment.holder.trim()) return "Escribe el nombre del titular de la cuenta: el cliente lo ve al transferir para confirmar que es la cuenta correcta";
  return null;
}
