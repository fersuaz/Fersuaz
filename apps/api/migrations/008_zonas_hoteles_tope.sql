-- 008: zonas por municipio, hoteles con precio y requisitos, y tope mensual de combustible por representante.
ALTER TABLE zonas_representante ADD COLUMN IF NOT EXISTS municipios jsonb;
ALTER TABLE perfiles_viatico ADD COLUMN IF NOT EXISTS tope_combustible numeric(12,2) CHECK (tope_combustible IS NULL OR tope_combustible > 0);

CREATE TABLE IF NOT EXISTS hoteles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL,
  provincia text NOT NULL,
  municipio text NOT NULL,
  direccion text, telefono text,
  lat double precision, lng double precision,
  place_id text,
  calificacion numeric(3,1),
  fuente text NOT NULL DEFAULT 'manual' CHECK (fuente IN ('manual','google','excel')),
  precio_noche numeric(12,2) CHECK (precio_noche IS NULL OR precio_noche > 0),
  requisitos jsonb,
  notas text,
  verificado_por uuid REFERENCES users(id),
  verificado_en timestamptz,
  estado text NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo','inactivo')),
  creado_por uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS hoteles_place ON hoteles (place_id) WHERE place_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS hoteles_zona ON hoteles (provincia, municipio);

-- DOWN:
-- DROP TABLE hoteles; ALTER TABLE perfiles_viatico DROP COLUMN tope_combustible; ALTER TABLE zonas_representante DROP COLUMN municipios;
