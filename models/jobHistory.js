import mongoose from "mongoose";

const JobHistorySchema = new mongoose.Schema({
  jobId: { type: mongoose.Schema.Types.ObjectId, ref: "Job", required: true },
  executedAt: { type: Date, default: Date.now },
  status: { type: String, enum: ["success", "failure"], required: true },
  output: { type: mongoose.Schema.Types.Mixed }, // stdout for shell, response for http
  error: { type: mongoose.Schema.Types.Mixed }, // error details if failed
  retryCount: { type: Number, default: 0 },
  orgId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Organization",
    required: true,
  },
});

export default mongoose.model("JobHistory", JobHistorySchema);
