import "express-async-errors";
import compression from "compression";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import mongoSanitize from "express-mongo-sanitize";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import hpp from "hpp";
import morgan from "morgan";
import path from "node:path";
import { corsOriginList } from "./config/env";
import { apiRouter } from "./routes";
import { errorHandler } from "./middlewares/errorHandler";
import { notFound } from "./middlewares/notFound";

export function createApp() {
  const app = express();
  const uploadsDir = path.resolve(process.cwd(), "uploads");

  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(compression());
  app.use(morgan("dev"));

  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.use(mongoSanitize());
  app.use(hpp());

  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 100000,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  const corsOptions: cors.CorsOptions =
    corsOriginList === "*"
      ? { origin: true, credentials: true }
      : {
          origin: corsOriginList,
          credentials: true,
        };

  app.use(cors(corsOptions));

  // Serve uploaded chat/media files via API path for frontend convenience.
  // Keep `/uploads/*` as a legacy alias for older clients.
  // Helmet defaults may set `Cross-Origin-Resource-Policy: same-origin`, which blocks
  // embedding images/audio/video from a separate frontend origin. Allow cross-origin
  // reads for uploaded media assets.
  const allowCrossOriginResource = (
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    next();
  };
  app.use("/api/uploads", allowCrossOriginResource, express.static(uploadsDir));
  app.use("/uploads", allowCrossOriginResource, express.static(uploadsDir));
  app.use("/api", apiRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
