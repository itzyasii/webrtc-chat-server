import mongoose, { Schema } from "mongoose";

export type ChatType = "dm";

export interface ChatDoc extends mongoose.Document {
  type: ChatType;
  members: mongoose.Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const ChatSchema = new Schema<ChatDoc>(
  {
    type: { type: String, enum: ["dm"], required: true, index: true },
    members: [
      { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    ],
  },
  { timestamps: true },
);

ChatSchema.index({ type: 1, members: 1 });

export const ChatModel = mongoose.model<ChatDoc>("Chat", ChatSchema);
