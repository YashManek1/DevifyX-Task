import { registerUser,loginUser } from "../controllers/userC.js";
import express from "express";

const router = express.Router();

router.post("/register", registerUser);
router.post("/login", loginUser);

export default router;
