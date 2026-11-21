-- 024: código de cada medicamento (ej. TIODEX01), como en la lista oficial de FERSUAZ.
-- Único cuando existe. El importador lo usa para actualizar nombre y precio sin duplicar.
-- Reversible: ver bloque DOWN.

ALTER TABLE medicamentos ADD COLUMN IF NOT EXISTS codigo text;
CREATE UNIQUE INDEX IF NOT EXISTS medicamentos_codigo_unico ON medicamentos (upper(codigo)) WHERE codigo IS NOT NULL AND activo;

-- DOWN
-- DROP INDEX medicamentos_codigo_unico; ALTER TABLE medicamentos DROP COLUMN codigo;
