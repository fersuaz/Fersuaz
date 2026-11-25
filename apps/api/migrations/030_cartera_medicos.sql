-- Cartera de médicos de cada representante (visitador y PVC): médicos por centro, centro de inicio y visitas por día propias.
ALTER TABLE zonas_representante ADD COLUMN IF NOT EXISTS cartera jsonb;
