import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';

import { AppModule } from '../src/app.module.js';
import { DemoSeedService } from '../src/demo-seed.service.js';

async function seed(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  try {
    const summary = await app.get(DemoSeedService).run();
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } finally {
    await app.close();
  }
}

void seed().catch((error: unknown) => {
  process.stderr.write(
    `Demo seed failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
