-- Rechazo con opción de corrección, nota al aprobar, fecha de la decisión y número de correcciones.
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS corregible boolean NOT NULL DEFAULT false;
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS nota text;
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS decidido_at timestamptz;
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS correcciones integer NOT NULL DEFAULT 0;
-- DOWN: ALTER TABLE vouchers DROP COLUMN corregible, DROP COLUMN nota, DROP COLUMN decidido_at, DROP COLUMN correcciones;
