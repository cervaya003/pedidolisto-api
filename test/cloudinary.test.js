import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, describe, test } from "node:test";
import { loadEnv } from "../src/config/env.js";
import { createCloudinaryStorage, signParams } from "../src/modules/images/cloudinary.storage.js";

const CONFIG = { cloudName: "demo", apiKey: "123", apiSecret: "secreto", folder: "catalogo" };
const BASE_ENV = { MONGODB_URI: "mongodb://x", JWT_SECRET: "x".repeat(40), ADMIN_PASSWORD_HASH: "h", CORS_ORIGINS: "http://a" };
const realFetch = globalThis.fetch;

afterEach(() => (globalThis.fetch = realFetch));

describe("Cloudinary", () => {
  test("firma los parámetros ordenados con el secreto (SHA-1)", () => {
    const expected = createHash("sha1").update("folder=catalogo&timestamp=100secreto").digest("hex");
    assert.equal(signParams({ timestamp: 100, folder: "catalogo" }, "secreto"), expected);
  });

  test("sube la imagen firmada y devuelve la URL segura", async () => {
    let sent;
    globalThis.fetch = async (url, options) => {
      sent = { url, form: options.body };
      return new Response(JSON.stringify({ secure_url: "https://res.cloudinary.com/demo/image/upload/v1/catalogo/x.webp" }));
    };

    const url = await createCloudinaryStorage(CONFIG).save({ contentType: "image/webp", data: Buffer.from("RIFF0000WEBP") });
    assert.equal(url, "https://res.cloudinary.com/demo/image/upload/v1/catalogo/x.webp");
    assert.equal(sent.url, "https://api.cloudinary.com/v1_1/demo/image/upload");
    assert.equal(sent.form.get("api_key"), "123");
    assert.equal(sent.form.get("folder"), "catalogo");
    assert.equal(sent.form.get("signature"), signParams({ folder: "catalogo", timestamp: Number(sent.form.get("timestamp")) }, "secreto"));
    assert.equal(sent.form.get("api_secret"), null, "el secreto nunca se envía");
  });

  test("un rechazo de Cloudinary da un error legible", async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "Invalid Signature" } }), { status: 401 });
    await assert.rejects(createCloudinaryStorage(CONFIG).save({ contentType: "image/png", data: Buffer.from("x") }), (error) => {
      assert.equal(error.statusCode, 502);
      assert.equal(error.expose, true);
      assert.match(error.message, /Invalid Signature/);
      return true;
    });
  });

  test("las variables son opcionales, pero van las tres juntas", () => {
    assert.equal(loadEnv(BASE_ENV).CLOUDINARY, null);
    assert.throws(() => loadEnv({ ...BASE_ENV, CLOUDINARY_CLOUD_NAME: "demo" }), /CLOUDINARY_API_KEY/);
    const env = loadEnv({ ...BASE_ENV, CLOUDINARY_CLOUD_NAME: "demo", CLOUDINARY_API_KEY: "1", CLOUDINARY_API_SECRET: "s" });
    assert.deepEqual({ ...env.CLOUDINARY }, { cloudName: "demo", apiKey: "1", apiSecret: "s", folder: "catalogo" });
  });
});
