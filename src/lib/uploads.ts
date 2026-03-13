import fs from "node:fs/promises";
import path from "node:path";

const uploadDir = path.resolve(process.cwd(), "uploads");
const uploadPrefixes = ["/api/uploads/", "/uploads/"];

function toUploadFilename(url: string) {
  const trimmed = url.trim();
  if (!trimmed) return null;

  let pathname = trimmed;
  try {
    pathname = new URL(trimmed, "http://localhost").pathname;
  } catch {
    return null;
  }

  const matchingPrefix = uploadPrefixes.find((prefix) =>
    pathname.startsWith(prefix),
  );
  if (!matchingPrefix) return null;

  const filename = decodeURIComponent(pathname.slice(matchingPrefix.length));
  if (!filename || filename.includes("/") || filename.includes("\\"))
    return null;
  if (path.basename(filename) !== filename) return null;
  return filename;
}

export async function deleteUploadedFileByUrl(url?: string | null) {
  if (!url) return;

  const filename = toUploadFilename(url);
  if (!filename) return;

  const filePath = path.join(uploadDir, filename);
  try {
    await fs.unlink(filePath);
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
  }
}
