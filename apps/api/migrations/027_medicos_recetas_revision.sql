-- Rol Médico: el médico se registra y carga sus recetas. Todas las recetas pasan por revisión.

-- 1) Rol nuevo
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('administrador','gerencia','supervisor','representante','finanzas','dependiente','medico'));

-- 2) Ficha del médico ligada a su cuenta, con sus lugares de trabajo (varias provincias, municipios y establecimientos)
ALTER TABLE medicos ADD COLUMN IF NOT EXISTS usuario_id uuid REFERENCES users(id);
ALTER TABLE medicos ADD COLUMN IF NOT EXISTS lugares jsonb;
ALTER TABLE medicos DROP CONSTRAINT IF EXISTS medicos_fuente_check;
ALTER TABLE medicos ADD CONSTRAINT medicos_fuente_check CHECK (fuente IN ('manual','google','documento','ia','receta','registro'));
CREATE UNIQUE INDEX IF NOT EXISTS medicos_usuario_unico ON medicos (usuario_id) WHERE usuario_id IS NOT NULL;

-- 3) Recetas: quién las cargó, dónde, y su revisión. Las que ya existen quedan aprobadas (ya contaban).
ALTER TABLE recetas ALTER COLUMN promotora_id DROP NOT NULL;
ALTER TABLE recetas ALTER COLUMN operativo_id DROP NOT NULL;
ALTER TABLE recetas ADD COLUMN IF NOT EXISTS cargado_por uuid REFERENCES users(id);
ALTER TABLE recetas ADD COLUMN IF NOT EXISTS establecimiento_id uuid;
ALTER TABLE recetas ADD COLUMN IF NOT EXISTS estado text NOT NULL DEFAULT 'aprobada';
ALTER TABLE recetas ALTER COLUMN estado SET DEFAULT 'pendiente';
ALTER TABLE recetas ADD COLUMN IF NOT EXISTS motivo text;
ALTER TABLE recetas ADD COLUMN IF NOT EXISTS nota text;
ALTER TABLE recetas ADD COLUMN IF NOT EXISTS decidido_por uuid;
ALTER TABLE recetas ADD COLUMN IF NOT EXISTS decidido_at timestamptz;
ALTER TABLE recetas ADD COLUMN IF NOT EXISTS corregible boolean NOT NULL DEFAULT false;
UPDATE recetas SET cargado_por = promotora_id WHERE cargado_por IS NULL;
CREATE INDEX IF NOT EXISTS recetas_estado ON recetas (estado);
-- DOWN: DROP INDEX recetas_estado; ALTER TABLE recetas DROP COLUMN cargado_por, DROP COLUMN establecimiento_id, DROP COLUMN estado,
--   DROP COLUMN motivo, DROP COLUMN nota, DROP COLUMN decidido_por, DROP COLUMN decidido_at, DROP COLUMN corregible;
--   DROP INDEX medicos_usuario_unico; ALTER TABLE medicos DROP COLUMN usuario_id, DROP COLUMN lugares;
--   (antes de volver a poner NOT NULL en promotora_id/operativo_id, borrar o reasignar las recetas de médicos)
