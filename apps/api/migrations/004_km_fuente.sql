-- 004: de dónde salen los km de cada jornada ('manual' o el proveedor de mapas).
ALTER TABLE jornadas ADD COLUMN IF NOT EXISTS km_fuente text NOT NULL DEFAULT 'manual' CHECK (km_fuente IN ('manual','google'));
-- DOWN: ALTER TABLE jornadas DROP COLUMN km_fuente;
