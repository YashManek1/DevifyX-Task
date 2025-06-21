import express from "express";
import { authAdmin } from "../middlewares/jwt.js";

import {
  HealthCheck,
  jobStats,
  userStats,
  getAllJobs,
  getAllUsers,
} from "../controllers/adminC.js";

const router = express.Router();

router.get("/health", authAdmin, HealthCheck);
router.get("/job-stats", authAdmin, jobStats);
router.get("/user-stats", authAdmin, userStats);
router.get("/all-jobs", authAdmin, getAllJobs);
router.get("/all-users", authAdmin, getAllUsers);

export default router;
