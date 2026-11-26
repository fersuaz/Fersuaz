-- Comprobante fiscal del hotel y si su precio ya incluye el ITBIS (18%, DGII). Si emite comprobante y el precio
-- no lo incluye, el precio que se usa en los viáticos es precio × 1.18.
ALTER TABLE hoteles ADD COLUMN IF NOT EXISTS comprobante_fiscal boolean NOT NULL DEFAULT false;
ALTER TABLE hoteles ADD COLUMN IF NOT EXISTS precio_incluye_itbis boolean;
