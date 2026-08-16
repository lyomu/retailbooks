# Local infrastructure

Docker Compose provides portable development dependencies:

- PostgreSQL on `localhost:55432`
- Redis on `localhost:56379`
- MinIO S3 API on `localhost:59000` and Console on `localhost:59001`
- Mailpit SMTP on `localhost:51025` and inbox UI on `localhost:58025`

Run `docker compose up -d`, then verify container health with `docker compose ps`. The API exposes
dependency readiness at `GET /health/ready`.

These deliberately non-standard host ports avoid collisions with other local projects. Each port
can be overridden through the corresponding variable in `docker-compose.yml`; container-side ports
remain standard.

Named Docker volumes preserve local state. `docker compose down` stops services without deleting
that state. Removing volumes is intentionally not part of the standard workflow.
