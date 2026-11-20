-- 012: alta de representantes por el administrador (usuario y clave temporal), vehículo con
-- rendimiento de la EPA o transporte público con montos dentro y fuera de su municipio.
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS username text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS debe_cambiar_clave boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS users_username ON users (lower(username)) WHERE username IS NOT NULL;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_or_username;
ALTER TABLE users ADD CONSTRAINT users_email_or_username CHECK (email IS NOT NULL OR username IS NOT NULL);
ALTER TABLE perfiles_viatico ADD COLUMN IF NOT EXISTS publico jsonb;

-- DOWN:
-- ALTER TABLE perfiles_viatico DROP COLUMN publico; ALTER TABLE users DROP CONSTRAINT users_email_or_username;
-- DROP INDEX users_username; ALTER TABLE users DROP COLUMN debe_cambiar_clave; ALTER TABLE users DROP COLUMN username;
-- (email NOT NULL solo se puede restaurar si todos los usuarios tienen correo)
