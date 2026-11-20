// Crea el primer administrador (el registro público no permite ese rol).
// Uso: DATABASE_URL=... node src/cli/crear-admin.js "Nombre Completo" correo@fersuaz.net
// La contraseña se pide por la terminal y no queda en el historial.
import { createInterface } from 'node:readline/promises';
import { PostgresStore } from '../store.js';
import { hashPassword } from '../security.js';
import { normalizeName } from '../validation.js';

const [nombre, correo] = process.argv.slice(2);
if (!process.env.DATABASE_URL || !nombre || !correo) {
  console.error('Uso: DATABASE_URL=... node src/cli/crear-admin.js "Nombre" correo@dominio'); process.exit(1);
}
const rl = createInterface({ input: process.stdin, output: process.stdout });
const clave = await rl.question('Contraseña (mínimo 12 caracteres): ');
rl.close();
if (clave.length < 12) { console.error('La contraseña es demasiado corta.'); process.exit(1); }
const store = await PostgresStore.connect(process.env.DATABASE_URL);
const email = correo.trim().toLowerCase();
if (await store.findUserByEmail(email)) { console.error('Ya existe una cuenta con ese correo.'); process.exit(1); }
const u = await store.createUser({ fullName: normalizeName(nombre), email, phone: null, role: 'administrador', position: null, passwordHash: await hashPassword(clave), status: 'activo' });
await store.addAudit({ action: 'admin_creado_cli', entity: 'user', entityId: u.id, after: { email } });
console.log(`Administrador creado: ${u.fullName} <${u.email}>`);
await store.pool.end();
