-- 005: territorio, establecimientos de salud, zonas de representantes, pre-registro y precios de medicamentos.

ALTER TABLE medicamentos ADD COLUMN IF NOT EXISTS precio numeric(12,2) CHECK (precio IS NULL OR precio > 0);

CREATE TABLE IF NOT EXISTS precios_medicamento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  medicamento_id uuid NOT NULL REFERENCES medicamentos(id),
  precio numeric(12,2) NOT NULL CHECK (precio > 0),
  vigente_desde date NOT NULL,
  fuente text NOT NULL DEFAULT 'manual' CHECK (fuente IN ('manual','excel')),
  registrado_por uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz
);
CREATE INDEX IF NOT EXISTS precios_medicamento_med ON precios_medicamento (medicamento_id, vigente_desde DESC);

ALTER TABLE farmacias ADD COLUMN IF NOT EXISTS direccion text;
ALTER TABLE farmacias ADD COLUMN IF NOT EXISTS telefono text;
ALTER TABLE farmacias ADD COLUMN IF NOT EXISTS lat numeric(9,6);
ALTER TABLE farmacias ADD COLUMN IF NOT EXISTS lng numeric(9,6);
ALTER TABLE farmacias ADD COLUMN IF NOT EXISTS place_id text;
ALTER TABLE farmacias ADD COLUMN IF NOT EXISTS fuente text NOT NULL DEFAULT 'manual';
CREATE UNIQUE INDEX IF NOT EXISTS farmacias_place ON farmacias (place_id) WHERE place_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS establecimientos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL CHECK (tipo IN ('clinica','hospital','unap','cpn','diagnostico','consultorio')),
  nombre text NOT NULL, provincia text NOT NULL, municipio text NOT NULL, sector text, direccion text, telefono text,
  lat numeric(9,6), lng numeric(9,6), place_id text,
  fuente text NOT NULL DEFAULT 'manual' CHECK (fuente IN ('manual','excel','google')),
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','validado','inactivo')),
  creado_por uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS establecimientos_unico ON establecimientos (lower(nombre), lower(municipio));
CREATE UNIQUE INDEX IF NOT EXISTS establecimientos_place ON establecimientos (place_id) WHERE place_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS establecimientos_zona ON establecimientos (provincia, municipio);

CREATE TABLE IF NOT EXISTS zonas_representante (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  representante_id uuid NOT NULL UNIQUE REFERENCES users(id),
  provincias jsonb NOT NULL DEFAULT '[]',
  actualizado_por uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz
);

CREATE TABLE IF NOT EXISTS preregistros (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL, nombre text NOT NULL, telefono text,
  posicion text NOT NULL CHECK (posicion IN ('Visitador','PVC','Vendedor','Promotora')),
  provincias jsonb NOT NULL DEFAULT '[]',
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','usado','anulado')),
  usuario_id uuid REFERENCES users(id),
  creado_por uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS preregistros_email_pendiente ON preregistros (lower(email)) WHERE estado = 'pendiente';

-- DOWN:
-- DROP TABLE preregistros; DROP TABLE zonas_representante; DROP TABLE establecimientos; DROP TABLE precios_medicamento;
-- ALTER TABLE farmacias DROP COLUMN direccion, DROP COLUMN telefono, DROP COLUMN lat, DROP COLUMN lng, DROP COLUMN place_id, DROP COLUMN fuente;
-- ALTER TABLE medicamentos DROP COLUMN precio;
