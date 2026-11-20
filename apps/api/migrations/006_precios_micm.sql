-- 006: origen de cada precio de combustible (manual o aviso oficial del MICM) y enlace a la fuente.
ALTER TABLE precios_combustible ADD COLUMN IF NOT EXISTS fuente text NOT NULL DEFAULT 'manual' CHECK (fuente IN ('manual','micm'));
ALTER TABLE precios_combustible ADD COLUMN IF NOT EXISTS enlace text;
-- DOWN: ALTER TABLE precios_combustible DROP COLUMN fuente, DROP COLUMN enlace;
