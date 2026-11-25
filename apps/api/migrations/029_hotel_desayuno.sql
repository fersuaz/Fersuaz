-- Hotel con desayuno incluido: el valor del desayuno se descuenta de la comida del día de esa noche fuera.
ALTER TABLE hoteles ADD COLUMN IF NOT EXISTS desayuno_incluido boolean NOT NULL DEFAULT false;
ALTER TABLE hoteles ADD COLUMN IF NOT EXISTS valor_desayuno numeric(10,2);
-- Comida por día desglosada del representante (desayuno, almuerzo y cena). Si existe, la comida del día es la suma
-- y el desayuno es lo que se rebaja cuando el hotel lo incluye.
ALTER TABLE perfiles_viatico ADD COLUMN IF NOT EXISTS comida_desglose jsonb;
