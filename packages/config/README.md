# @retailbooks/config

Shared runtime configuration for RetailBooks services.

The API imports `validateApiEnvironment` through Nest's `ConfigModule` at boot. Development and
test runs receive the local Docker Compose defaults; production must provide explicit database,
Redis, S3, web, email, and security values before the process can start.
