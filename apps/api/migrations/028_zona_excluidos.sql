-- Lugares que un representante NO visita aunque estén en su zona (quitados solo de su ruta, no del catálogo).
ALTER TABLE zonas_representante ADD COLUMN IF NOT EXISTS excluidos jsonb NOT NULL DEFAULT '[]'::jsonb;
