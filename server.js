const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const DATA = path.join(ROOT, "data");
const CONFIG_PATH = path.join(ROOT, "config.json");
const config = fs.existsSync(CONFIG_PATH)
  ? JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"))
  : { mediaDirectory: "./media", port: 3000, siteName: "CINEMA HUB" };
const MEDIA_ROOT = path.resolve(ROOT, config.mediaDirectory || "./media");
const PORT = Number(process.env.PORT || config.port || 3000);
const DB_FILE = path.join(DATA, "store.json");
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
const VIDEO_EXT = new Set([".mp4", ".m4v", ".webm", ".mov", ".mkv"]);
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(MEDIA_ROOT, { recursive: true });

function loadStore() {
  if (!fs.existsSync(DB_FILE)) return { users: [], sessions: [], requests: [] };
  try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); }
  catch { throw new Error("data/store.json is invalid. Restore a valid backup before starting."); }
}
let store = loadStore();
function save() {
  const tmp = DB_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, DB_FILE);
}
function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}
function verifyPassword(password, record) {
  const candidate = crypto.scryptSync(password, record.salt, 64);
  return crypto.timingSafeEqual(candidate, Buffer.from(record.hash, "hex"));
}
function token() { return crypto.randomBytes(32).toString("hex"); }
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || "").split(";").forEach(part => {
    const i = part.indexOf("=");
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}
function currentUser(req) {
  const sid = parseCookies(req).cinema_session;
  const session = store.sessions.find(s => s.id === sid && s.expires > Date.now());
  if (!session) return null;
  return store.users.find(u => u.id === session.userId) || null;
}
function send(res, status, data, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(JSON.stringify(data));
}
function fail(res, status, message) { send(res, status, { error: message }); }
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 32_000) { reject(new Error("Request too large")); req.destroy(); }
    });
    req.on("end", () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}
function requireApproved(req, res) {
  const user = currentUser(req);
  if (!user) { fail(res, 401, "Please log in."); return null; }
  if (!user.approved) { fail(res, 403, "Your account is waiting for admin approval."); return null; }
  return user;
}
function safeText(value, max = 120) {
  return String(value || "").trim().replace(/[<>]/g, "").slice(0, max);
}
function walk(dir, relative = "") {
  let result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const abs = path.join(dir, entry.name);
    const rel = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) result = result.concat(walk(abs, rel));
    else {
      const ext = path.extname(entry.name).toLowerCase();
      if (VIDEO_EXT.has(ext) || IMAGE_EXT.has(ext)) {
        const stat = fs.statSync(abs);
        result.push({ id: Buffer.from(rel).toString("base64url"), name: entry.name, path: rel, type: VIDEO_EXT.has(ext) ? "video" : "image", size: stat.size });
      }
    }
  }
  return result;
}
function staticFile(req, res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const file = path.resolve(PUBLIC, "." + decodeURIComponent(requested));
  if (!file.startsWith(PUBLIC + path.sep) && file !== path.join(PUBLIC, "index.html")) return fail(res, 403, "Forbidden");
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return fail(res, 404, "Not found");
  const types = { ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".svg":"image/svg+xml" };
  res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
  fs.createReadStream(file).pipe(res);
}
function streamMedia(req, res, item) {
  const absolute = path.resolve(MEDIA_ROOT, item.path);
  if (!absolute.startsWith(MEDIA_ROOT + path.sep) || !fs.existsSync(absolute)) return fail(res, 404, "Media not found");
  const stat = fs.statSync(absolute);
  const ext = path.extname(absolute).toLowerCase();
  const mime = ({ ".mp4":"video/mp4", ".m4v":"video/mp4", ".webm":"video/webm", ".mov":"video/quicktime", ".mkv":"video/x-matroska", ".jpg":"image/jpeg", ".jpeg":"image/jpeg", ".png":"image/png", ".webp":"image/webp", ".gif":"image/gif" })[ext] || "application/octet-stream";
  const range = req.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) { res.writeHead(416); return res.end(); }
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
    if (start > end || start >= stat.size) { res.writeHead(416, { "Content-Range": `bytes */${stat.size}` }); return res.end(); }
    res.writeHead(206, { "Content-Type": mime, "Accept-Ranges": "bytes", "Content-Range": `bytes ${start}-${end}/${stat.size}`, "Content-Length": end - start + 1, "Cache-Control": "private, no-store" });
    fs.createReadStream(absolute, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { "Content-Type": mime, "Accept-Ranges": "bytes", "Content-Length": stat.size, "Cache-Control": "private, no-store" });
    fs.createReadStream(absolute).pipe(res);
  }
}
function ensureAdmin() {
  const email = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || "");
  if (!email || !password) {
    console.log("ADMIN_EMAIL / ADMIN_PASSWORD not set. First-run admin creation is disabled.");
    return;
  }
  if (store.users.some(u => u.role === "admin")) return;
  if (password.length < 12) throw new Error("ADMIN_PASSWORD must be at least 12 characters.");
  const p = hashPassword(password);
  store.users.push({ id: crypto.randomUUID(), name: "Admin", email, ...p, role: "admin", approved: true, createdAt: Date.now() });
  save();
  console.log("Initial admin account created.");
}
ensureAdmin();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const p = url.pathname;
  if (req.method === "GET" && (p === "/" || p.startsWith("/assets/"))) return staticFile(req, res, p);
  try {
    if (req.method === "POST" && p === "/api/register") {
      const b = await readBody(req);
      const name = safeText(b.name, 60), email = safeText(b.email, 120).toLowerCase(), password = String(b.password || "");
      if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 10) return fail(res, 400, "Enter a name, valid email and password of at least 10 characters.");
      if (store.users.some(u => u.email === email)) return fail(res, 409, "An account with this email already exists.");
      const pass = hashPassword(password);
      store.users.push({ id: crypto.randomUUID(), name, email, ...pass, role: "user", approved: false, createdAt: Date.now() });
      save();
      return send(res, 201, { message: "Account created. Wait for admin approval before logging in." });
    }
    if (req.method === "POST" && p === "/api/login") {
      const b = await readBody(req);
      const email = safeText(b.email, 120).toLowerCase();
      const user = store.users.find(u => u.email === email);
      if (!user || !verifyPassword(String(b.password || ""), user)) return fail(res, 401, "Email or password is incorrect.");
      if (!user.approved) return fail(res, 403, "Your account is waiting for admin approval.");
      const sid = token();
      store.sessions = store.sessions.filter(s => s.expires > Date.now() && s.userId !== user.id);
      store.sessions.push({ id: sid, userId: user.id, expires: Date.now() + SESSION_TTL });
      save();
      return send(res, 200, { user: { name: user.name, email: user.email, role: user.role } }, { "Set-Cookie": `cinema_session=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL / 1000}` });
    }
    if (req.method === "POST" && p === "/api/logout") {
      const sid = parseCookies(req).cinema_session;
      store.sessions = store.sessions.filter(s => s.id !== sid); save();
      return send(res, 200, { message: "Logged out." }, { "Set-Cookie": "cinema_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0" });
    }
    if (req.method === "GET" && p === "/api/me") {
      const user = currentUser(req);
      if (!user) return send(res, 200, { user: null });
      return send(res, 200, { user: { name: user.name, email: user.email, role: user.role, approved: user.approved } });
    }
    if (req.method === "GET" && p === "/api/library") {
      const user = requireApproved(req, res); if (!user) return;
      const items = walk(MEDIA_ROOT).map(({ id, name, type, size }) => ({ id, name, type, size }));
      return send(res, 200, { items });
    }
    if (req.method === "GET" && p.startsWith("/api/media/")) {
      const user = requireApproved(req, res); if (!user) return;
      const id = p.slice("/api/media/".length);
      const rel = Buffer.from(id, "base64url").toString("utf8");
      const item = walk(MEDIA_ROOT).find(x => x.id === id && x.path === rel);
      if (!item) return fail(res, 404, "Media not found.");
      return streamMedia(req, res, item);
    }
    if (req.method === "POST" && p === "/api/requests") {
      const user = requireApproved(req, res); if (!user) return;
      const b = await readBody(req), title = safeText(b.title, 120), details = safeText(b.details, 500);
      if (title.length < 2) return fail(res, 400, "Enter a title.");
      const request = { id: crypto.randomUUID(), userId: user.id, userName: user.name, title, details, status: "Pending", createdAt: Date.now() };
      store.requests.unshift(request); save();
      return send(res, 201, { request });
    }
    if (req.method === "GET" && p === "/api/requests") {
      const user = requireApproved(req, res); if (!user) return;
      const list = user.role === "admin" ? store.requests : store.requests.filter(r => r.userId === user.id);
      return send(res, 200, { requests: list });
    }
    if (req.method === "GET" && p === "/api/admin/users") {
      const user = requireApproved(req, res); if (!user || user.role !== "admin") return fail(res, 403, "Admin only.");
      return send(res, 200, { users: store.users.map(u => ({ id:u.id, name:u.name, email:u.email, role:u.role, approved:u.approved, createdAt:u.createdAt })) });
    }
    if (req.method === "POST" && p === "/api/admin/users") {
      const user = requireApproved(req, res); if (!user || user.role !== "admin") return fail(res, 403, "Admin only.");
      const b = await readBody(req), target = store.users.find(u => u.id === b.id);
      if (!target) return fail(res, 404, "User not found.");
      if (target.role !== "admin") target.approved = Boolean(b.approved);
      save(); return send(res, 200, { message: "User access updated." });
    }
    if (req.method === "POST" && p === "/api/admin/requests") {
      const user = requireApproved(req, res); if (!user || user.role !== "admin") return fail(res, 403, "Admin only.");
      const b = await readBody(req), target = store.requests.find(r => r.id === b.id);
      if (!target) return fail(res, 404, "Request not found.");
      if (!["Pending", "Approved", "Added", "Rejected"].includes(b.status)) return fail(res, 400, "Invalid status.");
      target.status = b.status; save(); return send(res, 200, { message: "Request status updated." });
    }
    return fail(res, 404, "Not found.");
  } catch (err) {
    console.error(err);
    return fail(res, 400, err.message || "Request failed.");
  }
});
server.listen(PORT, "0.0.0.0", () => {
  console.log(`CINEMA HUB running at http://localhost:${PORT}`);
  console.log(`Media folder: ${MEDIA_ROOT}`);
});
