import { Router } from "express";
import { z } from "zod";
import { nanoid } from "nanoid";
import { env } from "../config/env";
import { hashPassword, verifyPassword } from "../auth/password";
import {
  generateRefreshToken,
  hashRefreshToken,
  refreshExpiryDate,
  signAccessToken,
} from "../auth/tokens";
import { UserModel } from "../models/User";
import { RefreshTokenModel } from "../models/RefreshToken";
import { requireAuth } from "../middlewares/requireAuth";
import { validateBody } from "../middlewares/validate";

export const authRouter = Router();

function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "lax" as const,
    domain: env.COOKIE_DOMAIN,
    path: "/",
  };
}

function setRefreshCookie(res: any, token: string) {
  const maxAgeMs = env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;
  res.cookie(env.REFRESH_COOKIE_NAME, token, {
    ...refreshCookieOptions(),
    maxAge: maxAgeMs,
  });
}

function clearRefreshCookie(res: any) {
  res.clearCookie(env.REFRESH_COOKIE_NAME, refreshCookieOptions());
}

const SignupSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(32),
  password: z.string().min(8).max(200),
});

authRouter.post(
  "/auth/signup",
  validateBody(SignupSchema),
  async (req, res) => {
    const { email, username, password } = req.body as z.infer<
      typeof SignupSchema
    >;

    const existing = await UserModel.findOne({
      $or: [{ email: email.toLowerCase() }, { username }],
    }).lean();
    if (existing)
      return res.status(409).json({ ok: false, error: "UserAlreadyExists" });

    const user = await UserModel.create({
      email: email.toLowerCase(),
      username,
      passwordHash: await hashPassword(password),
    });

    const refreshToken = generateRefreshToken();
    await RefreshTokenModel.create({
      userId: user._id,
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt: refreshExpiryDate(),
    });

    setRefreshCookie(res, refreshToken);
    const accessToken = signAccessToken(String(user._id));

    res.status(201).json({
      ok: true,
      accessToken,
      user: {
        id: String(user._id),
        email: user.email,
        username: user.username,
      },
    });
  },
);

const LoginSchema = z.object({
  emailOrUsername: z.string().min(1),
  password: z.string().min(1),
});

authRouter.post("/auth/login", validateBody(LoginSchema), async (req, res) => {
  const { emailOrUsername, password } = req.body as z.infer<typeof LoginSchema>;

  const user = await UserModel.findOne({
    $or: [
      { email: emailOrUsername.toLowerCase() },
      { username: emailOrUsername },
    ],
  });

  if (!user?.passwordHash)
    return res.status(401).json({ ok: false, error: "InvalidCredentials" });
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok)
    return res.status(401).json({ ok: false, error: "InvalidCredentials" });

  const refreshToken = generateRefreshToken();
  await RefreshTokenModel.create({
    userId: user._id,
    tokenHash: hashRefreshToken(refreshToken),
    expiresAt: refreshExpiryDate(),
  });

  setRefreshCookie(res, refreshToken);
  const accessToken = signAccessToken(String(user._id));

  res.json({
    ok: true,
    accessToken,
    user: { id: String(user._id), email: user.email, username: user.username },
  });
});

const RefreshSchema = z.object({
  refreshToken: z.string().min(10).optional(),
});

authRouter.post(
  "/auth/refresh",
  validateBody(RefreshSchema),
  async (req, res) => {
    const tokenFromBody = (req.body as z.infer<typeof RefreshSchema>)
      .refreshToken;
    const tokenFromCookie = (req as any).cookies?.[env.REFRESH_COOKIE_NAME];
    const refreshToken = tokenFromBody ?? tokenFromCookie;
    if (!refreshToken)
      return res.status(401).json({ ok: false, error: "Unauthorized" });

    const tokenHash = hashRefreshToken(refreshToken);
    const record = await RefreshTokenModel.findOne({ tokenHash });
    if (!record)
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    if (record.revokedAt)
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    if (record.expiresAt.getTime() < Date.now())
      return res.status(401).json({ ok: false, error: "Unauthorized" });

    const newRefreshToken = generateRefreshToken();
    const newHash = hashRefreshToken(newRefreshToken);

    await RefreshTokenModel.create({
      userId: record.userId,
      tokenHash: newHash,
      expiresAt: refreshExpiryDate(),
    });

    record.revokedAt = new Date();
    record.replacedByHash = newHash;
    await record.save();

    setRefreshCookie(res, newRefreshToken);
    const accessToken = signAccessToken(String(record.userId));
    res.json({ ok: true, accessToken });
  },
);

authRouter.post("/auth/logout", async (req, res) => {
  const refreshToken = (req as any).cookies?.[env.REFRESH_COOKIE_NAME];
  if (refreshToken) {
    const tokenHash = hashRefreshToken(refreshToken);
    await RefreshTokenModel.updateOne(
      { tokenHash },
      { $set: { revokedAt: new Date() } },
    ).exec();
  }
  clearRefreshCookie(res);
  res.json({ ok: true });
});

authRouter.get("/auth/me", requireAuth, async (req, res) => {
  const user = await UserModel.findById(req.user!.id).lean();
  if (!user) return res.status(404).json({ ok: false, error: "NotFound" });
  res.json({
    ok: true,
    user: { id: String(user._id), email: user.email, username: user.username },
  });
});

authRouter.get("/auth/oauth/google/url", (req, res) => {
  const { GOOGLE_CLIENT_ID, GOOGLE_REDIRECT_URI } = env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_REDIRECT_URI) {
    return res
      .status(501)
      .json({ ok: false, error: "GoogleOAuthNotConfigured" });
  }

  const state =
    typeof req.query.state === "string" ? req.query.state : nanoid(16);
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });

  res.json({
    ok: true,
    url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    state,
  });
});

const GoogleCallbackSchema = z.object({
  code: z.string().min(1),
});

authRouter.post(
  "/auth/oauth/google/callback",
  validateBody(GoogleCallbackSchema),
  async (req, res) => {
    const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = env;
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
      return res
        .status(501)
        .json({ ok: false, error: "GoogleOAuthNotConfigured" });
    }

    const { code } = req.body as z.infer<typeof GoogleCallbackSchema>;

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok)
      return res.status(401).json({ ok: false, error: "OAuthExchangeFailed" });
    const tokenJson = (await tokenRes.json()) as { id_token?: string };
    if (!tokenJson.id_token)
      return res.status(401).json({ ok: false, error: "OAuthExchangeFailed" });

    const infoRes = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(tokenJson.id_token)}`,
    );
    if (!infoRes.ok)
      return res.status(401).json({ ok: false, error: "OAuthTokenInvalid" });
    const info = (await infoRes.json()) as {
      sub: string;
      email?: string;
      aud?: string;
    };
    if (!info.sub)
      return res.status(401).json({ ok: false, error: "OAuthTokenInvalid" });
    if (info.aud !== GOOGLE_CLIENT_ID)
      return res.status(401).json({ ok: false, error: "OAuthTokenInvalid" });
    if (!info.email)
      return res.status(401).json({ ok: false, error: "OAuthEmailMissing" });

    let user = await UserModel.findOne({
      "oauth.provider": "google",
      "oauth.providerUserId": info.sub,
    });
    if (!user)
      user = await UserModel.findOne({ email: info.email.toLowerCase() });
    if (!user) {
      const base = info.email.split("@")[0] || "user";
      user = await UserModel.create({
        email: info.email.toLowerCase(),
        username: `${base}_${nanoid(6)}`,
        oauth: { provider: "google", providerUserId: info.sub },
      });
    } else if (!user.oauth) {
      user.oauth = { provider: "google", providerUserId: info.sub };
      await user.save();
    }

    const refreshToken = generateRefreshToken();
    await RefreshTokenModel.create({
      userId: user._id,
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt: refreshExpiryDate(),
    });

    setRefreshCookie(res, refreshToken);
    const accessToken = signAccessToken(String(user._id));

    res.json({
      ok: true,
      accessToken,
      user: {
        id: String(user._id),
        email: user.email,
        username: user.username,
      },
    });
  },
);
