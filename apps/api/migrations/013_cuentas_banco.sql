-- 013: cuenta de banco de la dependiente para el pago de su comisión.
-- Bancos: BHD, Banco Popular y Banreservas. Tipo: ahorro o corriente. El número completo solo lo ven
-- la dependiente, la administración, la gerencia y finanzas; en lo demás se muestra enmascarado.
CREATE TABLE IF NOT EXISTS cuentas_banco (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL UNIQUE REFERENCES users(id),
  banco text NOT NULL CHECK (banco IN ('bhd','popular','banreservas')),
  tipo text NOT NULL CHECK (tipo IN ('ahorro','corriente')),
  numero text NOT NULL CHECK (numero ~ '^[0-9]{6,20}$'),
  titular text NOT NULL,
  correo text NOT NULL,
  actualizado_por uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz
);

-- DOWN:
-- DROP TABLE cuentas_banco;
