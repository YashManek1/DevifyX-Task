import dotenv from "dotenv";
import express from "express";
import connectMongoDb from "./config/connection.js";
import cors from "cors";
import cron from "node-cron";

import jobModel from "./models/job.js";
import {
  scheduledJobs,
  executeHttpJob,
  executeShellJob,
} from "./controllers/jobC.js";
import userRoutes from "./routes/userR.js";
import jobRoutes from "./routes/jobR.js";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 5000;

app.use(
  cors({
    origin: "*", // Adjust to your frontend URL for production
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    credentials: true,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/users", userRoutes);
app.use("/jobs", jobRoutes);

async function scheduleExistingJobsOnStartup() {
  const jobs = await jobModel.find({ enabled: true });
  for (const job of jobs) {
    const jobIdStr = String(job._id);
    if (scheduledJobs[jobIdStr]) {
      scheduledJobs[jobIdStr].stop();
      delete scheduledJobs[jobIdStr];
    }
    scheduledJobs[jobIdStr] = cron.schedule(job.schedule, async () => {
      try {
        console.log(`Executing job: ${job.name} (ID: ${jobIdStr})`);
        if (job.type === "http") {
          await executeHttpJob(job);
        } else if (job.type === "shell") {
          await executeShellJob(job);
        }
      } catch (error) {
        console.error(`Error executing job ${job.name}:`, error);
      }
    });
  }
}

async function startServer() {
  await connectMongoDb(process.env.MONGO_URI);
  await scheduleExistingJobsOnStartup();
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
