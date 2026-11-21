-- Ventas de FERSUAZ a cada farmacia, cargadas desde un archivo (plantilla de Excel o lectura con IA).
-- Cada carga es un lote; el inventario de la farmacia sube con las unidades vendidas (fuente 'venta').
-- DOWN: ALTER TABLE inventario DROP COLUMN IF EXISTS fuente, DROP COLUMN IF EXISTS lote_venta; DROP TABLE IF EXISTS ventas_farmacia;
CREATE TABLE IF NOT EXISTS ventas_farmacia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farmacia_id uuid NOT NULL REFERENCES farmacias(id),
  medicamento_id uuid NOT NULL REFERENCES medicamentos(id),
  unidades integer NOT NULL CHECK (unidades > 0),
  precio_unitario numeric(12,2),
  monto numeric(14,2),
  fecha date NOT NULL,
  factura text,
  provincia text, municipio text,
  lote uuid NOT NULL,
  fuente text NOT NULL CHECK (fuente IN ('plantilla', 'ia')),
  archivo text,
  cargado_por uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);
CREATE INDEX IF NOT EXISTS ventas_farmacia_fecha_idx ON ventas_farmacia (fecha);
CREATE INDEX IF NOT EXISTS ventas_farmacia_zona_idx ON ventas_farmacia (provincia, municipio);
ALTER TABLE inventario ADD COLUMN IF NOT EXISTS fuente text NOT NULL DEFAULT 'conteo';
ALTER TABLE inventario ADD COLUMN IF NOT EXISTS lote_venta uuid;
