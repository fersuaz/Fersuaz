// Uso: npm run cambiar-clave -- correo@dominio   (la contraseña se pide sin mostrarse)
import { PostgresStore } from '../store.js';
import { cambiarClave } from '../cuentas.js';
import { pedirClave } from './pedir-clave.js';

const [correo] = process.argv.slice(2);
if (!process.env.DATABASE_URL || !correo) { console.error('Uso: npm run cambiar-clave -- correo@dominio'); process.exit(1); }
const clave = await pedirClave('Contraseña nueva (mínimo 12 caracteres): ');
const otra = await pedirClave('Repítela: ');
if (clave !== otra) { console.error('Las contraseñas no coinciden.'); process.exit(1); }
const store = await PostgresStore.connect(process.env.DATABASE_URL);
try { const u = await cambiarClave(store, correo, clave); console.log(`Contraseña cambiada para ${u.email}.`); }
catch (e) { console.error(e.message); process.exitCode = 1; }
finally { await store.pool.end(); }
