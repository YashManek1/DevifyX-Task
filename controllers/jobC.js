import userModel from "../models/user.js";
import jobModel from "../models/job.js";
import cron from "node-cron";
import axios from "axios";
import { exec } from "child_process";
import { promisify } from "util";

// In-memory store for scheduled jobs
export const scheduledJobs = {}; // Exported for access in other modules if needed

const execAsync = promisify(exec); // Convert exec to promise-based

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
    // Validate job type
    if (!["http", "shell"].includes(type)) {
      return res.status(400).json({ message: "Invalid job type" });
    }
    // Validate schedule format (basic validation, can be improved)
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

    // Create a new job instance
    const newJob = new jobModel({
      userId: user._id,
      name,
      type,
      schedule,
      payload,
      enabled,
      retryLimit,
    });

    // Save the job to the database
    await newJob.save();

    // Schedule the job using cron only if enabled
    if (enabled !== false) {
      // If already scheduled (should not be on create), stop it first
      if (scheduledJobs[newJob._id]) {
        scheduledJobs[newJob._id].stop();
        delete scheduledJobs[newJob._id];
      }
      scheduledJobs[newJob._id] = cron.schedule(schedule, async () => {
        try {
          console.log(`Executing job: ${name} (ID: ${newJob._id})`);
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

    // Add body for POST, PUT, PATCH requests
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

export const getJobById = async (req, res) => {
  try {
    const { jobId } = req.params; // Fix: was req.params.jobId
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

    // Validate payload if either type or payload changed
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

    // Save updated job
    await job.save();

    // Always use string for jobId in scheduledJobs
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

export const deleteJob = async (req, res) => {
  try {
    const { jobId } = req.params;
    const userId = req.user.id;

    const job = await jobModel.findOne({ _id: jobId, userId });
    if (!job) {
      return res.status(404).json({ message: "Job not found" });
    }

    // Stop and remove cron job from memory if scheduled
    if (scheduledJobs[jobId]) {
      scheduledJobs[jobId].stop();
      delete scheduledJobs[jobId];
    }

    // Delete the job from the database
    await jobModel.deleteOne({ _id: jobId, userId });
    return res.status(200).json({ message: "Job deleted successfully" });
  } catch (error) {
    console.error("Error deleting job:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const toggleJobStatus = async (req, res) => {
  try {
    const { jobId } = req.params;
    const userId = req.user.id;
    const job = await jobModel.findOne({ _id: jobId, userId });
    if (!job) {
      return res.status(404).json({ message: "Job not found" });
    }
    // Toggle the enabled status
    job.enabled = !job.enabled;

    // Save new status first
    await job.save();

    if (job.enabled) {
      // If enabling, stop any old and schedule new
      if (scheduledJobs[jobId]) {
        scheduledJobs[jobId].stop();
        delete scheduledJobs[jobId];
      }
      scheduledJobs[jobId] = cron.schedule(job.schedule, async () => {
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
      // If disabling, stop and remove
      if (scheduledJobs[jobId]) {
        scheduledJobs[jobId].stop();
        delete scheduledJobs[jobId];
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
