import { provisionTestDatabase } from './database.js';

/**
 * Runs once per integration run, before any test process starts: creates the dedicated test
 * database if needed and applies every migration.
 */
export default async function setup(): Promise<void> {
  await provisionTestDatabase();
}
