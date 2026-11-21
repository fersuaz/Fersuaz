import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { MemoryStore } from '../src/store.js';
import { MemoryData } from '../src/data.js';
import { MemoryFiles } from '../src/files.js';
import { createApp } from '../src/server.js';
import { hashPassword } from '../src/security.js';
import { totalPedido } from '../src/tienda.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString('base64');

test('total del pedido con centavos', () => {
  const t = totalPedido([{ precio: 125.5, cantidad: 3 }, { precio: 0.1, cantidad: 3 }]);
  assert.equal(t.total, 376.8); assert.equal(t.unidades, 6); assert.equal(t.items[0].subtotal, 376.5);
});

test('tienda: catálogo público sin precio, pedido de la farmacia, estados y venta al entregar', async () => {
  const store = new MemoryStore(); const data = new MemoryData();
  const server = createServer(createApp({ store, data, files: new MemoryFiles(), sessionSecret: 'x'.repeat(40) })).listen(0);
  const url = `http://127.0.0.1:${server.address().port}`;
  const call = async (m, p, b, t) => { const r = await fetch(url + p, { method: m, headers: { 'content-type': 'application/json', ...(t && { authorization: `Bearer ${t}` }) }, body: b && JSON.stringify(b) }); return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : await r.arrayBuffer() }; };
  const entrar = async (email) => (await call('POST', '/api/auth/login', { email, password: 'clave123456' })).body.token;
  try {
    const hash = await hashPassword('clave123456');
    await store.createUser({ fullName: 'Admin Ejemplo', email: 'adm@x.do', status: 'activo', passwordHash: hash, role: 'administrador' });
    const far = await data.insert('farmacias', { nombre: 'Farmacia Ejemplo', provincia: 'Santiago', municipio: 'Tamboril', fuente: 'manual', estado: 'validada' });
    const otra = await data.insert('farmacias', { nombre: 'Farmacia Otra Ejemplo', provincia: 'La Vega', municipio: 'Jarabacoa', fuente: 'manual', estado: 'validada' });
    await store.createUser({ fullName: 'Dependiente Ejemplo', email: 'dep@x.do', status: 'activo', passwordHash: hash, role: 'dependiente', farmaciaId: far.id });
    await store.createUser({ fullName: 'Dependiente Otra', email: 'dep2@x.do', status: 'activo', passwordHash: hash, role: 'dependiente', farmaciaId: otra.id });
    const ven = await store.createUser({ fullName: 'Vendedor Ejemplo', email: 'ven@x.do', status: 'activo', passwordHash: hash, role: 'representante', position: 'Vendedor' });
    await data.insert('zonas', { representanteId: ven.id, provincias: ['Santiago'], municipios: {} });
    const med = await data.insert('medicamentos', { nombre: 'Jarabe Ejemplo', presentacion: 'Frasco 120 ml', precio: 250, activo: true });
    const [adm, dep, dep2, vt] = await Promise.all(['adm@x.do', 'dep@x.do', 'dep2@x.do', 'ven@x.do'].map(entrar));

    // Publicar: exige foto
    assert.equal((await call('POST', `/api/tienda/admin/${med.id}`, { publicado: true }, adm)).status, 422);
    assert.equal((await call('POST', `/api/tienda/admin/${med.id}`, { publicado: true }, dep)).status, 403, 'la dependiente no publica');
    const foto = await call('POST', `/api/tienda/admin/${med.id}/foto`, { foto: { tipo: 'image/png', base64: PNG, nombre: 'frente.png' } }, adm);
    assert.equal(foto.status, 200, JSON.stringify(foto.body));
    await call('POST', `/api/tienda/admin/${med.id}`, { fotosSitio: ['assets/producto/tio-dex-caja.jpg', 'https://malo.example/x.jpg'], descripcion: 'Ejemplo de descripción.', ficha: [{ dato: 'Presentación', valor: 'Frasco 120 ml' }] }, adm);
    const pub = await call('POST', `/api/tienda/admin/${med.id}`, { publicado: true }, adm);
    assert.equal(pub.body.item.publicado, true); assert.equal(pub.body.item.imagenes.length, 2, 'solo fotos del sitio permitidas');

    // Público: sin precio. Con sesión: con precio. La foto subida se ve sin sesión.
    const pubLista = await call('GET', '/api/tienda/productos');
    assert.equal(pubLista.body.items.length, 1); assert.equal('precio' in pubLista.body.items[0], false);
    assert.equal((await call('GET', '/api/tienda/productos', null, dep)).body.items[0].precio, 250);
    const img = pubLista.body.items[0].imagenes.find((x) => x.url.startsWith('/api/'));
    assert.equal((await call('GET', img.url)).status, 200);

    // Pedido: el precio sale del catálogo, no del navegador
    assert.equal((await call('POST', '/api/pedidos', { items: [{ medicamentoId: med.id, cantidad: 4 }], pago: 'credito' }, vt)).status, 403, 'solo la dependiente pide');
    const p = await call('POST', '/api/pedidos', { items: [{ medicamentoId: med.id, cantidad: 4, precio: 1 }], pago: 'transferencia', nota: 'Ejemplo' }, dep);
    assert.equal(p.status, 201, JSON.stringify(p.body));
    assert.equal(p.body.item.total, 1000); assert.equal(p.body.item.numero, 'P-000001'); assert.equal(p.body.item.vendedorId, ven.id);
    const avisos = await data.list('notificaciones', { usuarioId: ven.id });
    assert.match(avisos[0].titulo, /Pedido nuevo P-000001/);

    // Quién lo ve
    assert.equal((await call('GET', '/api/pedidos', null, dep2)).body.items.length, 0, 'otra farmacia no lo ve');
    assert.equal((await call('GET', '/api/pedidos', null, vt)).body.items.length, 1, 'el vendedor de la zona sí');
    const id = p.body.item.id;
    assert.equal((await call('POST', `/api/pedidos/${id}/estado`, { estado: 'confirmado' }, dep)).status, 403, 'la farmacia no confirma');
    assert.equal((await call('POST', `/api/pedidos/${id}/estado`, { estado: 'entregado' }, vt)).status, 409, 'no salta estados');
    await call('POST', `/api/pedidos/${id}/estado`, { estado: 'confirmado' }, vt);
    await call('POST', `/api/pedidos/${id}/estado`, { estado: 'despachado' }, adm);
    const ent = await call('POST', `/api/pedidos/${id}/estado`, { estado: 'entregado' }, adm);
    assert.equal(ent.status, 200, JSON.stringify(ent.body)); assert.equal(ent.body.item.venta.insertadas, 1);
    const ventas = await data.list('ventasFarmacia');
    assert.equal(ventas[0].fuente, 'pedido'); assert.equal(ventas[0].unidades, 4); assert.equal(ventas[0].factura, 'P-000001');
    const inv = (await data.list('inventario')).filter((x) => x.fuente === 'venta');
    assert.equal(inv[0].unidades, 4);
    assert.equal(ent.body.item.historial.length, 4);

    // Cancelar: la farmacia solo mientras está recibido, con motivo
    const p2 = (await call('POST', '/api/pedidos', { items: [{ medicamentoId: med.id, cantidad: 1 }], pago: 'contra_entrega' }, dep)).body.item;
    assert.equal((await call('POST', `/api/pedidos/${p2.id}/estado`, { estado: 'cancelado' }, dep)).status, 422, 'sin motivo');
    assert.equal((await call('POST', `/api/pedidos/${p2.id}/estado`, { estado: 'cancelado', nota: 'Ya no lo necesito' }, dep)).body.item.estado, 'cancelado');
    // Producto despublicado: no se puede pedir
    await call('POST', `/api/tienda/admin/${med.id}`, { publicado: false }, adm);
    assert.equal((await call('POST', '/api/pedidos', { items: [{ medicamentoId: med.id, cantidad: 1 }], pago: 'credito' }, dep)).status, 422);
    assert.equal((await call('GET', `/api/tienda/productos/${med.id}`)).status, 404);
  } finally { server.close(); }
});
