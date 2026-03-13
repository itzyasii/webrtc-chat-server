import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import { nanoid } from "nanoid";
import { maxUploadBytes } from "../config/env";

export const uploadsRouter = Router();

const uploadDir = path.resolve(process.cwd(), "uploads");
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}_${nanoid(10)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: maxUploadBytes },
});

function classifyUpload(mime: string, originalName: string) {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";

  const ext = path.extname(originalName).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".heic", ".heif"].includes(ext)) return "image";
  if ([".mp4", ".webm", ".mov", ".m4v", ".mkv", ".avi"].includes(ext)) return "video";
  if ([".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac", ".opus"].includes(ext)) return "audio";

  return "file";
}

uploadsRouter.post("/uploads", upload.single("file"), (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ ok: false, error: "MissingFile" });

  // Prefer serving via `/api/uploads/*` so frontends that proxy `/api` work
  // without needing a separate static path. Keep a legacy `/uploads/*` alias.
  const apiUrlPath = `/api/uploads/${file.filename}`;
  const legacyUrlPath = `/uploads/${file.filename}`;

  res.status(201).json({
    ok: true,
    item: {
      kind: classifyUpload(file.mimetype, file.originalname),
      url: apiUrlPath,
      legacyUrl: legacyUrlPath,
      filename: file.filename,
      originalName: file.originalname,
      mime: file.mimetype,
      size: file.size,
    },
  });
});
