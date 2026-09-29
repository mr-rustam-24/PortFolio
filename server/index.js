import "dotenv/config";

import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import multer from "multer";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

// ------------------------------------
// Basic setup
// ------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

const PORT = process.env.PORT || 5000;

const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;

// Local frontend URL aur deployed Render frontend URL
const allowedOrigins = [
  "http://localhost:5173",
  "https://portfolio-frontend-qpp0.onrender.com",
];

// Agar Render environment mein CLIENT_URL set kiya hai,
// toh us URL ko bhi allow kar do.
if (process.env.CLIENT_URL) {
  allowedOrigins.push(process.env.CLIENT_URL);
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
// Data paths
// ------------------------------------

const dataDir = path.join(__dirname, "data");
const uploadsDir = path.join(__dirname, "uploads");

await fs.mkdir(dataDir, { recursive: true });
await fs.mkdir(uploadsDir, { recursive: true });

const PUBLIC_SECTIONS = [
  "profile",
  "menu",
  "skills",
  "projects",
  "experience",
  "certificates",
];

// ------------------------------------
// JSON file helpers
// ------------------------------------

async function readData(name) {
  const filePath = path.join(dataDir, `${name}.json`);
  const content = await fs.readFile(filePath, "utf8");

  return JSON.parse(content);
}

async function writeData(name, data) {
  const filePath = path.join(dataDir, `${name}.json`);
  const tempPath = `${filePath}.tmp`;

  await fs.writeFile(tempPath, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tempPath, filePath);
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
// ------------------------------------

function auth(req, res, next) {
  try {
    const token = req.cookies?.token;

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

    const token = jwt.sign(
      { admin: true },
      JWT_SECRET,
      { expiresIn: "2h" }
    );

    const isProduction = process.env.NODE_ENV === "production";

    res.cookie("token", token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "none" : "lax",
      maxAge: 2 * 60 * 60 * 1000,
      path: "/",
    });

    return res.json({ ok: true });
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

    const messages = await readData("messages");

    messages.unshift({
      id: Date.now().toString(),
      name: String(name).slice(0, 100),
      email: String(email).slice(0, 200),
      message: String(message).slice(0, 2000),
      date: new Date().toISOString(),
    });

    await writeData("messages", messages);

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
    const messages = await readData("messages");
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
    const messages = await readData("messages");

    const updatedMessages = messages.filter(
      (message) => message.id !== req.params.id
    );

    await writeData("messages", updatedMessages);

    res.json({ ok: true });
  })
);

// ------------------------------------
// File upload configuration
// ------------------------------------

const allowedMimeTypes = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
];

const storage = multer.diskStorage({
  destination: (req, file, callback) => {
    callback(null, uploadsDir);
  },

  filename: (req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const filename = `${Date.now()}${extension}`;

    callback(null, filename);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },

  fileFilter: (req, file, callback) => {
    if (allowedMimeTypes.includes(file.mimetype)) {
      return callback(null, true);
    }

    callback(
      new Error("Only PNG, JPG, WEBP or PDF files are allowed.")
    );
  },
});

// Serve uploaded files
app.use("/uploads", express.static(uploadsDir));

// Admin-only upload route
app.post(
  "/api/upload",
  auth,
  upload.single("file"),
  (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "Please select a file." });
    }

    res.json({
      url: `/uploads/${req.file.filename}`,
    });
  }
);

// ------------------------------------
// Public content APIs
// ------------------------------------

// Anyone can read public portfolio sections
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

// Only admin can update public portfolio sections
app.put(
  "/api/:section",
  auth,
  asyncHandler(async (req, res) => {
    const { section } = req.params;

    if (!PUBLIC_SECTIONS.includes(section)) {
      return res.status(404).json({ error: "Not found." });
    }

    await writeData(section, req.body);

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

if (!JWT_SECRET) {
  console.error("JWT_SECRET is missing from environment variables.");
  process.exit(1);
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});