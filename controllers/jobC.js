import userModel from "../models/user.js";
import jobModel from "../models/job.js";
import cron from "node-cron";
import axios from "axios";
import { exec } from "child_process";
import { promisify } from "util";
import jobHistoryModel from "../models/jobHistory.js";

// In-memory store for scheduled jobs (always use string keys for consistency)
export const scheduledJobs = {};

const execAsync = promisify(exec);

// Helper function for retries
async function withRetries(job, execFunc) {
  const retryLimit = job.retryLimit || 0;
  let lastError = null;

  for (let attempt = 0; attempt <= retryLimit; attempt++) {
    try {
      const result = await execFunc(attempt);
      return result;
    } catch (err) {
      lastError = err;
      if (attempt === retryLimit) throw err; // Re-throw on last attempt
    }
  }
  throw lastError;
}

// CREATE JOB
export const createJob = async (req, res) => {
  try {
    const { name, type, schedule, payload, enabled, retryLimit, webhookUrl } =
      req.body;
    const userId = req.user.id;
    const user = await userModel.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    if (!name || !type || !schedule || !payload) {
      return res.status(400).json({ message: "All fields are required" });
    }
    if (!["http", "shell"].includes(type)) {
      return res.status(400).json({ message: "Invalid job type" });
    }
    if (!cron.validate(schedule)) {
      return res.status(400).json({ message: "Invalid cron schedule format" });
    }
    // Validate payload based on job type
    if (type === "http") {
      if (!payload.url || !payload.method) {
        return res
          .status(400)
          .json({ message: "HTTP jobs require url and method in payload" });
      }
    } else if (type === "shell") {
      if (!payload.command) {
        return res
          .status(400)
          .json({ message: "Shell jobs require command in payload" });
      }
    }

    const newJob = new jobModel({
      userId: user._id,
      name,
      type,
      schedule,
      payload,
      enabled,
      retryLimit,
      webhookUrl,
      orgId: user.orgId,
    });

    await newJob.save();

    const jobIdStr = String(newJob._id);

    if (enabled !== false) {
      if (scheduledJobs[jobIdStr]) {
        scheduledJobs[jobIdStr].stop();
        delete scheduledJobs[jobIdStr];
      }
      scheduledJobs[jobIdStr] = cron.schedule(schedule, async () => {
        try {
          console.log(`Executing job: ${name} (ID: ${jobIdStr})`);
          if (type === "http") {
            await withRetries(newJob, (retryCount) =>
              executeHttpJob(newJob, retryCount)
            );
          } else if (type === "shell") {
            await withRetries(newJob, (retryCount) =>
              executeShellJob(newJob, retryCount)
            );
          }
        } catch (error) {
          console.error(`Error executing job ${name}:`, error);
        }
      });
    }

    return res
      .status(201)
      .json({ message: "Job created successfully", job: newJob });
  } catch (error) {
    console.error("Error creating job:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Helper function to execute HTTP jobs with retries and logging
export async function executeHttpJob(job, retryCount = 0) {
  const { url, method, headers = {}, body } = job.payload;

  try {
    const config = {
      method: method.toLowerCase(),
      url,
      headers,
    };
    if (body && ["post", "put", "patch"].includes(method.toLowerCase())) {
      config.data = body;
    }
    const response = await axios(config);
    const jobHistory = await jobHistoryModel.create({
      jobId: job._id,
      status: "success",
      output: {
        status: response.status,
        statusText: response.statusText,
        data: response.data,
        headers: response.headers,
      },
      retryCount,
      orgId: job.orgId,
    });
    console.log(`HTTP Job ${job.name} executed successfully:`, response.data);

    if (job.webhookUrl) {
      try {
        await axios.post(job.webhookUrl, {
          jobId: job._id,
          status: "success",
          output: jobHistory.output,
          executedAt: jobHistory.executedAt,
          retryCount,
        });
      } catch (whErr) {
        console.warn("Webhook call (success) failed:", whErr.message);
      }
    }

    return response;
  } catch (error) {
    console.error(`HTTP Job ${job.name} failed:`, error.message);

    const output = error.response
      ? {
          status: error.response.status,
          data: error.response.data,
          headers: error.response.headers,
        }
      : null;

    const jobHistory = await jobHistoryModel.create({
      jobId: job._id,
      status: "failure",
      error: error.toString(),
      output,
      retryCount,
      orgId: job.orgId,
    });

    if (job.webhookUrl) {
      try {
        await axios.post(job.webhookUrl, {
          jobId: job._id,
          status: "failure",
          error: error.toString(),
          output,
          executedAt: jobHistory.executedAt,
          retryCount,
        });
      } catch (whErr) {
        console.warn("Webhook call (failure) failed:", whErr.message);
      }
    }
    throw error;
  }
}

// Helper function to execute shell jobs with retries and logging
export async function executeShellJob(job, retryCount = 0) {
  const { command } = job.payload;
  try {
    const { stdout, stderr } = await execAsync(command);

    if (stderr) {
      console.warn(`Shell Job ${job.name} stderr:`, stderr);
    }
    const jobHistory = await jobHistoryModel.create({
      jobId: job._id,
      status: "success",
      output: { stdout, stderr },
      retryCount,
      orgId: job.orgId,
    });
    if (job.webhookUrl) {
      try {
        await axios.post(job.webhookUrl, {
          jobId: job._id,
          status: "success",
          output: jobHistory.output,
          executedAt: jobHistory.executedAt,
          retryCount,
        });
      } catch (whErr) {
        console.warn("Webhook call (success) failed:", whErr.message);
      }
    }
    console.log(`Shell Job ${job.name} executed successfully:`, stdout);

    return { stdout, stderr };
  } catch (error) {
    console.error(`Shell Job ${job.name} failed:`, error.message);
    const jobHistory = await jobHistoryModel.create({
      jobId: job._id,
      status: "failure",
      error: error.toString(),
      output: null,
      retryCount,
      orgId: job.orgId,
    });
    if (job.webhookUrl) {
      try {
        await axios.post(job.webhookUrl, {
          jobId: job._id,
          status: "failure",
          error: error.toString(),
          output: null,
          executedAt: jobHistory.executedAt,
          retryCount,
        });
      } catch (whErr) {
        console.warn("Webhook call (failure) failed:", whErr.message);
      }
    }
    throw error;
  }
}

// LIST JOBS
export const getJobs = async (req, res) => {
  try {
    const userId = req.user.id;
    const jobs = await jobModel
      .find({ orgId: req.user.orgId }) // Ensure jobs are scoped to user's organization
      .populate("userId", "username email");

    return res.status(200).json(jobs);
  } catch (error) {
    console.error("Error fetching jobs:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// GET JOB BY ID - Remove userId filter
export const getJobById = async (req, res) => {
  try {
    const { jobId } = req.params;

    const job = await jobModel
      .findOne({ _id: jobId, orgId: req.user.orgId }) // Remove userId
      .populate("userId", "username email");

    if (!job) {
      return res.status(404).json({ message: "Job not found" });
    }

    return res.status(200).json(job);
  } catch (error) {
    console.error("Error fetching job by ID:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// UPDATE JOB - Remove userId filter  
export const updateJob = async (req, res) => {
  try {
    const { jobId } = req.params;

    const job = await jobModel.findOne({
      _id: jobId,
      orgId: req.user.orgId, // Remove userId
    });
    if (!job) {
      return res.status(404).json({ message: "Job not found" });
    }

    // Only update fields if they are provided
    const { name, type, schedule, payload, enabled, retryLimit } = req.body;

    if (name !== undefined) job.name = name;
    if (type !== undefined) {
      if (!["http", "shell"].includes(type)) {
        return res.status(400).json({ message: "Invalid job type" });
      }
      job.type = type;
    }
    if (schedule !== undefined) {
      if (!cron.validate(schedule)) {
        return res
          .status(400)
          .json({ message: "Invalid cron schedule format" });
      }
      job.schedule = schedule;
    }
    if (payload !== undefined) job.payload = payload;

    // Improved: validate payload matches type if either changes
    const effectiveType = type !== undefined ? type : job.type;
    const effectivePayload = payload !== undefined ? payload : job.payload;
    if (effectiveType === "http") {
      if (!effectivePayload.url || !effectivePayload.method) {
        return res
          .status(400)
          .json({ message: "HTTP jobs require url and method in payload" });
      }
    } else if (effectiveType === "shell") {
      if (!effectivePayload.command) {
        return res
          .status(400)
          .json({ message: "Shell jobs require command in payload" });
      }
    }

    if (enabled !== undefined) job.enabled = enabled;
    if (retryLimit !== undefined) job.retryLimit = retryLimit;

    await job.save();

    const jobIdStr = String(job._id);

    // Stop existing scheduled job if running
    if (scheduledJobs[jobIdStr]) {
      scheduledJobs[jobIdStr].stop();
      delete scheduledJobs[jobIdStr];
    }

    // Reschedule the job if enabled
    if (job.enabled) {
      scheduledJobs[jobIdStr] = cron.schedule(job.schedule, async () => {
        try {
          console.log(`Executing updated job: ${job.name} (ID: ${job._id})`);
          if (job.type === "http") {
            await withRetries(job, (retryCount) =>
              executeHttpJob(job, retryCount)
            );
          } else if (job.type === "shell") {
            await withRetries(job, (retryCount) =>
              executeShellJob(job, retryCount)
            );
          }
        } catch (error) {
          console.error(`Error executing updated job ${job.name}:`, error);
        }
      });
    }

    return res.status(200).json({ message: "Job updated successfully", job });
  } catch (error) {
    console.error("Error updating job:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// DELETE JOB
export const deleteJob = async (req, res) => {
  try {
    const { jobId } = req.params;
    const userId = req.user.id;

    const job = await jobModel.findOne({
      _id: jobId,
      userId,
      orgId: req.user.orgId,
    });
    if (!job) {
      return res.status(404).json({ message: "Job not found" });
    }

    const jobIdStr = String(job._id);

    // Stop and remove cron job from memory if scheduled
    if (scheduledJobs[jobIdStr]) {
      scheduledJobs[jobIdStr].stop();
      delete scheduledJobs[jobIdStr];
    }

    await jobModel.deleteOne({ _id: jobId, userId, orgId: req.user.orgId });
    return res.status(200).json({ message: "Job deleted successfully" });
  } catch (error) {
    console.error("Error deleting job:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// TOGGLE JOB STATUS (enable/disable)
export const toggleJobStatus = async (req, res) => {
  try {
    const { jobId } = req.params;
    const userId = req.user.id;
    const job = await jobModel.findOne({
      _id: jobId,
      userId,
      orgId: req.user.orgId,
    });
    if (!job) {
      return res.status(404).json({ message: "Job not found" });
    }

    job.enabled = !job.enabled;
    await job.save();

    const jobIdStr = String(job._id);

    if (job.enabled) {
      // Stop any old schedule and start a new one
      if (scheduledJobs[jobIdStr]) {
        scheduledJobs[jobIdStr].stop();
        delete scheduledJobs[jobIdStr];
      }
      scheduledJobs[jobIdStr] = cron.schedule(job.schedule, async () => {
        try {
          console.log(`Executing toggled job: ${job.name} (ID: ${job._id})`);
          if (job.type === "http") {
            await withRetries(job, (retryCount) =>
              executeHttpJob(job, retryCount)
            );
          } else if (job.type === "shell") {
            await withRetries(job, (retryCount) =>
              executeShellJob(job, retryCount)
            );
          }
        } catch (error) {
          console.error(`Error executing toggled job ${job.name}:`, error);
        }
      });
    } else {
      // Stop and remove schedule
      if (scheduledJobs[jobIdStr]) {
        scheduledJobs[jobIdStr].stop();
        delete scheduledJobs[jobIdStr];
      }
    }
    return res
      .status(200)
      .json({ message: "Job status toggled successfully", job });
  } catch (error) {
    console.error("Error toggling job status:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
