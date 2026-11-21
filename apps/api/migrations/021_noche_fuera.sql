-- 021: noches fuera planificadas en el cronograma.
-- Un día aprobado puede marcarse "duerme fuera" (opcionalmente con un hotel). El presupuesto del mes
-- cuenta esa noche con el precio del hotel; si no hay hotel verificado, con el precio de referencia
-- por provincia o general (configuración 'hotel_referencia'). Reversible: ver bloque DOWN.

ALTER TABLE cronogramas ADD COLUMN IF NOT EXISTS duerme_fuera boolean NOT NULL DEFAULT false;
ALTER TABLE cronogramas ADD COLUMN IF NOT EXISTS hotel_id uuid REFERENCES hoteles(id);

-- DOWN
-- ALTER TABLE cronogramas DROP COLUMN hotel_id, DROP COLUMN duerme_fuera;
