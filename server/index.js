import "dotenv/config";

import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import multer from "multer";
import mongoose from "mongoose";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

// ------------------------------------
// Basic setup
// ------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Render proxy ke peeche sahi client IP milne ke liye
app.set("trust proxy", 1);

const PORT = process.env.PORT || 5000;

const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;
const MONGODB_URI = process.env.MONGODB_URI;

if (!JWT_SECRET) {
  console.error("JWT_SECRET is missing from environment variables.");
  process.exit(1);
}

if (!MONGODB_URI) {
  console.error("MONGODB_URI is missing from environment variables.");
  process.exit(1);
}

const stripSlash = (url) => String(url).replace(/\/+$/, "");

const allowedOrigins = [
  "http://localhost:5173",
  "https://portfolio-frontend-qpp0.onrender.com",
];

if (process.env.CLIENT_URL) {
  allowedOrigins.push(stripSlash(process.env.CLIENT_URL));
}

// ------------------------------------
// Middleware
// ------------------------------------

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

// ------------------------------------
// MongoDB models
// ------------------------------------

const PUBLIC_SECTIONS = [
  "profile",
  "menu",
  "skills",
  "projects",
  "experience",
  "certificates",
];

// Har section (profile, menu, skills...) ek document me save hota hai
const Section = mongoose.model(
  "Section",
  new mongoose.Schema(
    {
      name: { type: String, required: true, unique: true },
      data: mongoose.Schema.Types.Mixed,
    },
    { minimize: false }
  )
);

const Message = mongoose.model(
  "Message",
  new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    name: String,
    email: String,
    message: String,
    date: String,
  })
);

// Uploaded photos / resume / certificate images MongoDB me store hote hain
const Upload = mongoose.model(
  "Upload",
  new mongoose.Schema({
    filename: { type: String, required: true, unique: true },
    contentType: String,
    data: Buffer,
  })
);

// ------------------------------------
// Data helpers
// ------------------------------------

async function readData(name) {
  const doc = await Section.findOne({ name }).lean();

  if (doc) return doc.data;

  return name === "profile" ? {} : [];
}

async function writeData(name, data) {
  await Section.findOneAndUpdate(
    { name },
    { $set: { data } },
    { upsert: true }
  );
}

// ------------------------------------
// First-time seed (purani data/*.json aur uploads/ se)
// ------------------------------------

const dataDir = path.join(__dirname, "data");
const uploadsDir = path.join(__dirname, "uploads");

const MIME_BY_EXT = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
};

async function readJsonFile(name) {
  try {
    const content = await fs.readFile(path.join(dataDir, `${name}.json`), "utf8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function seedDatabase() {
  for (const name of PUBLIC_SECTIONS) {
    const exists = await Section.exists({ name });

    if (!exists) {
      const fileData = await readJsonFile(name);
      const fallback = name === "profile" ? {} : [];

      await Section.create({ name, data: fileData ?? fallback });
      console.log(`Seeded section: ${name}`);
    }
  }

  if ((await Message.countDocuments()) === 0) {
    const oldMessages = await readJsonFile("messages");

    if (Array.isArray(oldMessages) && oldMessages.length) {
      await Message.insertMany(
        oldMessages.map((m) => ({
          id: String(m.id),
          name: m.name,
          email: m.email,
          message: m.message,
          date: m.date,
        }))
      );
      console.log("Seeded messages");
    }
  }

  try {
    const files = await fs.readdir(uploadsDir);

    for (const filename of files) {
      const ext = path.extname(filename).toLowerCase();
      const contentType = MIME_BY_EXT[ext];

      if (!contentType) continue;
      if (await Upload.exists({ filename })) continue;

      const data = await fs.readFile(path.join(uploadsDir, filename));
      await Upload.create({ filename, contentType, data });
      console.log(`Seeded upload: ${filename}`);
    }
  } catch {
    // uploads folder na ho to koi problem nahi
  }
}

// ------------------------------------
// Async error handler
// ------------------------------------

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// ------------------------------------
// Authentication middleware
// (Bearer token pehle, cookie backup)
// ------------------------------------

function auth(req, res, next) {
  try {
    const header = req.headers.authorization || "";

    const token = header.startsWith("Bearer ")
      ? header.slice(7)
      : req.cookies?.token;

    if (!token) {
      return res.status(401).json({ error: "Please log in." });
    }

    jwt.verify(token, JWT_SECRET);

    next();
  } catch {
    return res.status(401).json({ error: "Please log in." });
  }
}

// ------------------------------------
// Health check
// ------------------------------------

app.get("/", (req, res) => {
  res.json({ message: "Portfolio backend is running." });
});

// ------------------------------------
// Admin login
// ------------------------------------

const loginAttempts = new Map();

app.post(
  "/api/login",
  asyncHandler(async (req, res) => {
    const ip = req.ip;

    const attempt = loginAttempts.get(ip) || {
      count: 0,
      lockedUntil: 0,
    };

    if (attempt.lockedUntil > Date.now()) {
      return res.status(429).json({
        error: "Too many attempts. Try again in 15 minutes.",
      });
    }

    const password = String(req.body?.password || "");

    const isValid =
      ADMIN_PASSWORD_HASH &&
      (await bcrypt.compare(password, ADMIN_PASSWORD_HASH));

    if (!isValid) {
      attempt.count += 1;

      if (attempt.count >= 5) {
        attempt.count = 0;
        attempt.lockedUntil = Date.now() + 15 * 60 * 1000;
      }

      loginAttempts.set(ip, attempt);

      return res.status(401).json({
        error: "Wrong password.",
      });
    }

    loginAttempts.delete(ip);

    const token = jwt.sign({ admin: true }, JWT_SECRET, {
      expiresIn: "2h",
    });

    const isProduction = process.env.NODE_ENV === "production";

    res.cookie("token", token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "none" : "lax",
      maxAge: 2 * 60 * 60 * 1000,
      path: "/",
    });

    // token response me bhi bhej rahe hain (mobile ke liye)
    return res.json({ ok: true, token });
  })
);

// ------------------------------------
// Admin logout
// ------------------------------------

app.post("/api/logout", (req, res) => {
  const isProduction = process.env.NODE_ENV === "production";

  res.clearCookie("token", {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    path: "/",
  });

  res.json({ ok: true });
});

// ------------------------------------
// Check current admin session
// ------------------------------------

app.get("/api/me", auth, (req, res) => {
  res.json({ admin: true });
});

// ------------------------------------
// Contact form
// ------------------------------------

app.post(
  "/api/contact",
  asyncHandler(async (req, res) => {
    const { name, email, message } = req.body || {};

    const validEmail = /^\S+@\S+\.\S+$/.test(email || "");

    if (!name || !validEmail || !message) {
      return res.status(400).json({
        error: "Enter your name, a valid email and a message.",
      });
    }

    await Message.create({
      id: `${Date.now()}${crypto.randomBytes(2).toString("hex")}`,
      name: String(name).slice(0, 100),
      email: String(email).slice(0, 200),
      message: String(message).slice(0, 2000),
      date: new Date().toISOString(),
    });

    res.json({ ok: true });
  })
);

// ------------------------------------
// Admin: get contact messages
// ------------------------------------

app.get(
  "/api/messages",
  auth,
  asyncHandler(async (req, res) => {
    const messages = await Message.find()
      .sort({ date: -1 })
      .select("-_id -__v")
      .lean();

    res.json(messages);
  })
);

// ------------------------------------
// Admin: delete contact message
// ------------------------------------

app.delete(
  "/api/messages/:id",
  auth,
  asyncHandler(async (req, res) => {
    await Message.deleteOne({ id: req.params.id });

    res.json({ ok: true });
  })
);

// ------------------------------------
// File upload (MongoDB me store)
// ------------------------------------

const allowedMimeTypes = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },

  fileFilter: (req, file, callback) => {
    if (allowedMimeTypes.includes(file.mimetype)) {
      return callback(null, true);
    }

    callback(new Error("Only PNG, JPG, WEBP or PDF files are allowed."));
  },
});

// Uploaded file ko database se serve karo
app.get(
  "/uploads/:filename",
  asyncHandler(async (req, res) => {
    const file = await Upload.findOne({ filename: req.params.filename });

    if (!file) {
      return res.status(404).json({ error: "File not found." });
    }

    res.set({
      "Content-Type": file.contentType || "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
      "Cross-Origin-Resource-Policy": "cross-origin",
    });

    res.send(file.data);
  })
);

// Admin-only upload route
app.post(
  "/api/upload",
  auth,
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "Please select a file." });
    }

    let extension = path.extname(req.file.originalname).toLowerCase();

    if (!/^\.[a-z0-9]{1,5}$/.test(extension)) extension = "";

    const filename = `${Date.now()}-${crypto
      .randomBytes(3)
      .toString("hex")}${extension}`;

    await Upload.create({
      filename,
      contentType: req.file.mimetype,
      data: req.file.buffer,
    });

    res.json({ url: `/uploads/${filename}` });
  })
);

// ------------------------------------
// Public content APIs
// ------------------------------------

app.get(
  "/api/:section",
  asyncHandler(async (req, res) => {
    const { section } = req.params;

    if (!PUBLIC_SECTIONS.includes(section)) {
      return res.status(404).json({ error: "Not found." });
    }

    const data = await readData(section);

    res.json(data);
  })
);

app.put(
  "/api/:section",
  auth,
  asyncHandler(async (req, res) => {
    const { section } = req.params;

    if (!PUBLIC_SECTIONS.includes(section)) {
      return res.status(404).json({ error: "Not found." });
    }

    const isProfile = section === "profile";
    const body = req.body;

    const validShape = isProfile
      ? body && typeof body === "object" && !Array.isArray(body)
      : Array.isArray(body);

    if (!validShape) {
      return res.status(400).json({ error: "Invalid data format." });
    }

    await writeData(section, body);

    res.json({ ok: true });
  })
);

// ------------------------------------
// Error handler
// ------------------------------------

app.use((error, req, res, next) => {
  if (error.code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({
      error: "File is larger than 5 MB.",
    });
  }

  if (error.message?.startsWith("Only PNG")) {
    return res.status(400).json({
      error: error.message,
    });
  }

  console.error(error);

  res.status(500).json({
    error: "Server error.",
  });
});

// ------------------------------------
// Start server
// ------------------------------------

try {
  await mongoose.connect(MONGODB_URI);
  console.log("MongoDB connected");

  await seedDatabase();
} catch (error) {
  console.error("MongoDB connection failed:", error.message);
  process.exit(1);
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});