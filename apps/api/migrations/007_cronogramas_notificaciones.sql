-- 007: cronogramas del administrador (días y lugares por representante) y notificaciones del sistema.
CREATE TABLE IF NOT EXISTS cronogramas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  representante_id uuid NOT NULL REFERENCES users(id),
  fecha date NOT NULL,
  lugares jsonb NOT NULL,
  nota text,
  estado text NOT NULL DEFAULT 'aprobado' CHECK (estado IN ('aprobado','anulado')),
  motivo text,
  creado_por uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS cronogramas_dia ON cronogramas (representante_id, fecha) WHERE estado = 'aprobado';
ALTER TABLE jornadas ADD COLUMN IF NOT EXISTS cronograma_id uuid REFERENCES cronogramas(id);

CREATE TABLE IF NOT EXISTS notificaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES users(id),
  tipo text NOT NULL, titulo text NOT NULL, texto text NOT NULL, enlace text,
  leida boolean NOT NULL DEFAULT false,
  correo text NOT NULL DEFAULT 'no' CHECK (correo IN ('no','pendiente','enviado','error')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz
);
CREATE INDEX IF NOT EXISTS notificaciones_usuario ON notificaciones (usuario_id, leida, created_at DESC);

-- DOWN:
-- DROP TABLE notificaciones; ALTER TABLE jornadas DROP COLUMN cronograma_id; DROP TABLE cronogramas;
