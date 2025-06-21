import userModel from "../models/user.js";
import jobModel from "../models/job.js";
import jobHistoryModel from "../models/jobHistory.js";
import orgModel from "../models/organization.js";
import mongoose from "mongoose";

export const HealthCheck = async (req, res) => {
  try {
    // Check MongoDB connection state (0: disconnected, 1: connected, 2: connecting, 3: disconnecting)
    const dbState = mongoose.connection.readyState;
    const dbConnected = dbState === 1;

    // Try a simple query as well (optional, ensures queries work)
    let userCount = null;
    try {
      userCount = await userModel.countDocuments();
    } catch {
      // ignore, handled below
    }

    res.status(200).json({
      status: "ok",
      uptime: process.uptime(),
      dbConnected,
      dbState,
      userCount,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ status: "error", dbConnected: false });
  }
};

export const jobStats = async (req, res) => {
  try {
    const totalJobs = await jobModel.countDocuments();
    const enabledJobs = await jobModel.countDocuments({ enabled: true });
    const disabledJobs = await jobModel.countDocuments({ enabled: false });

    // Jobs by org
    const jobsByOrgAgg = await jobModel.aggregate([
      { $group: { _id: "$orgId", count: { $sum: 1 } } },
    ]);

    const jobsByOrg = await Promise.all(
      jobsByOrgAgg.map(async (org) => {
        const orgDoc = await orgModel.findById(org._id);
        return {
          orgId: org._id,
          orgName: orgDoc?.name || "Unknown",
          count: org.count,
        };
      })
    );

    // Jobs run in last 24h
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const jobsRunLast24h = await jobHistoryModel.distinct("jobId", {
      executedAt: { $gte: since },
    });

    res.json({
      totalJobs,
      jobsByOrg,
      enabledJobs,
      disabledJobs,
      jobsRunLast24h: jobsRunLast24h.length,
    });
  } catch (e) {
    res.status(500).json({ message: "Failed to fetch job stats" });
  }
};

// User Activity
export const userStats = async (req, res) => {
  try {
    const totalUsers = await userModel.countDocuments();

    // Get users and job counts per user
    const users = await userModel.find().select("username email orgId");
    const jobs = await jobModel.aggregate([
      { $group: { _id: "$userId", jobCount: { $sum: 1 } } },
    ]);
    // Map userId to jobCount
    const jobCountMap = {};
    jobs.forEach((j) => {
      jobCountMap[j._id.toString()] = j.jobCount;
    });

    const userData = users.map((u) => ({
      username: u.username,
      email: u.email,
      orgId: u.orgId,
      jobCount: jobCountMap[u._id.toString()] || 0,
    }));

    res.json({
      totalUsers,
      users: userData,
    });
  } catch (e) {
    res.status(500).json({ message: "Failed to fetch user stats" });
  }
};

//Get All Jobs/Users
export const getAllJobs = async (req, res) => {
  try {
    const jobs = await jobModel
      .find()
      .populate("userId", "username email")
      .populate("orgId", "name");
    res.json(jobs);
  } catch (e) {
    res.status(500).json({ message: "Failed to fetch all jobs" });
  }
};

export const getAllUsers = async (req, res) => {
  try {
    const users = await userModel.find().populate("orgId", "name");
    res.json(users);
  } catch (e) {
    res.status(500).json({ message: "Failed to fetch all users" });
  }
};
