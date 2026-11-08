# PedidoListo · API

Backend de una **plataforma de catálogo digital y pedidos en línea totalmente personalizable**. Un negocio
(repostería, restaurante, tienda) publica sus productos, elige el diseño de su sitio y recibe pedidos de sus
clientes al instante por **Telegram** y **correo electrónico**, sin comisiones por venta ni intermediarios.

Este repositorio contiene el **API**: guarda la configuración del sitio (negocio, tema, secciones, categorías y
productos), sirve las imágenes, recibe los pedidos y avisa al negocio. El sitio público y el panel de
administración viven en el repositorio **pedidolisto-app**.

---

## Contenido

- [Características](#características)
- [Tecnologías](#tecnologías)
- [Arquitectura](#arquitectura)
- [Puesta en marcha](#puesta-en-marcha)
- [Variables de entorno](#variables-de-entorno)
- [Endpoints](#endpoints)
- [Flujo de un pedido](#flujo-de-un-pedido)
- [Seguridad y validación](#seguridad-y-validación)
- [Modelo de datos](#modelo-de-datos)
- [Pruebas](#pruebas)
- [Despliegue](#despliegue)

---

## Características

**Contenido del sitio**
- Un solo documento de configuración por sitio: datos del negocio, tema (colores, tipografías, esquinas, fondo),
  plantilla y secciones de la página.
- Catálogo con categorías, productos, galería de hasta 5 fotos, favoritos, productos ocultos y
  **personalización por producto** (opciones de elegir una, varias o texto libre, con precio extra por alternativa).
- Publicación **atómica**: todo el sitio se guarda en una transacción; si algo falla, no se publica nada.
- Catálogo de opciones válidas (`/meta`): el frontend construye sus formularios con él y no duplica reglas.

**Pedidos**
- Creación de pedidos con **precios recalculados en el servidor** (el navegador nunca envía precios).
- Folio consecutivo (`#0001`), fecha de entrega, lugar de entrega o domicilio con zonas de cobertura.
- **Idempotencia**: un mismo `requestId` nunca crea dos pedidos (doble clic, reintentos de red).
- «Mis pedidos»: el cliente consulta su historial con su correo **y** teléfono.

**Avisos al negocio y al cliente**
- **Telegram**: mensaje con el pedido completo, enlace al mapa y teléfono del cliente.
- **Correo al negocio** y **comprobante al cliente**, con el logo, los colores del tema y miniaturas de los productos.
- Envío por **Gmail** (contraseña de aplicación) o **Resend**.
- Patrón *outbox*: primero se guarda el pedido y después se avisa. Cada canal se reintenta por separado con
  espera progresiva; un pedido nunca se pierde aunque Telegram o el correo fallen.

**Imágenes**
- Subida desde el panel (JPG, PNG o WebP, validados por su firma binaria, máx. 3 MB).
- Almacenamiento en **Cloudinary** o, sin configurarlo, en **MongoDB**.

---

## Tecnologías

| Área | Tecnología |
|---|---|
| Lenguaje y entorno | Node.js 22+ (ES Modules) |
| Framework HTTP | Fastify 5 |
| Base de datos | MongoDB (driver oficial 6), transacciones con réplica |
| Validación | JSON Schema (Ajv, integrado en Fastify) |
| Autenticación | JWT HS256 (`@fastify/jwt`) y contraseña con hash scrypt |
| Seguridad HTTP | `@fastify/helmet`, `@fastify/cors`, `@fastify/rate-limit` |
| Correo | Nodemailer (Gmail SMTP) o API de Resend |
| Mensajería | API de bots de Telegram |
| Imágenes | Cloudinary (opcional) o MongoDB |
| Pruebas | `node:test` con `mongodb-memory-server` |
| Contenedor | Docker |

Sin ORM ni frameworks adicionales: cada módulo separa rutas, reglas de negocio y acceso a datos.

---

## Arquitectura

```
src/
├── server.js              Arranque y cierre ordenado (SIGINT / SIGTERM)
├── app.js                 buildApp(env): registra plugins y módulos (se reutiliza en las pruebas)
├── config/env.js          Validación de variables de entorno: falla al arrancar, nunca en una petición
├── plugins/               mongo (conexión única) · security · auth (JWT) · errors (respuestas uniformes)
├── modules/
│   ├── meta/              Catálogo de opciones válidas
│   ├── auth/              Inicio de sesión del administrador
│   ├── site/              routes → service (reglas) → repository (MongoDB) · schemas (contrato)
│   ├── images/            Subida y entrega de imágenes (Cloudinary o MongoDB)
│   └── orders/
│       ├── orders.routes.js       POST /orders y /orders/mine, reintentos periódicos
│       ├── orders.service.js      Crear, guardar y avisar; reintentos con espera progresiva
│       ├── orders.rules.js        Precios, personalización, entrega, fecha y teléfono
│       ├── orders.repository.js   Pedidos, folios y estado de cada aviso
│       ├── notifiers.js           Canales: Telegram, correo al negocio, comprobante al cliente
│       ├── orders.message.js      Mensaje de Telegram
│       ├── email.message.js       Plantillas HTML de los correos
│       └── telegram.notifier.js · gmail.client.js · resend.client.js
├── shared/
│   ├── catalog.js         Opciones válidas (fuentes, plantillas, monedas, límites)
│   ├── defaults.js        Contenido inicial del sitio
│   └── textRules.js       Patrones de texto permitidos (nombres, direcciones, correos…)
└── lib/                   password (scrypt) · httpError
test/                      Pruebas de integración
scripts/hash-password.js   Genera el hash de la contraseña del administrador
```

---

## Puesta en marcha

**Requisitos:** Node.js 22 o superior, pnpm y una base de datos MongoDB con réplica
(MongoDB Atlas, incluido su plan gratuito, ya la tiene).

```bash
pnpm install
cp .env.example .env                  # completa las variables (ver abajo)
pnpm hash-password "tu-contraseña"    # copia el resultado en ADMIN_PASSWORD_HASH
pnpm dev                              # http://localhost:3000
```

| Comando | Uso |
|---|---|
| `pnpm dev` | Desarrollo con recarga automática |
| `pnpm start` | Producción |
| `pnpm test` | Pruebas (MongoDB en memoria; no toca tu base de datos) |
| `pnpm hash-password "…"` | Hash de la contraseña del administrador (mínimo 10 caracteres) |

Mientras no exista un sitio guardado, `GET /site` entrega el contenido inicial de `src/shared/defaults.js`.
El primer **Publicar** desde el panel crea las colecciones.

---

## Variables de entorno

La plantilla completa, con instrucciones, está en `.env.example`. **El archivo `.env` nunca se sube al repositorio.**

| Variable | Obligatoria | Descripción |
|---|---|---|
| `MONGODB_URI` | Sí | Cadena de conexión de MongoDB |
| `MONGODB_DB_NAME` | No | Nombre de la base de datos (`catalogo`) |
| `JWT_SECRET` | Sí | Cadena aleatoria de 32 caracteres o más |
| `JWT_EXPIRES_IN` | No | Duración de la sesión del administrador (`8h`) |
| `ADMIN_PASSWORD_HASH` | Sí | Resultado de `pnpm hash-password` |
| `CORS_ORIGINS` | Sí | Dominios del frontend permitidos, separados por coma |
| `LOGIN_MAX_ATTEMPTS` · `LOGIN_WINDOW` | No | Intentos de inicio de sesión por IP (`5` cada `15 minutes`) |
| `CLOUDINARY_CLOUD_NAME` · `_API_KEY` · `_API_SECRET` | No | Las tres juntas; sin ellas las imágenes se guardan en MongoDB |
| `CLOUDINARY_FOLDER` | No | Carpeta en Cloudinary (`catalogo`) |
| `TELEGRAM_BOT_TOKEN` · `TELEGRAM_CHAT_ID` | No | Juntas. Bot y chat (o grupo) que reciben los pedidos |
| `GMAIL_APP_PASSWORD` | No | Contraseña de aplicación de Google (16 letras) para enviar desde Gmail |
| `RESEND_API_KEY` | No | Alternativa a Gmail (`re_…`) |
| `EMAIL_FROM` | Con correo | Remitente, p. ej. `Pedidos <cuenta@gmail.com>` |
| `EMAIL_ORDERS_TO` | No | Correos del negocio que reciben los pedidos, separados por coma |
| `ORDER_MAX_PER_WINDOW` · `ORDER_WINDOW` | No | Pedidos permitidos por IP (`10` cada `10 minutes`) |

**Telegram.** Crea un bot con **@BotFather** (`/newbot`) y copia el token. Escríbele un mensaje (o agrégalo a un
grupo) y consulta `getUpdates` de la API de bots: el valor `chat.id` es `TELEGRAM_CHAT_ID` (en grupos es negativo).

**Correo.** Con Gmail activa la verificación en dos pasos, crea una *contraseña de aplicación* y usa esa misma
cuenta en `EMAIL_FROM`. Con Resend, el remitente debe ser de un dominio verificado.

Telegram y el correo son opcionales: sin ellos los pedidos se guardan igual y los avisos se envían en cuanto se
configuren (los de las últimas 24 horas). Una configuración de correo inválida no detiene el API: se desactiva
ese canal y se indica en el log.

---

## Endpoints

Prefijo: `/api/v1`. Todas las respuestas son JSON; los errores tienen la forma
`{ "error": "mensaje", "details": ["«Campo» motivo"] }`.

| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| `GET` | `/health` *(sin prefijo)* | Público | Estado del servicio y de la base de datos |
| `GET` | `/meta` | Público | Opciones válidas: fuentes, colores, plantillas, secciones, límites |
| `GET` | `/site` | Público | Sitio publicado (solo productos visibles) |
| `POST` | `/orders` | Público · límite por IP | Crea un pedido y devuelve `{ folio, number, publicId, total, approximate, deliveryDate }` |
| `POST` | `/orders/mine` | Público · límite por IP | Pedidos de un cliente; requiere `{ email, phone }` |
| `GET` | `/images/:id` | Público | Imagen guardada en MongoDB, con caché de un año |
| `POST` | `/auth/login` | Público · límite de intentos | `{ password }` → `{ token, expiresIn }` |
| `GET` | `/admin/site` | Token | Sitio completo, incluidos productos ocultos |
| `PUT` | `/admin/site` | Token | Publica el sitio completo (validado y atómico) |
| `POST` | `/admin/images` | Token | Sube una imagen (cuerpo binario JPG, PNG o WebP) → `{ url }` |

<details>
<summary>Ejemplo: crear un pedido</summary>

```json
POST /api/v1/orders
{
  "requestId": "3f9c2a7e5b1d4c8fa0e6b2d9c7a1f4e3",
  "customer": { "name": "Ana López", "phone": "+524421234567", "email": "ana@correo.com" },
  "deliveryDate": "2026-11-14",
  "delivery": {
    "type": "home",
    "address": { "street": "Av. Constituyentes", "exterior": "120", "neighborhood": "Centro", "city": "Querétaro", "state": "Querétaro" }
  },
  "items": [{ "productId": "pastel-chocolate", "quantity": 2, "choices": [{ "group": "Tamaño", "value": "Grande" }] }],
  "notes": "Sin nueces"
}
```

`delivery.type` puede ser `point` (lugar definido por el negocio, con `point`), `home` (domicilio, con `address`)
o `arrange` (por coordinar; solo si el negocio no configuró entregas).
</details>

---

## Flujo de un pedido

```
Cliente ──► POST /orders
              1. Valida el contrato (JSON Schema) y la trampa anti-bots
              2. Recalcula precios y valida personalización, entrega, fecha y teléfono contra el catálogo publicado
              3. Guarda el pedido con folio consecutivo y una "foto" del negocio (logo, colores)
              4. Responde al cliente con su folio
              5. En segundo plano, por cada canal:  Telegram · correo al negocio · comprobante al cliente
                     └─ si falla: reintenta (1, 2, 4, 8… hasta cada 30 min; 12 intentos)
                     └─ si es un error de configuración: lo registra y no reintenta
```

Cada aviso guarda su estado en `notifications.<canal>` (`pending`, `sent`, `failed`, `abandoned`, `skipped`) con el
número de intentos y el último error, lo que permite saber exactamente qué se envió.

---

## Seguridad y validación

- **Contraseña del administrador** con hash scrypt y comparación en tiempo constante.
- **JWT HS256** con caducidad; el secreto se valida al arrancar (32+ caracteres).
- **Límites por IP**: global, inicio de sesión, creación de pedidos y consulta de «Mis pedidos».
- **CORS** solo para los dominios de `CORS_ORIGINS`; cabeceras de seguridad con Helmet.
- **Validación estricta de todo lo público**: nombres solo con letras, teléfono con lada +52/+1 y 10 dígitos,
  correo con formato real, direcciones con caracteres permitidos, textos libres sin `< > { } [ ] \ ^ | ~` ni
  comillas invertidas, y largo máximo en cada campo. Los campos desconocidos se descartan.
- **El panel** acepta textos más abiertos, sin caracteres de control; las URLs solo admiten `http(s)` o rutas relativas.
- Precios, folios y totales los calcula siempre el servidor.
- Los mensajes de Telegram y los correos escapan todo texto; los errores 5xx nunca exponen detalles internos.
- Imágenes validadas por su contenido real, no solo por la cabecera `Content-Type`.

---

## Modelo de datos

| Colección | Contenido |
|---|---|
| `settings` | Documento `_id: "site"` con `business`, `theme` y `layout` |
| `categories` | Categorías con su `order` |
| `products` | Productos con `order`, `active` y personalización |
| `orders` | Pedidos: cliente, entrega, fecha, artículos con precio, total, marca del negocio y estado de cada aviso |
| `counters` | Contador atómico del folio |
| `images` | Imágenes subidas cuando no se usa Cloudinary |

**Agregar un tipo de sección:** regístralo en `SECTION_TYPES` (`shared/catalog.js`), sus valores iniciales en
`SECTION_DEFAULT_PROPS` (`shared/defaults.js`) y sus campos en `sectionProps` (`modules/site/site.schemas.js`);
después crea su componente en pedidolisto-app.

---

## Pruebas

```bash
pnpm test
```

Más de 100 pruebas de integración sobre la app completa con MongoDB en memoria: configuración, autenticación,
publicación del sitio, imágenes, creación de pedidos, precios, idempotencia, validación de cada campo público,
canales de aviso independientes, reintentos, plantillas de correo y «Mis pedidos».

---

## Despliegue

El API es un servicio Node.js con estado en MongoDB. Incluye `Dockerfile`:

```bash
docker build -t pedidolisto-api .
docker run -p 8080:8080 --env-file .env pedidolisto-api
```

En producción:
- Define `NODE_ENV=production` y el dominio del frontend en `CORS_ORIGINS`.
- Configura los secretos en el panel de la plataforma (variables de entorno o gestor de secretos), nunca en el repositorio.
- Usa bases de datos y chats de Telegram distintos para los ambientes de pruebas y producción.
