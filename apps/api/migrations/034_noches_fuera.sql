-- Noches que el representante duerme fuera de su zona y se le paga hotel. Se planifican por fecha, con o sin
-- cronograma ese día; el presupuesto del mes las suma con el hotel elegido o el recomendado de la provincia.
CREATE TABLE IF NOT EXISTS noches_fuera (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  representante_id uuid NOT NULL REFERENCES users(id),
  fecha date NOT NULL,
  provincia text NOT NULL,
  municipio text,
  hotel_id uuid REFERENCES hoteles(id),
  nota text,
  creado_por uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS noches_fuera_dia ON noches_fuera (representante_id, fecha);
