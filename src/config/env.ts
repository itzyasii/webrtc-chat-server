import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().default("*"),
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(50),
  MONGODB_URI: z.string().default("mongodb://localhost:27017/webrtc_project"),
  JWT_ACCESS_SECRET: z.string().min(20).default("dev_access_secret_change_me_please_12345"),
  JWT_REFRESH_SECRET: z.string().min(20).default("dev_refresh_secret_change_me_please_12345"),
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  REFRESH_COOKIE_NAME: z.string().min(1).default("rt"),
  COOKIE_SECURE: z.coerce.boolean().default(false),
  COOKIE_DOMAIN: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().optional(),
  STUN_URLS: z.string().default("stun:stun.l.google.com:19302"),
  TURN_URLS: z.string().optional(),
  TURN_USERNAME: z.string().optional(),
  TURN_CREDENTIAL: z.string().optional(),
  CALL_RING_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(30),
});

export const env = EnvSchema.parse(process.env);

if (env.NODE_ENV === "production") {
  if (env.JWT_ACCESS_SECRET.startsWith("dev_") || env.JWT_REFRESH_SECRET.startsWith("dev_")) {
    throw new Error("JWT secrets must be set to non-dev values in production");
  }
}

export const corsOriginList = (() => {
  const raw = env.CORS_ORIGIN.trim();
  if (raw === "*" || raw.length === 0) return "*";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
})();

export const maxUploadBytes = env.MAX_UPLOAD_MB * 1024 * 1024;
