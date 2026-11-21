-- 020: tienda en línea para farmacias (pedidos sin pago en línea).
-- Medicamentos: ficha pública con fotos. Pedidos de la dependiente para su farmacia.
-- Al entregar, el pedido queda como venta (fuente 'pedido') y sube el inventario.
-- Reversible: ver bloque DOWN.

ALTER TABLE medicamentos ADD COLUMN IF NOT EXISTS descripcion text;
ALTER TABLE medicamentos ADD COLUMN IF NOT EXISTS ficha jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE medicamentos ADD COLUMN IF NOT EXISTS imagenes jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE medicamentos ADD COLUMN IF NOT EXISTS publicado boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS pedidos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero text NOT NULL UNIQUE,
  farmacia_id uuid NOT NULL REFERENCES farmacias(id),
  creado_por uuid NOT NULL REFERENCES users(id),
  items jsonb NOT NULL,
  total numeric(14,2) NOT NULL CHECK (total >= 0),
  unidades integer NOT NULL CHECK (unidades > 0),
  pago text NOT NULL CHECK (pago IN ('transferencia', 'credito', 'contra_entrega')),
  comprobante jsonb,
  nota text,
  estado text NOT NULL CHECK (estado IN ('recibido', 'confirmado', 'despachado', 'entregado', 'cancelado')),
  historial jsonb NOT NULL DEFAULT '[]'::jsonb,
  vendedor_id uuid REFERENCES users(id),
  provincia text, municipio text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz
);
CREATE INDEX IF NOT EXISTS pedidos_farmacia ON pedidos (farmacia_id);

ALTER TABLE ventas_farmacia DROP CONSTRAINT IF EXISTS ventas_farmacia_fuente_check;
ALTER TABLE ventas_farmacia ADD CONSTRAINT ventas_farmacia_fuente_check CHECK (fuente IN ('plantilla', 'ia', 'pedido'));

-- DOWN
-- ALTER TABLE ventas_farmacia DROP CONSTRAINT ventas_farmacia_fuente_check;
-- ALTER TABLE ventas_farmacia ADD CONSTRAINT ventas_farmacia_fuente_check CHECK (fuente IN ('plantilla', 'ia'));
-- DROP TABLE pedidos;
-- ALTER TABLE medicamentos DROP COLUMN descripcion, DROP COLUMN ficha, DROP COLUMN imagenes, DROP COLUMN publicado;
