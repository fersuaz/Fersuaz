-- Presupuesto del mes asignado por la gerencia desde el cronograma, y ajustes auditables
-- (por ejemplo, un hotel autorizado después de aprobar). Un ajuste nunca se borra.
-- DOWN: ALTER TABLE presupuestos_viatico DROP COLUMN IF EXISTS ajustes, DROP COLUMN IF EXISTS origen;
ALTER TABLE presupuestos_viatico ADD COLUMN IF NOT EXISTS ajustes jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE presupuestos_viatico ADD COLUMN IF NOT EXISTS origen text NOT NULL DEFAULT 'solicitado' CHECK (origen IN ('solicitado', 'asignado'));
