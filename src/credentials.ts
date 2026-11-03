import { createCipheriv, createHash, randomBytes } from "node:crypto";

export function encryptAES(text: string, secret: string) {
  const salt = randomBytes(8);
  const passinput = Buffer.concat([Buffer.from(secret, "binary"), salt]);
  const hashes = [];
  let digest = passinput;
  for (let i = 0; i < 3; i++) {
    hashes[i] = createHash("md5").update(digest).digest();
    digest = Buffer.concat([hashes[i], passinput]);
  }
  const keyDerivation = Buffer.concat(hashes);
  const key = keyDerivation.subarray(0, 32);
  const iv = keyDerivation.subarray(32);
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  return Buffer.concat([
    Buffer.from("Salted__", "utf8"),
    salt,
    cipher.update(text),
    cipher.final(),
  ]).toString("base64");
}
