-- 002: dependientes (vouchers y comisiones) y promotoras (recetas, médicos, inventario).
-- Reversible: ver bloque DOWN al final.

CREATE TABLE IF NOT EXISTS medicamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL, linea text, presentacion text,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS medicamentos_unico ON medicamentos (lower(nombre), coalesce(presentacion, ''));

CREATE TABLE IF NOT EXISTS farmacias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL, provincia text NOT NULL, municipio text NOT NULL, sector text,
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','validada','inactiva')),
  creado_por uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS farmacias_unica ON farmacias (lower(nombre), lower(municipio));

CREATE TABLE IF NOT EXISTS medicos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL, especialidad text NOT NULL, centro text, provincia text NOT NULL, municipio text NOT NULL,
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','validado','inactivo')),
  creado_por uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz
);

CREATE TABLE IF NOT EXISTS vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dependiente_id uuid NOT NULL REFERENCES users(id),
  farmacia text, referencia text NOT NULL, fecha date NOT NULL, periodo text,
  items jsonb NOT NULL, total numeric(14,2) NOT NULL CHECK (total > 0),
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','aprobado','rechazado','anulado')),
  decidido_por uuid REFERENCES users(id), motivo text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz
);
CREATE INDEX IF NOT EXISTS vouchers_dep_fecha ON vouchers (dependiente_id, fecha);
CREATE UNIQUE INDEX IF NOT EXISTS vouchers_ref_unica ON vouchers (dependiente_id, lower(referencia)) WHERE estado <> 'anulado';

CREATE TABLE IF NOT EXISTS cierres_comision (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dependiente_id uuid NOT NULL REFERENCES users(id),
  periodo text NOT NULL, desde date NOT NULL, hasta date NOT NULL,
  ventas numeric(14,2) NOT NULL, porcentaje numeric(5,2) NOT NULL, comision numeric(14,2) NOT NULL,
  voucher_ids jsonb NOT NULL, cerrado_por uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz,
  UNIQUE (dependiente_id, periodo)
);

CREATE TABLE IF NOT EXISTS operativos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promotora_id uuid NOT NULL REFERENCES users(id),
  fecha date NOT NULL, provincia text NOT NULL, municipio text NOT NULL, centro text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz
);

CREATE TABLE IF NOT EXISTS recetas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promotora_id uuid NOT NULL REFERENCES users(id),
  operativo_id uuid NOT NULL REFERENCES operativos(id),
  medico_id uuid NOT NULL REFERENCES medicos(id),
  fecha date NOT NULL, provincia text NOT NULL, municipio text NOT NULL,
  items jsonb NOT NULL, adjunto jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz
);
CREATE INDEX IF NOT EXISTS recetas_zona_fecha ON recetas (lower(provincia), lower(municipio), fecha);

CREATE TABLE IF NOT EXISTS inventario (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farmacia_id uuid NOT NULL REFERENCES farmacias(id),
  medicamento_id uuid NOT NULL REFERENCES medicamentos(id),
  unidades integer NOT NULL CHECK (unidades >= 0), fecha_corte date NOT NULL,
  registrado_por uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz
);

CREATE TABLE IF NOT EXISTS configuracion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clave text NOT NULL UNIQUE, valor jsonb NOT NULL, actualizado_por uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz
);

-- DOWN (solo con autorización; borra datos):
-- DROP TABLE configuracion, inventario, recetas, operativos, cierres_comision, vouchers, medicos, farmacias, medicamentos;
