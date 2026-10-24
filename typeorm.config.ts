/**
 * Data source for `npm run typeorm` (ts-node). The real definition is
 * src/data-source.ts, which is also compiled into the image as
 * dist/data-source.js so migrations can run without ts-node (#352).
 */
export { default } from './src/data-source';
