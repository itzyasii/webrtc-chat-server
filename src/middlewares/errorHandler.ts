import type { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";
import multer from "multer";
import { ZodError } from "zod";
import { env } from "../config/env";
import { logger } from "../config/logger";
import { AppError } from "../errors/AppError";

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  logger.error(err);

  if (err instanceof AppError) {
    return res
      .status(err.statusCode)
      .json({ ok: false, error: err.code, details: err.details });
  }

  if (err instanceof ZodError) {
    return res
      .status(400)
      .json({ ok: false, error: "ValidationError", details: err.flatten() });
  }

  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ ok: false, error: "FileTooLarge" });
    }
    return res
      .status(400)
      .json({ ok: false, error: "UploadError", details: err.code });
  }

  if (err instanceof mongoose.Error.ValidationError) {
    return res
      .status(400)
      .json({ ok: false, error: "ValidationError", details: err.errors });
  }

  const anyErr = err as any;
  if (anyErr?.code === 11000) {
    return res
      .status(409)
      .json({ ok: false, error: "DuplicateKey", details: anyErr?.keyValue });
  }

  const payload: any = { ok: false, error: "InternalServerError" };
  if (env.NODE_ENV !== "production" && err instanceof Error)
    payload.stack = err.stack;
  return res.status(500).json(payload);
}
