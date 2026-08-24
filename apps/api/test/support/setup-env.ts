import { testDatabaseUrl } from './database.js';

/**
 * Runs in each test process before any test module is imported, so that the Prisma client is
 * constructed against the test database rather than the development one.
 */
process.env.DATABASE_URL = testDatabaseUrl();
process.env.NODE_ENV = 'test';
process.env.SECURITY_PEPPER ??= 'integration-test-pepper';
