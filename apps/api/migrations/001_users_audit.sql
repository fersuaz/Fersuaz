-- 001: usuarios con tipos/roles y auditoría. Reversible: ver bloque DOWN.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name     text NOT NULL CHECK (char_length(full_name) BETWEEN 3 AND 120),
  email         text NOT NULL UNIQUE,
  phone         text,
  role          text NOT NULL CHECK (role IN ('administrador','gerencia','supervisor','representante','finanzas','dependiente')),
  position      text CHECK (position IN ('Visitador','PVC','Vendedor','Promotora')),
  pharmacy_text text,   -- dependiente: pendiente de validar contra directorio de farmacias
  province_text text,
  password_hash text NOT NULL,
  status        text NOT NULL DEFAULT 'pendiente_aprobacion'
                CHECK (status IN ('pendiente_aprobacion','activo','rechazado','inactivo')),
  approved_by   uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz
);
CREATE INDEX IF NOT EXISTS users_status_idx ON users (status);

CREATE TABLE IF NOT EXISTS audit_logs (
  id           bigserial PRIMARY KEY,
  actor_id     uuid REFERENCES users(id),
  action       text NOT NULL,
  entity       text NOT NULL,
  entity_id    text NOT NULL,
  before_value jsonb,
  after_value  jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- DOWN (ejecutar solo con autorización):
-- DROP TABLE audit_logs; DROP TABLE users;
