import { writeFileSync } from 'fs';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module';
import { buildOpenApiDocument, configureApiRouting } from '../src/app.openapi';

/**
 * Writes the OpenAPI document the running API serves at /api/docs (#363).
 *
 * Uses the same routing and document configuration as main.ts, so the paths
 * include the /api/v1 prefix and versioning. Like the app itself it needs the
 * environment main.ts needs (JWT_SECRET, DB_*), and a reachable database,
 * because building the app module opens the TypeORM connection.
 *
 * Usage:
 *   npm run openapi:export                 # writes ./openapi.json
 *   npm run openapi:export -- out/api.json # writes another path
 */
async function exportOpenApi(): Promise<void> {
  const outFile = process.argv[2] ?? 'openapi.json';

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    configureApiRouting(app);
    const document = buildOpenApiDocument(app);
    writeFileSync(outFile, `${JSON.stringify(document, null, 2)}\n`);
    console.log(
      `Wrote ${outFile} (${Object.keys(document.paths).length} paths)`,
    );
  } finally {
    await app.close();
  }
}

exportOpenApi().catch((error) => {
  console.error(error);
  process.exit(1);
});
