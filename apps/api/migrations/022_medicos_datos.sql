-- 022: datos completos del médico: teléfono, redes, establecimiento donde labora y origen del registro.
-- La provincia y el municipio salen del establecimiento cuando se elige uno.
-- Reversible: ver bloque DOWN.

ALTER TABLE medicos ADD COLUMN IF NOT EXISTS telefono text;
ALTER TABLE medicos ADD COLUMN IF NOT EXISTS direccion text;
ALTER TABLE medicos ADD COLUMN IF NOT EXISTS redes jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE medicos ADD COLUMN IF NOT EXISTS establecimiento_id uuid REFERENCES establecimientos(id);
ALTER TABLE medicos ADD COLUMN IF NOT EXISTS lat numeric(9,6);
ALTER TABLE medicos ADD COLUMN IF NOT EXISTS lng numeric(9,6);
ALTER TABLE medicos ADD COLUMN IF NOT EXISTS place_id text;
ALTER TABLE medicos ADD COLUMN IF NOT EXISTS fuente text NOT NULL DEFAULT 'manual' CHECK (fuente IN ('manual', 'google', 'documento', 'ia', 'receta'));
CREATE UNIQUE INDEX IF NOT EXISTS medicos_place_id ON medicos (place_id) WHERE place_id IS NOT NULL;

-- DOWN
-- DROP INDEX medicos_place_id;
-- ALTER TABLE medicos DROP COLUMN fuente, DROP COLUMN place_id, DROP COLUMN lng, DROP COLUMN lat,
--   DROP COLUMN establecimiento_id, DROP COLUMN redes, DROP COLUMN direccion, DROP COLUMN telefono;
