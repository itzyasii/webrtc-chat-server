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

function classifyMime(mime: string) {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "file";
}

uploadsRouter.post("/uploads", upload.single("file"), (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ ok: false, error: "MissingFile" });

  const urlPath = `/uploads/${file.filename}`;

  res.status(201).json({
    ok: true,
    item: {
      kind: classifyMime(file.mimetype),
      url: urlPath,
      filename: file.filename,
      originalName: file.originalname,
      mime: file.mimetype,
      size: file.size,
    },
  });
});
