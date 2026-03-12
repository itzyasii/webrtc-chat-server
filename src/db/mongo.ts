import mongoose from "mongoose";
import { env } from "../config/env";
import { logger } from "../config/logger";

let isConnected = false;

export async function connectMongo() {
  if (isConnected) return;

  mongoose.set("strictQuery", true);

  await mongoose.connect(env.MONGODB_URI);
  isConnected = true;
  logger.info("MongoDB connected");
}

export async function disconnectMongo() {
  if (!isConnected) return;
  await mongoose.disconnect();
  isConnected = false;
  logger.info("MongoDB disconnected");
}
