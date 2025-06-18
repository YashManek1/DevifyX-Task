import userModel from "../models/user.js";
import jobModel from "../models/job.js";
import cron from "node-cron";
import axios from "axios";
import { exec } from "child_process";
import { promisify } from "util";

// In-memory store for scheduled jobs (always use string keys for consistency)
export const scheduledJobs = {};

const execAsync = promisify(exec);

// CREATE JOB
export const createJob = async (req, res) => {
  try {
    const { name, type, schedule, payload, enabled, retryLimit } = req.body;
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
    });

    await newJob.save();

    const jobIdStr = String(newJob._id);

    if (enabled !== false) {
      // Defensive: stop any previous schedule for this jobId
      if (scheduledJobs[jobIdStr]) {
        scheduledJobs[jobIdStr].stop();
        delete scheduledJobs[jobIdStr];
      }
      scheduledJobs[jobIdStr] = cron.schedule(schedule, async () => {
        try {
          console.log(`Executing job: ${name} (ID: ${jobIdStr})`);
          if (type === "http") {
            await executeHttpJob(newJob);
          } else if (type === "shell") {
            await executeShellJob(newJob);
          }
        } catch (error) {
          console.error(`Error executing job ${name}:`, error);
          // TODO: Log to JobHistory with failure status
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

// Helper function to execute HTTP jobs
async function executeHttpJob(job) {
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
    console.log(`HTTP Job ${job.name} executed successfully:`, {
      status: response.status,
      statusText: response.statusText,
    });
    // TODO: Log to JobHistory with success status
    return response;
  } catch (error) {
    console.error(`HTTP Job ${job.name} failed:`, error.message);
    // TODO: Implement retry logic based on retryLimit
    throw error;
  }
}

// Helper function to execute shell jobs
async function executeShellJob(job) {
  const { command } = job.payload;

  try {
    const { stdout, stderr } = await execAsync(command);

    if (stderr) {
      console.warn(`Shell Job ${job.name} stderr:`, stderr);
    }

    console.log(`Shell Job ${job.name} executed successfully:`, stdout);
    // TODO: Log to JobHistory with success status
    return { stdout, stderr };
  } catch (error) {
    console.error(`Shell Job ${job.name} failed:`, error.message);
    // TODO: Implement retry logic based on retryLimit
    throw error;
  }
}

// LIST JOBS
export const getJobs = async (req, res) => {
  try {
    const userId = req.user.id;
    const jobs = await jobModel
      .find({ userId })
      .populate("userId", "username email");

    return res.status(200).json(jobs);
  } catch (error) {
    console.error("Error fetching jobs:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// GET JOB BY ID
export const getJobById = async (req, res) => {
  try {
    const { jobId } = req.params;
    const userId = req.user.id;

    const job = await jobModel
      .findOne({ _id: jobId, userId })
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

// UPDATE JOB (with improved payload/type validation and type safety)
export const updateJob = async (req, res) => {
  try {
    const { jobId } = req.params;
    const userId = req.user.id;

    const job = await jobModel.findOne({ _id: jobId, userId });
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
            await executeHttpJob(job);
          } else if (job.type === "shell") {
            await executeShellJob(job);
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

    const job = await jobModel.findOne({ _id: jobId, userId });
    if (!job) {
      return res.status(404).json({ message: "Job not found" });
    }

    const jobIdStr = String(job._id);

    // Stop and remove cron job from memory if scheduled
    if (scheduledJobs[jobIdStr]) {
      scheduledJobs[jobIdStr].stop();
      delete scheduledJobs[jobIdStr];
    }

    await jobModel.deleteOne({ _id: jobId, userId });
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
    const job = await jobModel.findOne({ _id: jobId, userId });
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
            await executeHttpJob(job);
          } else if (job.type === "shell") {
            await executeShellJob(job);
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
