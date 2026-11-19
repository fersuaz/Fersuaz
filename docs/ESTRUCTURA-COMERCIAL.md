# Estructura del sistema del departamento comercial (resumen del documento original)

Objetivo general: automatizar todos los procesos del departamento comercial — promotores, visitadores,
vendedores, KPI, aportes a médicos, inventario, dependientes, visitas y programa educativo.

## Objetivos específicos
1. **Recetas de promotores.** Registro diario de provincia, municipio y centros del operativo. Cada receta:
   archivo/foto de la receta, desglose de medicamentos, reconocimiento del medicamento y asignación de su costo
   a la farmacia, y médico prescriptor. Permite contabilizar recetas por promotor, medicamentos por línea y
   prescriptores por provincia, municipio, centro y especialidad, y compararlos con unidades en farmacias cercanas.
   Alerta: cuando lo recetado se acerca al 75 % (configurable) del inventario de la zona, notificar a la promotora
   para coordinar compra con el vendedor. Implementado: `evaluarAlertaInventario` en `apps/api/src/calculos.js`.
   *Pendiente de validación gerencial:* confirmar la interpretación exacta del 75 %.
2. **Vouchers de dependientes.** El dependiente queda vinculado a provincia, municipio y farmacia; carga vouchers
   con uno o varios medicamentos y montos; el sistema calcula comisión con porcentaje configurable (ej. 10 %) y
   la paga por período quincenal o mensual (global o por dependiente). Implementado: `calcularComisionVouchers`.
3. **Replicar el módulo de ventas, aportes, inventario y unidades** que ya existe en Fersuaz.net (requiere acceso al código existente).
4. **Sistema de compensación** para promotores, visitadores y vendedores que logren sus metas.

## Estructura tecnológica
Servidores: 10 · Base de datos: 1 · Balanceadores: 1 · Spaces: 1 · Cloudflare (SSL, CDN, optimización, anti-phishing/bots)
· Dominio: fersuaz.net · AWS SES (correo) · Twilio (SMS/WhatsApp).
