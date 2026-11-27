-- Unidades por caja de cada medicamento (tabletas, cápsulas, sobres…). Vacío para jarabes y productos que no se
-- venden por unidad. Precio por unidad (costo a farmacia) = precio de la caja ÷ unidades por caja.
ALTER TABLE medicamentos ADD COLUMN IF NOT EXISTS unidades_por_caja integer;

-- La dependiente puede enviar un voucher solo con la foto (sin medicamentos, total 0). La revisión lo completa
-- y no se aprueba con total 0 (regla en la API).
ALTER TABLE vouchers DROP CONSTRAINT IF EXISTS vouchers_total_check;
ALTER TABLE vouchers ADD CONSTRAINT vouchers_total_check CHECK (total >= 0);
