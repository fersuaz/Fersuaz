-- Pacientes de las recetas (nombre y teléfono). Un teléfono = un paciente: si se repite, la receta
-- nueva se suma al mismo paciente y no se duplica su contacto.
-- DOWN: ALTER TABLE recetas DROP COLUMN IF EXISTS paciente_id; DROP TABLE IF EXISTS pacientes;
CREATE TABLE IF NOT EXISTS pacientes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telefono text NOT NULL UNIQUE CHECK (telefono ~ '^(809|829|849)[0-9]{7}$'),
  nombre text NOT NULL,
  creado_por uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);
ALTER TABLE recetas ADD COLUMN IF NOT EXISTS paciente_id uuid REFERENCES pacientes(id);
CREATE INDEX IF NOT EXISTS recetas_paciente_idx ON recetas (paciente_id);
