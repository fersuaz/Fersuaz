-- 009: cada dependiente queda ligada a la farmacia del catálogo donde trabaja (provincia, municipio y sector oficiales).
ALTER TABLE users ADD COLUMN IF NOT EXISTS farmacia_id uuid REFERENCES farmacias(id);

-- DOWN:
-- ALTER TABLE users DROP COLUMN farmacia_id;
