-- Fotos de Google Maps de cada lugar: { items: [{ nombre, ancho, alto, autores }], consultado }.
-- Solo se guarda el nombre de la foto; la imagen la entrega el servidor.
ALTER TABLE establecimientos ADD COLUMN IF NOT EXISTS fotos jsonb;
ALTER TABLE farmacias ADD COLUMN IF NOT EXISTS fotos jsonb;
ALTER TABLE hoteles ADD COLUMN IF NOT EXISTS fotos jsonb;
