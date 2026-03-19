import express from "express";
import cors from "cors";
import { getDb, closeDb } from "./db/index.js";
import authRoutes from "./routes/auth.js";
import personRoutes from "./routes/persons.js";
import connectionRoutes from "./routes/connections.js";
import inviteRoutes from "./routes/invites.js";
import graphRoutes from "./routes/graph.js";
import integrationRoutes from "./routes/integrations.js";
import gmailRoutes from "./routes/gmail.js";
import meConnectionRoutes from "./routes/me-connections.js";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: process.env.CORS_ORIGIN || "http://localhost:5173" }));
app.use(express.json());

// Initialize database on startup
getDb();

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/persons", personRoutes);
app.use("/api/connections", connectionRoutes);
app.use("/api/invites", inviteRoutes);
app.use("/api/graph", graphRoutes);
app.use("/api/integrations", integrationRoutes);
app.use("/api/gmail", gmailRoutes);
app.use("/api/me", meConnectionRoutes);

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

const server = app.listen(PORT, () => {
  console.log(`Connex backend running on http://localhost:${PORT}`);
});

process.on("SIGTERM", () => {
  closeDb();
  server.close();
});

process.on("SIGINT", () => {
  closeDb();
  server.close();
});

export default app;
