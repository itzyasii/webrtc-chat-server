import { Router } from "express";
import { env } from "../config/env";
import { requireAuth } from "../middlewares/requireAuth";

export const rtcRouter = Router();

function splitUrls(raw?: string) {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

rtcRouter.get("/rtc/ice-servers", requireAuth, (_req, res) => {
  const stunUrls = splitUrls(env.STUN_URLS);
  const turnUrls = splitUrls(env.TURN_URLS);

  const iceServers: any[] = [];
  if (stunUrls.length) iceServers.push({ urls: stunUrls });
  if (turnUrls.length && env.TURN_USERNAME && env.TURN_CREDENTIAL) {
    iceServers.push({ urls: turnUrls, username: env.TURN_USERNAME, credential: env.TURN_CREDENTIAL });
  }

  res.json({ ok: true, iceServers });
});
