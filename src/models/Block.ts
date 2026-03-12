import mongoose, { Schema } from "mongoose";

export interface BlockDoc extends mongoose.Document {
  blockerId: mongoose.Types.ObjectId;
  blockedId: mongoose.Types.ObjectId;
  reason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const BlockSchema = new Schema<BlockDoc>(
  {
    blockerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    blockedId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    reason: { type: String },
  },
  { timestamps: true },
);

BlockSchema.index({ blockerId: 1, blockedId: 1 }, { unique: true });

export const BlockModel = mongoose.model<BlockDoc>("Block", BlockSchema);
