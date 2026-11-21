-- 019: plan mensual de días de cada representante (en su zona / fuera de su zona),
-- cargado desde el Excel del paquete de viáticos. Solo días: el salario no se guarda aquí.
-- Reversible: ver bloque DOWN.

CREATE TABLE IF NOT EXISTS plan_dias_representante (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  representante_id uuid NOT NULL UNIQUE REFERENCES users(id),
  dias_dentro integer NOT NULL CHECK (dias_dentro BETWEEN 0 AND 31),
  dias_fuera integer NOT NULL CHECK (dias_fuera BETWEEN 0 AND 31),
  fuente text,
  actualizado_por uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz
);

-- DOWN
-- DROP TABLE plan_dias_representante;
