-- 003: rutas y viáticos. El salario NO se guarda aquí: viáticos son gastos operativos.
-- Reversible: ver bloque DOWN.

CREATE TABLE IF NOT EXISTS perfiles_viatico (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  representante_id uuid NOT NULL UNIQUE REFERENCES users(id),
  residencia jsonb NOT NULL,           -- dirección exacta: restringida por rol en la API
  vehiculo jsonb NOT NULL,
  tarifa_alimentacion numeric(12,2) NOT NULL CHECK (tarifa_alimentacion >= 0),
  reembolso_por_km numeric(10,2) CHECK (reembolso_por_km > 0),
  actualizado_por uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz
);

CREATE TABLE IF NOT EXISTS precios_combustible (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  combustible text NOT NULL, precio_galon numeric(10,2) NOT NULL CHECK (precio_galon > 0),
  vigente_desde date NOT NULL, registrado_por uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz,
  UNIQUE (combustible, vigente_desde)
);

CREATE TABLE IF NOT EXISTS jornadas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  representante_id uuid NOT NULL REFERENCES users(id),
  fecha date NOT NULL, paradas jsonb NOT NULL,
  km_estimados numeric(8,2) NOT NULL CHECK (km_estimados >= 0),   -- estimado manual hasta conectar proveedor de mapas
  km_reales numeric(8,2) CHECK (km_reales >= 0),
  con_alimentacion boolean NOT NULL DEFAULT true,
  hospedaje jsonb, peajes numeric(12,2) NOT NULL DEFAULT 0, estacionamiento numeric(12,2) NOT NULL DEFAULT 0, otros numeric(12,2) NOT NULL DEFAULT 0,
  estado text NOT NULL DEFAULT 'planificada' CHECK (estado IN ('planificada','realizada','cancelada')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz
);
CREATE INDEX IF NOT EXISTS jornadas_rep_fecha ON jornadas (representante_id, fecha);

CREATE TABLE IF NOT EXISTS presupuestos_viatico (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  representante_id uuid NOT NULL REFERENCES users(id),
  mes text NOT NULL CHECK (mes ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  detalle jsonb NOT NULL, supuestos jsonb NOT NULL, total numeric(14,2) NOT NULL,
  estado text NOT NULL CHECK (estado IN ('borrador','solicitado','aprobado','rechazado','desembolsado','liquidado')),
  monto_aprobado numeric(14,2), aprobado_por uuid REFERENCES users(id), motivo text,
  desembolsos jsonb NOT NULL DEFAULT '[]', gastos jsonb NOT NULL DEFAULT '[]', liquidacion jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz,
  UNIQUE (representante_id, mes)
);

-- DOWN (solo con autorización; borra datos):
-- DROP TABLE presupuestos_viatico, jornadas, precios_combustible, perfiles_viatico;
