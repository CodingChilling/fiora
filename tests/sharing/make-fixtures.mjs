// Genera una clave de API de Oracle de prueba (no vale para nada real): clave privada, pública,
// el texto de configuración que pega el usuario y el keyId que espera el emulador.
import crypto from 'node:crypto';
import fs from 'node:fs';
const dir = new URL('./fixtures/', import.meta.url);
fs.mkdirSync(dir, { recursive: true });
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const der = publicKey.export({ type: 'spki', format: 'der' });
const fingerprint = crypto.createHash('md5').update(der).digest('hex').match(/../g).join(':');
const user = 'ocid1.user.oc1..aaaaprueba', tenancy = 'ocid1.tenancy.oc1..aaaaprueba';
fs.writeFileSync(new URL('key.pem', dir), privateKey.export({ type: 'pkcs1', format: 'pem' }));
fs.writeFileSync(new URL('pub.pem', dir), publicKey.export({ type: 'spki', format: 'pem' }));
fs.writeFileSync(new URL('keyid.txt', dir), `${tenancy}/${user}/${fingerprint}\n`);
fs.writeFileSync(new URL('config.txt', dir), `[DEFAULT]\nuser=${user}\nfingerprint=${fingerprint}\ntenancy=${tenancy}\nregion=eu-madrid-1\nkey_file=<path to your private keyfile> # TODO\n`);
console.log('Clave de prueba en tests/sharing/fixtures/');
