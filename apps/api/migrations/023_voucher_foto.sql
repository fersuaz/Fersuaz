-- 023: vouchers con foto. El número de voucher deja de ser obligatorio: cada voucher lleva su foto,
-- y una misma foto no se puede cargar dos veces (huella SHA-256 del archivo original).
-- Reversible: ver bloque DOWN.

ALTER TABLE vouchers ALTER COLUMN referencia DROP NOT NULL;
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS foto jsonb;
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS foto_huella text;
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS foto_dhash text; -- huella de parecido (misma imagen reenviada o comprimida)
CREATE INDEX IF NOT EXISTS vouchers_foto_huella ON vouchers (foto_huella) WHERE foto_huella IS NOT NULL;

-- Recetas: la misma foto no se carga dos veces por la misma promotora.
ALTER TABLE recetas ADD COLUMN IF NOT EXISTS foto_huella text;
ALTER TABLE recetas ADD COLUMN IF NOT EXISTS foto_dhash text;
CREATE INDEX IF NOT EXISTS recetas_foto_huella ON recetas (foto_huella) WHERE foto_huella IS NOT NULL;

-- DOWN
-- DROP INDEX recetas_foto_huella; ALTER TABLE recetas DROP COLUMN foto_dhash, DROP COLUMN foto_huella;
-- DROP INDEX vouchers_foto_huella;
-- ALTER TABLE vouchers DROP COLUMN foto_dhash, DROP COLUMN foto_huella, DROP COLUMN foto;
-- UPDATE vouchers SET referencia = id::text WHERE referencia IS NULL; ALTER TABLE vouchers ALTER COLUMN referencia SET NOT NULL;
