import mongoose, { Schema } from "mongoose";

export type CallStatus =
  | "ringing"
  | "answered"
  | "ended"
  | "cancelled"
  | "declined"
  | "missed";

export interface CallLogDoc extends mongoose.Document {
  callId: string;
  callerId: mongoose.Types.ObjectId;
  calleeId: mongoose.Types.ObjectId;
  media?: "audio" | "video";
  status: CallStatus;
  offeredAt: Date;
  answeredAt?: Date;
  endedAt?: Date;
  endedBy?: mongoose.Types.ObjectId;
  reason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const CallLogSchema = new Schema<CallLogDoc>(
  {
    callId: { type: String, required: true, unique: true, index: true },
    callerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    calleeId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    media: { type: String, enum: ["audio", "video"] },
    status: {
      type: String,
      enum: ["ringing", "answered", "ended", "cancelled", "declined", "missed"],
      required: true,
      index: true,
    },
    offeredAt: { type: Date, required: true, index: true },
    answeredAt: { type: Date },
    endedAt: { type: Date },
    endedBy: { type: Schema.Types.ObjectId, ref: "User" },
    reason: { type: String },
  },
  { timestamps: true },
);

CallLogSchema.index({ callerId: 1, offeredAt: -1 });
CallLogSchema.index({ calleeId: 1, offeredAt: -1 });

export const CallLogModel = mongoose.model<CallLogDoc>(
  "CallLog",
  CallLogSchema,
);
