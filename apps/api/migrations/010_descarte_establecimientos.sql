-- 010: registros que no son centros de salud (traídos por error desde Google). Se marcan inactivos con motivo; se pueden restaurar.
ALTER TABLE establecimientos ADD COLUMN IF NOT EXISTS descarte_motivo text;
ALTER TABLE establecimientos ADD COLUMN IF NOT EXISTS descartado_por uuid REFERENCES users(id);

-- DOWN:
-- ALTER TABLE establecimientos DROP COLUMN descartado_por; ALTER TABLE establecimientos DROP COLUMN descarte_motivo;
