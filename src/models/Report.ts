import mongoose, { Schema } from "mongoose";

export interface ReportDoc extends mongoose.Document {
  reporterId: mongoose.Types.ObjectId;
  targetUserId: mongoose.Types.ObjectId;
  reason: string;
  details?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ReportSchema = new Schema<ReportDoc>(
  {
    reporterId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    targetUserId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    reason: { type: String, required: true },
    details: { type: String },
  },
  { timestamps: true },
);

ReportSchema.index({ reporterId: 1, targetUserId: 1, createdAt: -1 });

export const ReportModel = mongoose.model<ReportDoc>("Report", ReportSchema);
