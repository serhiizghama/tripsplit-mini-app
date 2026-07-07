import { defineConfig } from 'drizzle-kit';

// Used by `npm run db:generate --workspace=server` (drizzle-kit generate) to
// emit SQL migrations into `server/drizzle/` from `src/db/schema.ts`. Those
// migrations are applied at runtime by `src/db/index.ts` on server boot —
// this config is a dev-time codegen tool only, never imported by the app.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DB_PATH ?? './data/tripsplit.db',
  },
});
