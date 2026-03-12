import mongoose, { Schema } from "mongoose";

export type MessageType = "text" | "share";

export interface ShareItem {
  kind: "file" | "image" | "video" | "audio";
  url: string;
  originalName?: string;
  mime?: string;
  size?: number;
  meta?: Record<string, unknown>;
}

export interface MessageDoc extends mongoose.Document {
  chatId: mongoose.Types.ObjectId;
  from: mongoose.Types.ObjectId;
  type: MessageType;
  clientMessageId?: string;
  text?: string;
  item?: ShareItem;
  receipts?: {
    userId: mongoose.Types.ObjectId;
    deliveredAt?: Date;
    readAt?: Date;
  }[];
  editedAt?: Date;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ShareItemSchema = new Schema<ShareItem>(
  {
    kind: {
      type: String,
      enum: ["file", "image", "video", "audio"],
      required: true,
    },
    url: { type: String, required: true },
    originalName: { type: String },
    mime: { type: String },
    size: { type: Number },
    meta: { type: Schema.Types.Mixed },
  },
  { _id: false },
);

const ReceiptSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    deliveredAt: { type: Date },
    readAt: { type: Date },
  },
  { _id: false },
);

const MessageSchema = new Schema<MessageDoc>(
  {
    chatId: {
      type: Schema.Types.ObjectId,
      ref: "Chat",
      required: true,
      index: true,
    },
    from: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: { type: String, enum: ["text", "share"], required: true },
    clientMessageId: { type: String },
    text: { type: String },
    item: { type: ShareItemSchema },
    receipts: { type: [ReceiptSchema], default: [] },
    editedAt: { type: Date },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);

MessageSchema.index({ chatId: 1, createdAt: -1 });
MessageSchema.index({ from: 1, clientMessageId: 1 }, { unique: true, sparse: true });

export const MessageModel = mongoose.model<MessageDoc>(
  "Message",
  MessageSchema,
);
