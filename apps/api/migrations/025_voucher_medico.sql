-- Médico que prescribió en el voucher (opcional). Nombre guardado como estaba al cargarlo.
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS medico_id uuid;
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS medico text;
-- DOWN: ALTER TABLE vouchers DROP COLUMN medico_id; ALTER TABLE vouchers DROP COLUMN medico;
