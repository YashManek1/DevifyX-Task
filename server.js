import dotenv from "dotenv";
import express from "express";
import connectMongoDb from "./config/connection.js";
import cors from "cors";

import userRoutes from "./routes/userR.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(
  cors({
    origin: "*", // Adjust this to your frontend URL
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/users", userRoutes);

connectMongoDb(process.env.MONGO_URI);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
