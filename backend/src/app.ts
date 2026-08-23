import "dotenv/config";
import fs from "fs";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import multer from "multer";
import path from "path";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { randomInt, randomUUID } from "crypto";
import {
  campuses,
  crews,
  issues,
  users,
  reports,
  passwordResetTokens,
  analyzeImage,
  chooseCrew,
  haversine,
  estimateCampusResponseMinutes,
  getAdminPosition,
  getWasteIntervention,
  wasteCategories,
  saveIssue,
  saveReport,
  updateIssue,
  log,
} from "./services";
import { Issue, Status, User } from "./types";
import { write } from "./store";

export const app = express();
app.use(cors());
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(express.json());
app.use(morgan("dev"));
app.use(
  "/api/auth",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);

const uploadDirectory = path.resolve(__dirname, "..", "uploads");
fs.mkdirSync(uploadDirectory, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, uploadDirectory),
    filename: (_req, file, callback) => {
      const extension = path.extname(file.originalname).toLowerCase() || ".jpg";
      callback(null, `${randomUUID()}${extension}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (!file.mimetype.startsWith("image/"))
      return callback(new Error("Only image files can be uploaded"));
    callback(null, true);
  },
});
const jwtSecret = () => process.env.JWT_SECRET || "change-me";

app.get("/uploads/:filename", (req, res) => {
  const filePath = path.resolve(uploadDirectory, path.basename(req.params.filename));
  if (!filePath.startsWith(`${uploadDirectory}${path.sep}`))
    return res.status(404).json({ message: "Image not found" });
  if (!fs.existsSync(filePath)) return res.status(404).json({ message: "Image not found" });
  // Older uploads have no extension; they were captured by the image picker as JPEGs.
  res.type(path.extname(filePath) || ".jpg");
  res.sendFile(filePath);
});

function getToken(req: any) {
  return String(req.headers.authorization || "")
    .replace("Bearer ", "")
    .trim();
}

function verifyRequest(req: any) {
  return jwt.verify(getToken(req) || "missing-token", jwtSecret()) as {
    role?: string;
    userId?: string;
    username?: string;
  };
}

const adminAuth = (req: any, res: any, next: any) => {
  try {
    const payload = verifyRequest(req);
    if (payload.role !== "admin")
      return res.status(403).json({ message: "Administrator access required" });
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ message: "Administrator authentication required" });
  }
};

const userAuth = (req: any, res: any, next: any) => {
  try {
    const payload = verifyRequest(req);
    if (payload.role !== "user" || !payload.userId)
      return res.status(403).json({ message: "User account access required" });
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ message: "Please sign in to your user account" });
  }
};

function publicUser(user: User) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    createdAt: user.createdAt,
  };
}

app.get("/api/health", (_, res) =>
  res.json({ ok: true, service: "swachhlens" }),
);
app.get("/api/campuses", (_, res) => res.json(campuses()));
app.get("/api/issues", (_, res) =>
  res.json(issues().filter((issue) => issue.status !== "resolved")),
);
app.get("/api/issues/:id", (req, res) => {
  const issue = issues().find(
    (item) => item.id === req.params.id || item.referenceId === req.params.id,
  );
  issue
    ? res.json(issue)
    : res.status(404).json({ message: "Issue not found" });
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const body = z
      .object({
        name: z.string().trim().min(2).max(80),
        email: z.string().trim().email().max(160),
        phone: z
          .string()
          .trim()
          .regex(/^[+\d ()-]{7,20}$/, "Enter a valid phone number"),
        password: z.string().min(6).max(100),
      })
      .parse(req.body);
    const email = body.email.toLowerCase();
    const phone = body.phone.replace(/[ ()-]/g, "");
    if (
      users().some(
        (user) =>
          user.email.toLowerCase() === email ||
          user.phone.replace(/[ ()-]/g, "") === phone,
      )
    ) {
      return res
        .status(409)
        .json({
          message: "An account with this email or phone already exists",
        });
    }
    const now = new Date().toISOString();
    const user: User = {
      id: randomUUID(),
      name: body.name,
      email,
      phone,
      passwordHash: await bcrypt.hash(body.password, 10),
      createdAt: now,
      updatedAt: now,
    };
    const allUsers = users();
    allUsers.unshift(user);
    write("users.json", allUsers);
    const token = jwt.sign(
      { role: "user", userId: user.id, email: user.email },
      jwtSecret(),
      { expiresIn: "30d" },
    );
    res.status(201).json({ token, user: publicUser(user) });
  } catch (error: any) {
    res
      .status(400)
      .json({ message: error?.message || "Could not create account" });
  }
});

app.post("/api/auth/user-login", async (req, res) => {
  const identifier = String(req.body?.identifier || "")
    .trim()
    .toLowerCase();
  const normalizedIdentifier = identifier.replace(/[ ()-]/g, "");
  const password = String(req.body?.password || "");
  const user = users().find(
    (item) =>
      item.email.toLowerCase() === identifier ||
      item.phone.replace(/[ ()-]/g, "").toLowerCase() === normalizedIdentifier,
  );
  if (!user || !(await bcrypt.compare(password, user.passwordHash)))
    return res.status(401).json({ message: "Invalid email/phone or password" });
  const token = jwt.sign(
    { role: "user", userId: user.id, email: user.email },
    jwtSecret(),
    { expiresIn: "30d" },
  );
  res.json({ token, user: publicUser(user) });
});

app.post("/api/auth/forgot-password", async (req, res) => {
  const identifier = String(req.body?.identifier || "").trim();
  if (identifier.length < 3)
    return res.status(400).json({ message: "Enter your email or phone number" });

  const normalized = identifier.toLowerCase();
  const normalizedPhone = normalized.replace(/[ ()-]/g, "");
  const user = users().find(
    (item) =>
      item.email.toLowerCase() === normalized ||
      item.phone.replace(/[ ()-]/g, "") === normalizedPhone,
  );
  const message =
    "If an account matches, a verification code has been created. The code expires in 15 minutes.";

  // This project has no external email/SMS provider. Development returns a demo code;
  // production deployments should deliver this code through their approved provider.
  if (!user) return res.json({ message });

  const code = String(randomInt(100000, 1000000));
  const createdAt = new Date();
  const resetToken = {
    id: randomUUID(),
    userId: user.id,
    codeHash: await bcrypt.hash(code, 10),
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + 15 * 60 * 1000).toISOString(),
  };
  const activeTokens = passwordResetTokens().filter(
    (item) => !item.usedAt && new Date(item.expiresAt).getTime() > Date.now(),
  );
  activeTokens.unshift(resetToken);
  write("passwordResetTokens.json", activeTokens);

  res.json({
    message,
    ...(process.env.NODE_ENV !== "production" ? { demoCode: code } : {}),
  });
});

app.post("/api/auth/reset-password", async (req, res) => {
  try {
    const body = z
      .object({
        identifier: z.string().trim().min(3),
        code: z.string().regex(/^\d{6}$/, "Enter the 6-digit verification code"),
        newPassword: z.string().min(6).max(100),
      })
      .parse(req.body);
    const normalized = body.identifier.toLowerCase();
    const normalizedPhone = normalized.replace(/[ ()-]/g, "");
    const allUsers = users();
    const user = allUsers.find(
      (item) =>
        item.email.toLowerCase() === normalized ||
        item.phone.replace(/[ ()-]/g, "") === normalizedPhone,
    );
    const token = user
      ? passwordResetTokens()
          .filter(
            (item) =>
              item.userId === user.id &&
              !item.usedAt &&
              new Date(item.expiresAt).getTime() > Date.now(),
          )
          .sort(
            (a, b) =>
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          )[0]
      : undefined;
    if (!user || !token || !(await bcrypt.compare(body.code, token.codeHash)))
      return res.status(400).json({ message: "Invalid or expired verification code" });

    const now = new Date().toISOString();
    user.passwordHash = await bcrypt.hash(body.newPassword, 10);
    user.updatedAt = now;
    write("users.json", allUsers);
    write(
      "passwordResetTokens.json",
      passwordResetTokens().map((item) =>
        item.id === token.id ? { ...item, usedAt: now } : item,
      ),
    );
    res.json({ message: "Password updated. You can now sign in." });
  } catch (error: any) {
    res.status(400).json({ message: error?.message || "Could not reset password" });
  }
});

app.get("/api/user/me", userAuth, (req: any, res) => {
  const user = users().find((item) => item.id === req.user.userId);
  user
    ? res.json(publicUser(user))
    : res.status(404).json({ message: "User account not found" });
});

app.get("/api/user/issues", userAuth, (req: any, res) => {
  const userReportIssueIds = new Set(
    reports()
      .filter((report) => report.userId === req.user.userId)
      .map((report) => report.issueId),
  );
  res.json(issues().filter((issue) => userReportIssueIds.has(issue.id)));
});

app.post(
  "/api/issues",
  userAuth,
  upload.single("photo"),
  async (req: any, res) => {
    try {
      const body = z
        .object({
          campusId: z.string().regex(/^C(0[1-9]|[12]\d|30)$/),
          latitude: z.coerce.number().min(-90).max(90),
          longitude: z.coerce.number().min(-180).max(180),
          description: z.string().max(500).optional(),
        })
        .parse(req.body);
      const campus = campuses().find((item) => item.id === body.campusId);
      if (!campus)
        return res.status(400).json({ message: "Invalid KIIT campus" });

      const ai = await analyzeImage(req.file?.path, body.description);
      const now = new Date().toISOString();
      const reportId = randomUUID();
      const imageUrl = req.file
        ? `/uploads/${path.basename(req.file.path)}`
        : undefined;

      // One active operational issue is kept per campus. Every user submission is still saved as a report.
      const existing = issues().find(
        (item) => item.status !== "resolved" && item.campusId === body.campusId,
      );
      if (existing) {
        existing.reportCount += 1;
        existing.sourceReportIds.push(reportId);
        existing.severity = Math.max(existing.severity, Number(ai.severity));
        existing.priority = Math.max(
          existing.priority,
          Math.min(100, Number(ai.severity) + 10),
        );
        existing.updatedAt = now;
        updateIssue(existing);
        saveReport({
          id: reportId,
          issueId: existing.id,
          userId: req.user.userId,
          campusId: body.campusId,
          latitude: body.latitude,
          longitude: body.longitude,
          description: body.description,
          imageUrl,
          category: ai.category,
          createdAt: now,
          duplicateOfIssueId: existing.id,
        });
        return res
          .status(201)
          .json({
            ...existing,
            duplicateOf: existing.id,
            duplicateMessage:
              "Your report was linked to the existing active issue for this campus.",
            latestReportAt: now,
          });
      }

      const issueId = randomUUID();
      const responseEstimate = estimateCampusResponseMinutes(
        campus,
        Number(ai.severity),
      );
      const issue: Issue = {
        id: issueId,
        referenceId: `SW-${Date.now().toString(36).toUpperCase()}`,
        ...body,
        imageUrl,
        category: ai.category,
        volumeClass: ai.volumeClass,
        confidence: Number(ai.confidence),
        imageProcessingScore: Number(ai.imageProcessingScore),
        severity: Number(ai.severity),
        priority: Math.min(100, Number(ai.severity) + 10),
        status: "analyzed",
        manualReviewRequired: Number(ai.confidence) < 0.6,
        reportCount: 1,
        sourceReportIds: [reportId],
        duplicateIssueIds: [],
        etaMinutes: responseEstimate.minutes,
        estimatedResponseMinutes: responseEstimate.minutes,
        distanceToAdminKm: responseEstimate.distanceKm,
        createdAt: now,
        updatedAt: now,
        aiExplanation: ai.aiExplanation,
        aiProvider: ai.aiProvider,
      };
      saveIssue(issue);
      saveReport({
        id: reportId,
        issueId,
        userId: req.user.userId,
        campusId: body.campusId,
        latitude: body.latitude,
        longitude: body.longitude,
        description: body.description,
        imageUrl,
        category: ai.category,
        createdAt: now,
      });
      res.status(201).json(issue);
    } catch (error: any) {
      res.status(400).json({ message: error?.message || "Invalid report" });
    }
  },
);

app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body || {};
  const expectedUser = process.env.ADMIN_USERNAME || "admin";
  const expectedPassword = process.env.ADMIN_PASSWORD || "admin123";
  const passwordHash = process.env.ADMIN_PASSWORD_HASH;
  const validPassword = passwordHash
    ? await bcrypt.compare(String(password || ""), passwordHash)
    : String(password || "") === expectedPassword;
  if (String(username || "").trim() !== expectedUser || !validPassword)
    return res
      .status(401)
      .json({ message: "Invalid administrator credentials" });
  res.json({
    token: jwt.sign({ role: "admin", username: expectedUser }, jwtSecret(), {
      expiresIn: "8h",
    }),
  });
});

app.get("/api/admin/dashboard", adminAuth, (_, res) => {
  const all = issues();
  const active = all.filter((issue) => issue.status !== "resolved");
  const adminBase = getAdminPosition();
  res.json({
    kpis: {
      active: active.length,
      severe: active.filter((issue) => issue.severity >= 75).length,
      resolved: all.filter((issue) => issue.status === "resolved").length,
      duplicates: all.filter((issue) => issue.reportCount > 1).length,
      users: users().length,
      reports: reports().length,
    },
    issues: all.map((issue) => {
      const intervention = getWasteIntervention(issue.category, issue.volumeClass);
      const matchingCrews = crews().filter((crew) => crew.status === "available" &&
        crew.specialties?.some((specialty) => intervention.crewTypes.includes(specialty)));
      return { ...issue, intervention, recommendedCrewTypes: intervention.crewTypes, matchingCrews };
    }),
    wasteCategories: wasteCategories.map((category) => ({
      ...category,
      ...getWasteIntervention(category.id, "medium"),
    })),
    crews: crews(),
    adminPosition: adminBase,
    campuses: campuses().map((campus) => {
      const estimate = estimateCampusResponseMinutes(campus);
      return {
        ...campus,
        activeIssues: active.filter((issue) => issue.campusId === campus.id)
          .length,
        distanceToAdminKm: estimate.distanceKm,
        estimatedResponseMinutes: estimate.minutes,
      };
    }),
  });
});

app.post("/api/admin/issues/:id/assign", adminAuth, (req, res) => {
  const issue = issues().find((item) => item.id === req.params.id);
  if (!issue) return res.status(404).json({ message: "Issue not found" });
  const campus = campuses().find((item) => item.id === issue.campusId);
  const requestedCrew = req.body?.crewId ? crews().find((crew) => crew.id === String(req.body.crewId) && crew.status === "available") : undefined;
  const picked = requestedCrew ? {
    crew: requestedCrew,
    etaMinutes: Math.max(5, Math.round(haversine(issue.latitude, issue.longitude, requestedCrew.latitude, requestedCrew.longitude) / 250)),
    distanceKm: Number((haversine(issue.latitude, issue.longitude, requestedCrew.latitude, requestedCrew.longitude) / 1000).toFixed(2)),
  } : chooseCrew(issue.category, issue.severity, issue.volumeClass, campus?.latitude ?? issue.latitude, campus?.longitude ?? issue.longitude);
  if (!picked) return res.status(409).json({ message: "No crew available" });
  issue.crewId = picked.crew.id;
  issue.crewEtaMinutes = picked.etaMinutes;
  issue.distanceToCrewKm = picked.distanceKm;
  issue.etaMinutes = picked.etaMinutes;
  issue.status = "assigned";
  issue.updatedAt = new Date().toISOString();
  picked.crew.status = "assigned";
  write(
    "crews.json",
    crews().map((crew) => (crew.id === picked.crew.id ? picked.crew : crew)),
  );
  updateIssue(issue);
  log("crew_assigned", issue.id);
  res.json(issue);
});

app.delete("/api/admin/issues/:id", adminAuth, (req, res) => {
  const allIssues = issues();
  const issue = allIssues.find((item) => item.id === req.params.id);
  if (!issue) return res.status(404).json({ message: "Issue not found" });
  if (issue.status !== "resolved")
    return res
      .status(409)
      .json({ message: "Only resolved issues can be removed" });

  // Remove the canonical issue, its individual reports, and its stored image files.
  const issueReports = reports().filter((report) => report.issueId === issue.id);
  write(
    "issues.json",
    allIssues.filter((item) => item.id !== issue.id),
  );
  write(
    "reports.json",
    reports().filter((report) => report.issueId !== issue.id),
  );
  const imageUrls = [
    issue.imageUrl,
    ...issueReports.map((report) => report.imageUrl),
  ];
  for (const imageUrl of imageUrls) {
    if (!imageUrl) continue;
    const imagePath = path.resolve(uploadDirectory, path.basename(imageUrl));
    if (!imagePath.startsWith(`${uploadDirectory}${path.sep}`)) continue;
    try {
      fs.rmSync(imagePath, { force: true });
    } catch (error) {
      console.warn("Could not remove issue image:", error);
    }
  }
  log("issue_removed", issue.id);
  res.json({ ok: true, removedIssueId: issue.id });
});

app.patch("/api/admin/issues/:id/classification", adminAuth, (req, res) => {
  const issue = issues().find((item) => item.id === req.params.id);
  const category = String(req.body?.category || "");
  if (!issue) return res.status(404).json({ message: "Issue not found" });
  if (!wasteCategories.some((item) => item.id === category)) return res.status(400).json({ message: "Select a valid waste category" });
  issue.category = category;
  issue.updatedAt = new Date().toISOString();
  updateIssue(issue);
  log("issue_reclassified", issue.id);
  res.json({ ...issue, intervention: getWasteIntervention(issue.category, issue.volumeClass) });
});

app.patch("/api/admin/issues/:id/status", adminAuth, (req, res) => {
  const allowed: Record<string, Status[]> = {
    analyzed: ["assigned"],
    assigned: ["en_route"],
    en_route: ["on_site"],
    on_site: ["resolved"],
  };
  const issue = issues().find((item) => item.id === req.params.id);
  const next = req.body?.status as Status;
  if (!issue) return res.status(404).json({ message: "Issue not found" });
  if (!allowed[issue.status]?.includes(next))
    return res
      .status(400)
      .json({ message: `Invalid transition ${issue.status} -> ${next}` });
  issue.status = next;
  issue.updatedAt = new Date().toISOString();
  if (next === "resolved") issue.resolvedAt = issue.updatedAt;
  updateIssue(issue);
  if (issue.crewId && next === "resolved")
    write(
      "crews.json",
      crews().map((crew) =>
        crew.id === issue.crewId ? { ...crew, status: "available" } : crew,
      ),
    );
  log(`status_${next}`, issue.id);
  res.json(issue);
});

app.post("/api/admin/demo/reset", adminAuth, (_, res) => {
  write("issues.json", []);
  write("reports.json", []);
  res.json({ ok: true });
});
app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("SwachhLens request error:", error);
  if (error instanceof multer.MulterError) {
    return res.status(400).json({
      message:
        error.code === "LIMIT_FILE_SIZE"
          ? "Image is too large. Please choose an image under 10 MB."
          : `Upload failed: ${error.message}`,
    });
  }
  if (error?.message === "Only image files can be uploaded")
    return res.status(400).json({ message: error.message });
  res.status(500).json({ message: "The server could not process this request" });
});
app.use((_, res) => res.status(404).json({ message: "Not found" }));
