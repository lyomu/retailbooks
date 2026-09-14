-- RetailBooks production runtime database role template.
--
-- Run this as a database administrator. Do not put passwords in this file: inject the runtime
-- credential from the deployment secret manager. Run Prisma migrations as a separate migration
-- owner, then configure the API's DATABASE_URL with this role's credential.
--
-- Replace retailbooks_app with a deployment-specific role name if required.

CREATE ROLE retailbooks_app
  LOGIN
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  NOBYPASSRLS
  PASSWORD '<inject-from-secret-manager>';

GRANT CONNECT ON DATABASE retailbooks TO retailbooks_app;
GRANT USAGE ON SCHEMA public TO retailbooks_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO retailbooks_app;

-- Execute the following as the migration-owner role after creating each new table so future
-- migrations do not accidentally remove runtime access. The API startup guard rejects a role that
-- owns ai_runs or ai_evidence, even though those tables also use FORCE ROW LEVEL SECURITY.
--
-- ALTER DEFAULT PRIVILEGES FOR ROLE <migration_owner> IN SCHEMA public
--   GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO retailbooks_app;
