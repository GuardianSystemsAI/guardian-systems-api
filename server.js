// ─────────────────────────────────────────────────────────────────────────────
// GUARDIAN SYSTEMS API — Backend Proxy Server v1.0.0
// Protects the Anthropic API key for all Guardian Systems apps:
//   🚶 StreetSense — camera threat analysis
//   🪤 TrapTrack   — footprint photo search
//   🛸 Sentinel    — drone AI analysis (future)
// ─────────────────────────────────────────────────────────────────────────────

const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const app = express();
const PORT = process.env.PORT || 3001;
const MODEL = "claude-sonnet-4-20250514";
const ANTHROPIC_BASE = "https://api.anthropic.com/v1/messages";

// ─── Startup validation ──────────────────────────────────────────────────────
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("FATAL: ANTHROPIC_API_KEY environment variable is not set.");
  process.exit(1);
}
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// ─── CORS ────────────────────────────────────────────────────────────────────
// ALLOWED_ORIGINS = comma-separated list of frontend URLs, or * for all
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : "*";

app.use(
  cors({
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
  })
);

// ─── Body parsing ─────────────────────────────────────────────────────────────
// 20MB limit for base64 camera frames from StreetSense / Sentinel
app.use(express.json({ limit: "20mb" }));

// ─── Rate limiting ────────────────────────────────────────────────────────────
// General: 30 requests/minute per IP
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: "Too many requests — please slow down." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Stricter for image endpoints (camera frames cost more tokens)
const imageLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 12,
  message: { error: "Image analysis rate limit exceeded. Try again shortly." },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api", generalLimiter);

// ─── Logging helper ───────────────────────────────────────────────────────────
function log(app, msg) {
  console.log(`[${new Date().toISOString()}] [${app}] ${msg}`);
}

// ─── Anthropic API helper ─────────────────────────────────────────────────────
async function callAnthropic(body) {
  const response = await fetch(ANTHROPIC_BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(
      err.error?.message || `Anthropic API error: ${response.status}`
    );
  }

  return response.json();
}

// ─── JSON parse helper ────────────────────────────────────────────────────────
function extractJSON(text) {
  const clean = text.replace(/```json|```/g, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON found in response");
  return JSON.parse(clean.slice(start, end + 1));
}

// ─────────────────────────────────────────────────────────────────────────────
// HEALTH CHECK
// GET /health
// ─────────────────────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "Guardian Systems API",
    version: "1.0.0",
    model: MODEL,
    apps: ["streetsense", "traptrack", "sentinel"],
    timestamp: new Date().toISOString(),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// STREETSENSE — Camera threat analysis
// POST /api/streetsense/analyze
// Body: { imageData: string (base64), mediaType?: string, profile?: "male"|"female" }
// Returns: { success, riskLevel, riskScore, threats, recommendation, safeElements }
// ─────────────────────────────────────────────────────────────────────────────
app.post("/api/streetsense/analyze", imageLimiter, async (req, res) => {
  const { imageData, mediaType = "image/jpeg", profile = "female" } = req.body;

  if (!imageData) {
    return res.status(400).json({ error: "imageData is required" });
  }

  log("StreetSense", `Analyzing frame — profile: ${profile}`);

  const prompt = `You are a real-time personal safety AI for a ${profile} walking alone outdoors. 
Analyze this camera frame for potential threats or safety concerns. 
Respond with ONLY a JSON object — no markdown, no explanation:
{
  "riskLevel": "LOW" or "MEDIUM" or "HIGH",
  "riskScore": number 0-100,
  "threats": ["list of specific threat descriptions, empty array if none"],
  "recommendation": "one clear action sentence for the walker",
  "safeElements": ["reassuring safe things observed in the scene"]
}`;

  try {
    const data = await callAnthropic({
      model: MODEL,
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType,
                data: imageData,
              },
            },
            { type: "text", text: prompt },
          ],
        },
      ],
    });

    const text = (data.content || []).map((b) => b.text || "").join("");
    const result = extractJSON(text);

    log("StreetSense", `Risk: ${result.riskLevel} (${result.riskScore})`);
    res.json({ success: true, ...result });
  } catch (err) {
    log("StreetSense", `Error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// TRAPTRACK — Footprint photo search
// POST /api/traptrack/footprint
// Body: { animalName: string }
// Returns: { success, imageUrl, source, altText, idTips }
// ─────────────────────────────────────────────────────────────────────────────
app.post("/api/traptrack/footprint", async (req, res) => {
  const { animalName } = req.body;

  if (!animalName) {
    return res.status(400).json({ error: "animalName is required" });
  }

  log("TrapTrack", `Searching footprint photo for: ${animalName}`);

  const prompt = `Search the web for a clear, real photograph of ${animalName} animal footprints or tracks for wildlife identification purposes. Find the best publicly accessible image URL showing actual ${animalName} tracks in mud, snow, dirt, or on a wildlife tracking pad. Return ONLY a JSON object — no markdown, no explanation:
{
  "imageUrl": "direct URL to the image",
  "source": "website name where image was found",
  "altText": "brief description of what the image shows",
  "idTips": "2-3 key identification tips for these tracks covering size, toe count, shape, claw marks, and any distinctive features"
}`;

  try {
    const data = await callAnthropic({
      model: MODEL,
      max_tokens: 1000,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [{ role: "user", content: prompt }],
    });

    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");

    const result = extractJSON(text);
    log("TrapTrack", `Found image from: ${result.source}`);
    res.json({ success: true, ...result });
  } catch (err) {
    log("TrapTrack", `Error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SENTINEL — Drone AI threat analysis
// POST /api/sentinel/analyze
// Body: { imageData: string (base64), mediaType?: string, zoneContext?: string }
// Returns: { success, threatDetected, threatType, riskScore, riskLevel, description, recommendedAction }
// ─────────────────────────────────────────────────────────────────────────────
app.post("/api/sentinel/analyze", imageLimiter, async (req, res) => {
  const {
    imageData,
    mediaType = "image/jpeg",
    zoneContext = "",
  } = req.body;

  if (!imageData) {
    return res.status(400).json({ error: "imageData is required" });
  }

  log("Sentinel", `Analyzing drone frame${zoneContext ? " — zone: " + zoneContext : ""}`);

  const prompt = `You are an AI security system analyzing a live drone camera feed for perimeter security threats.${
    zoneContext ? " Zone context: " + zoneContext + "." : ""
  }
Identify any people, vehicles, or unusual activity. Respond with ONLY a JSON object — no markdown:
{
  "threatDetected": true or false,
  "threatType": "person" or "vehicle" or "animal" or "unknown" or "none",
  "riskScore": number 0-100,
  "riskLevel": "LOW" or "MEDIUM" or "HIGH",
  "description": "brief factual description of what was detected",
  "recommendedAction": "patrol" or "intercept" or "alert" or "monitor" or "clear"
}`;

  try {
    const data = await callAnthropic({
      model: MODEL,
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType,
                data: imageData,
              },
            },
            { type: "text", text: prompt },
          ],
        },
      ],
    });

    const text = (data.content || []).map((b) => b.text || "").join("");
    const result = extractJSON(text);

    log("Sentinel", `Threat: ${result.threatDetected} — ${result.riskLevel} (${result.riskScore})`);
    res.json({ success: true, ...result });
  } catch (err) {
    log("Sentinel", `Error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ─── 404 ──────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Endpoint not found: ${req.method} ${req.path}` });
});

// ─── Global error handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error("[Server Error]", err);
  res.status(500).json({ error: "Internal server error" });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🛡️  Guardian Systems API`);
  console.log(`   Running on port ${PORT}`);
  console.log(`   Model: ${MODEL}`);
  console.log(`   Apps: StreetSense | TrapTrack | Sentinel`);
  console.log(`   CORS: ${Array.isArray(allowedOrigins) ? allowedOrigins.join(", ") : allowedOrigins}`);
  console.log(`   Ready.\n`);
});
