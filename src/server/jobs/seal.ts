// Segreti nei lavori in coda (00 §4.3, 01 FON-T10): un token in chiaro che passa per una coda (per esempio un link
// d'invito nel lavoro `email.send`) si cifra con AES-256-GCM e la chiave JOB_PAYLOAD_KEY (32 byte in base64), che
// hanno solo app e worker e che non sta né nel database né nei backup: le righe di pgboss.job, i WAL e i backup
// contengono solo il testo cifrato. GCM controlla anche l'integrità: un testo alterato o una chiave sbagliata non si
// aprono. Formato: `v1.<iv>.<tag>.<testo cifrato>`, ciascuna parte in base64url.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** La chiave di 32 byte: quella data, oppure JOB_PAYLOAD_KEY dell'ambiente. Gli errori nominano la variabile, mai il valore. */
function resolveKey(keyBase64: string | undefined): Buffer {
  const value = keyBase64 ?? process.env.JOB_PAYLOAD_KEY;
  if (value === undefined || value === '') throw new Error('Manca JOB_PAYLOAD_KEY.');
  const key = Buffer.from(value, 'base64');
  if (key.length !== KEY_BYTES) throw new Error('JOB_PAYLOAD_KEY non valida: servono 32 byte in base64.');
  return key;
}

/** Cifra un testo per un lavoro in coda. Ogni cifratura ha un vettore iniziale nuovo. */
export function sealJobSecret(plaintext: string, keyBase64?: string): string {
  const key = resolveKey(keyBase64);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, ciphertext]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
    .join('.');
}

/** Apre un testo cifrato da sealJobSecret; con una chiave sbagliata o un testo alterato solleva un errore. */
export function openJobSecret(sealed: string, keyBase64?: string): string {
  const key = resolveKey(keyBase64);
  const parts = sealed.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) throw new Error('Segreto del lavoro in un formato sconosciuto.');
  const [iv, tag, ciphertext] = parts.slice(1).map((part) => Buffer.from(part, 'base64url'));
  if (iv?.length !== IV_BYTES || tag?.length !== TAG_BYTES || ciphertext === undefined) {
    throw new Error('Segreto del lavoro in un formato sconosciuto.');
  }
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Segreto del lavoro non apribile: chiave diversa o testo alterato.');
  }
}
