import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Cifrado simétrico para credenciales de integraciones (tokens OAuth, etc.).
 * AES-256-GCM con clave de entorno INTEGRATION_CREDENTIALS_KEY (64 hex —
 * generar con `openssl rand -hex 32`). El texto cifrado es autocontenida:
 * `v1.<iv>.<tag>.<datos>` en base64url. NUNCA guardar credenciales en claro.
 */

function key(): Buffer {
  const hex = process.env.INTEGRATION_CREDENTIALS_KEY;
  if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error(
      "INTEGRATION_CREDENTIALS_KEY no configurada o inválida (debe ser 64 hex; genera una con `openssl rand -hex 32`).",
    );
  }
  return Buffer.from(hex, "hex");
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${data.toString("base64url")}`;
}

export function decryptSecret(payload: string): string {
  const [version, iv, tag, data] = payload.split(".");
  if (version !== "v1" || !iv || !tag || !data) {
    throw new Error("Credencial cifrada con formato desconocido.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
