-- Modelos de vehículo que no aparecen en FuelEconomy.gov (EPA), agregados por la gestión.
-- Quedan guardados para todos y se muestran junto a los modelos de la EPA.
-- DOWN: DROP TABLE IF EXISTS vehiculos_agregados;
CREATE TABLE IF NOT EXISTS vehiculos_agregados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  anio integer NOT NULL CHECK (anio BETWEEN 1980 AND 2100),
  marca text NOT NULL,
  modelo text NOT NULL,
  version text,
  km_por_galon numeric(6,1) NOT NULL CHECK (km_por_galon > 0 AND km_por_galon < 400),
  combustible text,
  creado_por uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS vehiculos_agregados_unico ON vehiculos_agregados (anio, lower(marca), lower(modelo), lower(coalesce(version, '')));
