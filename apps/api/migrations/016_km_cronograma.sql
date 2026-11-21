-- Km por carretera de cada día aprobado del cronograma (residencia → lugares → residencia), calculados
-- una vez con el proveedor de mapas para estimar los viáticos del mes antes de crear las jornadas.
-- km_origen guarda la residencia usada: si cambia, se vuelve a calcular.
-- DOWN: ALTER TABLE cronogramas DROP COLUMN IF EXISTS km_estimado, DROP COLUMN IF EXISTS minutos_estimados, DROP COLUMN IF EXISTS km_origen;
ALTER TABLE cronogramas ADD COLUMN IF NOT EXISTS km_estimado numeric(8,2);
ALTER TABLE cronogramas ADD COLUMN IF NOT EXISTS minutos_estimados integer;
ALTER TABLE cronogramas ADD COLUMN IF NOT EXISTS km_origen text;
