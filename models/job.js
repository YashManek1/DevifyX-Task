import mongoose from "mongoose";

const HttpPayloadSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    method: { type: String, required: true },
    headers: { type: Object, default: {} },
    body: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: false }
);

const ShellPayloadSchema = new mongoose.Schema(
  {
    command: { type: String, required: true },
  },
  { _id: false }
);

const JobSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  name: { type: String, required: true, trim: true },
  type: { type: String, enum: ["http", "shell"], required: true },
  schedule: { type: String, required: true }, // cron syntax
  payload: { type: mongoose.Schema.Types.Mixed, required: true }, // HttpPayload or ShellPayload
  enabled: { type: Boolean, default: true },
  retryLimit: { type: Number, default: 0 }, // number of retries on failure
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

export default mongoose.model("Job", JobSchema);
