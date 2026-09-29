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

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "data");
const {
  ADMIN_PASSWORD_HASH,
  JWT_SECRET = "change-me",
  PORT = 4000,
  CLIENT_URL = "http://localhost:5173",
} = process.env;
const PUBLIC = [
  "profile",
  "menu",
  "skills",
  "projects",
  "experience",
  "certificates",
];

// JSON storage: atomic write (temp file -> rename) so data never gets corrupted
const read = async (n) =>
  JSON.parse(await fs.readFile(`${dir}/${n}.json`, "utf8"));
const write = async (n, d) => {
  const f = `${dir}/${n}.json`;
  await fs.writeFile(f + ".tmp", JSON.stringify(d, null, 2));
  await fs.rename(f + ".tmp", f);
};

const app = express();
const allowedOrigins = [
  "http://localhost:5173",
  "https://portfolio-frontend-qpp0.onrender.com"
];

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));

// Password is checked only on the server. 5 wrong tries = 15 minute lock.
const tries = new Map();
app.post("/api/login", async (req, res) => {
  const t = tries.get(req.ip) || { n: 0, until: 0 };
  if (t.until > Date.now())
    return res
      .status(429)
      .json({ error: "Too many attempts. Try again in 15 minutes." });
  const ok =
    ADMIN_PASSWORD_HASH &&
    (await bcrypt.compare(
      String(req.body.password || ""),
      ADMIN_PASSWORD_HASH,
    ));
  if (!ok) {
    t.n += 1;
    if (t.n >= 5) {
      t.n = 0;
      t.until = Date.now() + 15 * 60 * 1000;
    }
    tries.set(req.ip, t);
    return res.status(401).json({ error: "Wrong password." });
  }
  tries.delete(req.ip);
  const token = jwt.sign({ admin: true }, JWT_SECRET, { expiresIn: "2h" });
  res
    .cookie("token", token, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 2 * 3600 * 1000,
    })
    .json({ ok: true });
});
app.post("/api/logout", (_, res) =>
  res.clearCookie("token").json({ ok: true }),
);

const auth = (req, res, next) => {
  try {
    jwt.verify(req.cookies.token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Please log in." });
  }
};
app.get("/api/me", auth, (_, res) => res.json({ admin: true }));

// Contact form (public) + inbox (admin)
app.post("/api/contact", async (req, res) => {
  const { name, email, message } = req.body;
  if (!name || !/^\S+@\S+\.\S+$/.test(email || "") || !message)
    return res
      .status(400)
      .json({ error: "Enter your name, a valid email and a message." });
  const list = await read("messages");
  list.unshift({
    id: Date.now().toString(),
    name: String(name).slice(0, 100),
    email,
    message: String(message).slice(0, 2000),
    date: new Date().toISOString(),
  });
  await write("messages", list);
  res.json({ ok: true });
});
app.get("/api/messages", auth, async (_, res) =>
  res.json(await read("messages")),
);
app.delete("/api/messages/:id", auth, async (req, res) => {
  await write(
    "messages",
    (await read("messages")).filter((m) => m.id !== req.params.id),
  );
  res.json({ ok: true });
});

// File upload (admin only): photos, certificate images, resume PDF. Max 5 MB.
const updir = path.join(path.dirname(dir), "uploads");
await fs.mkdir(updir, { recursive: true });
const okTypes = ["image/png", "image/jpeg", "image/webp", "application/pdf"];
const upload = multer({
  storage: multer.diskStorage({
    destination: updir,
    filename: (_, f, cb) =>
      cb(null, Date.now() + path.extname(f.originalname).toLowerCase()),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_, f, cb) =>
    cb(
      okTypes.includes(f.mimetype)
        ? null
        : new Error("Only PNG, JPG, WEBP or PDF files are allowed."),
      okTypes.includes(f.mimetype),
    ),
});
app.use("/uploads", express.static(updir));
app.post("/api/upload", auth, upload.single("file"), (req, res) =>
  res.json({ url: "/uploads/" + req.file.filename }),
);

// Content: anyone can read, only admin can replace
app.get("/api/:n", async (req, res) =>
  PUBLIC.includes(req.params.n)
    ? res.json(await read(req.params.n))
    : res.status(404).json({ error: "Not found" }),
);
app.put("/api/:n", auth, async (req, res) => {
  if (!PUBLIC.includes(req.params.n))
    return res.status(404).json({ error: "Not found" });
  await write(req.params.n, req.body);
  res.json({ ok: true });
});

app.use((e, _req, res, _next) => {
  if (e.code === "LIMIT_FILE_SIZE" || e.message?.startsWith("Only"))
    return res
      .status(400)
      .json({
        error:
          e.code === "LIMIT_FILE_SIZE"
            ? "File is larger than 5 MB."
            : e.message,
      });
  console.error(e);
  res.status(500).json({ error: "Server error" });
});
app.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`));
