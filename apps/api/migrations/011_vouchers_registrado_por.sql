-- 011: el Vendedor o PVC puede cargar un voucher a nombre de una dependiente; queda constancia de quién lo cargó.
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS registrado_por uuid REFERENCES users(id);

-- DOWN:
-- ALTER TABLE vouchers DROP COLUMN registrado_por;
