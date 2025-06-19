import { authUser } from "../middlewares/jwt.js";
import {
  createJob,
  getJobs,
  getJobById,
  updateJob,
  deleteJob,
  toggleJobStatus,
} from "../controllers/jobC.js";

import express from "express";

const router = express.Router();

router.post("/createJob", authUser, createJob);
router.get("/getJobs", authUser, getJobs);
router.get("/getJobById/:jobId", authUser, getJobById);
router.put("/updateJob/:jobId", authUser, updateJob);
router.delete("/deleteJob/:jobId", authUser, deleteJob);
router.patch("/toggleJobStatus/:jobId", authUser, toggleJobStatus);

export default router;
