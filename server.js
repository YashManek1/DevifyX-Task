import dotenv from "dotenv";
import express from "express";
import connectMongoDb from "./config/connection.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

connectMongoDb(process.env.MONGO_URI);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
