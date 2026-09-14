CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Local runtime role. Migrations run as the Compose owner (`retailbooks`); the API connects as
-- this restricted role, which is intentionally not a superuser and cannot bypass RLS.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'retailbooks_app') THEN
    CREATE ROLE retailbooks_app
      LOGIN
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOINHERIT
      NOBYPASSRLS
      PASSWORD 'retailbooks-app-local';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE retailbooks TO retailbooks_app;
GRANT USAGE ON SCHEMA public TO retailbooks_app;
ALTER DEFAULT PRIVILEGES FOR ROLE retailbooks IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO retailbooks_app;
ALTER DEFAULT PRIVILEGES FOR ROLE retailbooks IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO retailbooks_app;
