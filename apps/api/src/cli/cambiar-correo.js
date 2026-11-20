// Uso: npm run cambiar-correo -- correo-actual@dominio correo-nuevo@dominio
import { PostgresStore } from '../store.js';
import { cambiarCorreo } from '../cuentas.js';

const [actual, nuevo] = process.argv.slice(2);
if (!process.env.DATABASE_URL || !actual || !nuevo) { console.error('Uso: npm run cambiar-correo -- correo-actual correo-nuevo'); process.exit(1); }
const store = await PostgresStore.connect(process.env.DATABASE_URL);
try { const u = await cambiarCorreo(store, actual, nuevo); console.log(`Correo cambiado: ${u.fullName} <${u.email}>`); }
catch (e) { console.error(e.message); process.exitCode = 1; }
finally { await store.pool.end(); }
