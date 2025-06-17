const mongoose = require("mongoose");

const JobHistorySchema = new mongoose.Schema({
  jobId: { type: mongoose.Schema.Types.ObjectId, ref: "Job", required: true },
  executedAt: { type: Date, default: Date.now },
  status: { type: String, enum: ["success", "failure"], required: true },
  output: { type: mongoose.Schema.Types.Mixed }, // stdout for shell, response for http
  error: { type: mongoose.Schema.Types.Mixed }, // error details if failed
  retryCount: { type: Number, default: 0 },
});

module.exports = mongoose.model("JobHistory", JobHistorySchema);
