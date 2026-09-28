import { defineConfig } from "drizzle-kit";
import "dotenv/config";
import { resolveDatabaseTarget } from "./src/assert-db-target";

const target = resolveDatabaseTarget();

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: target.connectionString,
  },
  verbose: true,
  strict: true,
});
