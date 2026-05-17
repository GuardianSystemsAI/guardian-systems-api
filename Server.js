const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const app = express();
const PORT = process.env.PORT || 3001;
const MODEL = "claude-sonnet-4-20250514";
const ANTHROPIC_BASE = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : "*";

app.use(cors({ origin: allowedOrigins, methods: ["GET", "POST"], allowedHeaders: ["Content-Type"] }));
app.use(express.json({ limit: "20mb" }));

const generalLimiter = rateLimit({ windowMs: 60000, max: 30, message: { error: "Too many requests." } });
const imageLimiter = rateLimit({ windowMs: 60000, max: 12, message: { error: "Rate limit exceeded." } });
app.use("/api", generalLimiter);

function log(app, msg) { console.log(`[${new Date().toISOString()}] [${app}] ${msg}`); }

async function callAnthropic(body) {
  const response = await fetch(ANTHROPIC_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(body),
  });
  if (!response.ok) { const err = await response.json().catch(() => ({})); throw new Error(err.error?.message || `Error: ${response.status}`); }
  return response.json();
}

function extractJSON(text) {
  const clean = text.replace(/```json|```/g, "").trim();
  const start = clean.indexOf("{"), end = clean.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON found");
  return JSON.parse(clean.slice(start, end + 1));
}

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "Guardian Systems API", version: "1.0.0", key: ANTHROPIC_API_KEY ? "SET" : "MISSING" });
});

app.post("/api/traptrack/footprint", async (req, res) => {
  const { animalName } = req.body;
  if (!animalName) return res.status(400).json({ error: "animalName is required" });
  log("TrapTrack", `Footprint search: ${animalName}`);
  try {
    const data = await callAnthropic({
      model: MODEL, max_tokens: 1000,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [{ role: "user", content: `Search for a real photo of ${animalName} animal tracks for wildlife ID. Return ONLY JSON: {"imageUrl":"url","source":"site","altText":"desc","idTips":"2-3 ID tips"}` }],
    });
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    res.json({ success: true, ...extractJSON(text) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/streetsense/analyze", imageLimiter, async (req, res) => {
  const { imageData, mediaType = "image/jpeg", profile = "female" } = req.body;
  if (!imageData) return res.status(400).json({ error: "imageData is required" });
  try {
    const data = await callAnthropic({
      model: MODEL, max_tokens: 500,
      messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: mediaType, data: imageData } }, { type: "text", text: `Safety AI for ${profile} walking alone. Return ONLY JSON: {"riskLevel":"LOW/MEDIUM/HIGH","riskScore":0-100,"threats":[],"recommendation":"action","safeElements":[]}` }] }],
    });
    const text = (data.content || []).map((b) => b.text || "").join("");
    res.json({ success: true, ...extractJSON(text) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/sentinel/analyze", imageLimiter, async (req, res) => {
  const { imageData, mediaType = "image/jpeg", zoneContext = "" } = req.body;
  if (!imageData) return res.status(400).json({ error: "imageData is required" });
  try {
    const data = await callAnthropic({
      model: MODEL, max_tokens: 500,
      messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: mediaType, data: imageData } }, { type: "text", text: `Drone security AI${zoneContext ? " zone: "+zoneContext : ""}. Return ONLY JSON: {"threatDetected":true/false,"threatType":"person/vehicle/animal/none","riskScore":0-100,"riskLevel":"LOW/MEDIUM/HIGH","description":"desc","recommendedAction":"action"}` }] }],
    });
    const text = (data.content || []).map((b) => b.text || "").join("");
    res.json({ success: true, ...extractJSON(text) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.use((req, res) => res.status(404).json({ error: "Not found" }));
app.use((err, req, res, next) => res.status(500).json({ error: "Server error" }));

app.listen(PORT, () => {
  console.log(`Guardian Systems API running on port ${PORT}`);
  console.log(`API Key: ${ANTHROPIC_API_KEY ? "SET" : "MISSING - add to environment variables"}`);
});
