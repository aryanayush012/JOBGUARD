import { z } from "zod";

const envSchema = z.object({
  MONGODB_URI: z.string().min(1),
  MONGODB_DB_NAME: z.string().min(1).default("job_protection_portal"),
  SESSION_SECRET: z.string().min(32),
  APP_BASE_URL: z.string().url()
});

export function getEnv() {
  const parsed = envSchema.safeParse({
    MONGODB_URI: process.env.MONGODB_URI,
    MONGODB_DB_NAME: process.env.MONGODB_DB_NAME || "job_protection_portal",
    SESSION_SECRET: process.env.SESSION_SECRET,
    APP_BASE_URL: process.env.APP_BASE_URL
  });

  if (!parsed.success) {
    throw new Error(
      `Invalid environment configuration: ${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`
    );
  }

  return parsed.data;
}
