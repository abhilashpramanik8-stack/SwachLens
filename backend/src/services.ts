import axios from "axios";
import crypto from "crypto";
import path from "path";
import sharp from "sharp";
import {
  Issue,
  Campus,
  Crew,
  Volume,
  User,
  Report,
  PasswordResetToken,
} from "./types";
import { read, write } from "./store";
export const campuses = () => read<Campus>("campuses.json");
export const crews = () => read<Crew>("crews.json");
export const issues = () => read<Issue>("issues.json");
export const users = () => read<User>("users.json");
export const reports = () => read<Report>("reports.json");
export const passwordResetTokens = () =>
  read<PasswordResetToken>("passwordResetTokens.json");

export type Coordinates = { latitude: number; longitude: number };
export type AdminPosition = Coordinates & { campusId: string };

export const wasteCategories = [
  { id: "overflowing_dustbin", label: "Overflowing dustbin", group: "general" },
  { id: "illegal_garbage_dump", label: "Illegal garbage dump", group: "general" },
  { id: "misplaced_waste", label: "Misplaced waste", group: "general" },
  { id: "construction_debris", label: "Construction debris", group: "bulk" },
  { id: "plastic_near_drain", label: "Plastic waste near drains", group: "drainage" },
  { id: "recyclable_mixed_with_wet", label: "Recyclable mixed with wet waste", group: "recyclable" },
  { id: "organic_waste", label: "Organic waste", group: "organic" },
  { id: "e_waste", label: "E-waste", group: "special" },
  { id: "hazardous_waste", label: "Hazardous waste", group: "hazardous" },
  { id: "drain_blockage", label: "Drain blockage", group: "drainage" },
  { id: "glass_sharp_waste", label: "Glass or sharp waste", group: "special" },
  { id: "sanitary_bio_waste", label: "Sanitary or bio-waste", group: "hazardous" },
  { id: "street_litter", label: "Street litter", group: "general" },
  { id: "school_hospital_adjacent", label: "Waste near school or hospital", group: "sensitive_location" },
] as const;

export function getWasteIntervention(category: string, volume: Volume) {
  const rules: Record<string, { intervention: string; actions: string[]; crewTypes: string[]; escalate?: string }> = {
    overflowing_dustbin: { intervention: volume === "small" ? "Assign a manual cleanup team" : "Dispatch extra workers and a mini truck", actions: ["Empty and sanitize the dustbin", "Check collection frequency"], crewTypes: ["manual_cleanup", "bulk_collection"] },
    illegal_garbage_dump: { intervention: "Dispatch a bulk cleanup and enforcement inspection", actions: ["Remove the dump with a mini truck", "Flag repeat dumping"], crewTypes: ["bulk_collection", "enforcement_inspection"], escalate: "Escalate repeat dumping to municipal enforcement" },
    misplaced_waste: { intervention: "Assign a manual cleanup team", actions: ["Move waste to the correct collection point", "Check bins and signage"], crewTypes: ["manual_cleanup"] },
    construction_debris: { intervention: "Dispatch a debris-removal crew with a mini truck", actions: ["Use PPE and load debris separately", "Notify the site owner if identified"], crewTypes: ["construction_debris", "bulk_collection"] },
    plastic_near_drain: { intervention: "Send a drain-clearing crew with litter tools", actions: ["Remove plastic before it enters the drain", "Route plastic to recycling"], crewTypes: ["drain_clearing", "recycling_sorting"], escalate: "Escalate if water flow is restricted" },
    recyclable_mixed_with_wet: { intervention: "Route to recycling partners after source separation", actions: ["Separate dry recyclables from wet waste", "Send recyclables to the partner pickup"], crewTypes: ["recycling_sorting", "manual_cleanup"] },
    organic_waste: { intervention: "Assign an organic-waste collection crew", actions: ["Collect in sealed containers", "Route to composting or wet-waste facility"], crewTypes: ["organic_collection", "bulk_collection"] },
    e_waste: { intervention: "Assign an e-waste handling crew", actions: ["Isolate electronics", "Book an authorised e-waste recycler"], crewTypes: ["e_waste_handling"], escalate: "Escalate to an authorised e-waste partner" },
    hazardous_waste: { intervention: "Escalate and dispatch a hazardous-waste response crew", actions: ["Isolate the area and use PPE", "Use a licensed handler"], crewTypes: ["hazardous_response"], escalate: "Immediate escalation required" },
    drain_blockage: { intervention: "Dispatch a drain-clearing crew", actions: ["Clear blockage and restore water flow", "Record before/after condition"], crewTypes: ["drain_clearing", "bulk_collection"], escalate: "Escalate flooding or sewage overflow" },
    glass_sharp_waste: { intervention: "Assign a sharp-waste cleanup crew", actions: ["Use puncture-resistant tools and PPE", "Place sharps in a rigid container"], crewTypes: ["hazardous_response", "manual_cleanup"] },
    sanitary_bio_waste: { intervention: "Escalate to a bio-waste response crew", actions: ["Isolate and bag separately", "Use an authorised handler"], crewTypes: ["hazardous_response"], escalate: "Immediate escalation required" },
    street_litter: { intervention: "Assign a manual cleanup team", actions: ["Sweep and collect litter", "Check nearby bins and signage"], crewTypes: ["manual_cleanup"] },
    school_hospital_adjacent: { intervention: "Escalate for priority cleanup near a school or hospital", actions: ["Create a safety perimeter", "Dispatch before peak hours"], crewTypes: ["manual_cleanup", "hazardous_response"], escalate: "Priority escalation required" },
  };
  return rules[category] || rules.misplaced_waste;
}

const defaultAdminPosition: AdminPosition = {
  campusId: "C25",
  latitude: 20.364657,
  longitude: 85.816969,
};

export function getAdminPosition(): AdminPosition {
  // Keep the operations desk anchored to Campus 25 even when settings.json is recreated.
  const settings = read<any>("settings.json") as any;
  return settings?.adminPosition || defaultAdminPosition;
}
export function haversine(a: number, b: number, c: number, d: number) {
  const R = 6371000,
    p = Math.PI / 180,
    x = (c - a) * p,
    y = (d - b) * p;
  return (
    2 *
    R *
    Math.asin(
      Math.sqrt(
        Math.sin(x / 2) ** 2 +
          Math.cos(a * p) * Math.cos(c * p) * Math.sin(y / 2) ** 2,
      ),
    )
  );
}
export function hashFile(file?: string) {
  return file
    ? crypto.createHash("sha256").update(file).digest("hex").slice(0, 16)
    : undefined;
}
export function analyzeFallback(description = "", imageSignal = 0) {
  const text = description.toLowerCase();
  let category = "misplaced_waste",
    volume: Volume = "medium";
  if (/hazard|chemical|paint|battery|needle/.test(text)) category = "hazardous_waste";
  else if (/e-waste|electronic|computer|phone|charger/.test(text)) category = "e_waste";
  else if (/recycl|dry waste.*wet|wet.*dry waste/.test(text)) category = "recyclable_mixed_with_wet";
  else if (/organic|food waste|compost/.test(text)) category = "organic_waste";
  else if (/plastic.*drain|drain.*plastic/.test(text)) category = "plastic_near_drain";
  else if (/blockage|blocked drain|clogged drain/.test(text)) category = "drain_blockage";
  else if (/plastic|bottle|bag/.test(text)) category = "street_litter";
  if (/construction|debris|rubble/.test(text)) {
    category = "construction_debris";
    volume = "large";
  }
  if (/illegal dump|garbage dump/.test(text)) category = "illegal_garbage_dump";
  if (/overflow/.test(text)) category = "overflowing_dustbin";
  if (/drain|sewage/.test(text) && category === "misplaced_waste") category = "drain_blockage";
  if (/pile|dump|very large/.test(text)) volume = /very large/.test(text) ? "very_large" : "large";
  const baseScore: number =
    volume === "large"
      ? 72
      : volume === "medium"
        ? 48
        : volume === "very_large"
          ? 90
          : 25;
  const score = Math.max(10, Math.min(95, baseScore + Math.round(imageSignal)));
  return {
    category,
    volumeClass: volume,
    confidence: 0.72,
    imageProcessingScore: score,
    severity: score,
    aiExplanation:
      "Fallback image estimate used because the vision API was unavailable; admin review is recommended.",
  };
}
async function analyzeFallbackForImage(file: string | undefined, description = "") {
  if (!file) return analyzeFallback(description);
  try {
    const stats = await sharp(file).resize(96, 96, { fit: "inside" }).stats();
    const deviation = stats.channels.reduce((sum, channel) => sum + channel.stdev, 0) / Math.max(1, stats.channels.length);
    return analyzeFallback(description, Math.max(-16, Math.min(16, (deviation - 38) / 2)));
  } catch { return analyzeFallback(description); }
}
export function estimateCampusResponseMinutes(
  campus: Campus,
  severity = 50,
) {
  const admin = getAdminPosition();
  const distanceKm =
    haversine(admin.latitude, admin.longitude, campus.latitude, campus.longitude) /
    1000;
  // The estimate is intentionally transparent: travel at 20 km/h plus a small triage buffer.
  const triageMinutes = severity >= 75 ? 10 : severity >= 50 ? 7 : 5;
  const minutes = Math.max(5, Math.ceil((distanceKm / 20) * 60 + triageMinutes));
  return { distanceKm: Number(distanceKm.toFixed(2)), minutes };
}
const visionPrompt = `Analyze sanitation/waste severity. Return JSON only with category (one of ${wasteCategories.map((item) => item.id).join(", ")}), volumeClass (small|medium|large|very_large), confidence (0..1), imageProcessingScore (0..100), severity (0..100), and explanation.`;
async function analyzeWithVisionProvider(key: string, baseUrl: string, model: string, file: string, description: string) {
  const b = require("fs").readFileSync(file).toString("base64");
  const response = await axios.post(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    model, temperature: 0.1, max_tokens: 300,
    messages: [{ role: "user", content: [
      { type: "text", text: `${visionPrompt}${description ? ` User description: ${description}` : ""}` },
      { type: "image_url", image_url: { url: `data:image/jpeg;base64,${b}` } },
    ] }],
  }, { headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, timeout: 45000 });
  const content = response.data.choices?.[0]?.message?.content;
  const raw = Array.isArray(content) ? content.map((part: any) => part?.text || "").join("") : String(content || "");
  return JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || "{}");
}
function normalizeVisionResult(parsed: any, fallback: any, provider: string) {
  const category = wasteCategories.some((item) => item.id === parsed.category) ? parsed.category : fallback.category;
  const volumeClass = ["small", "medium", "large", "very_large"].includes(parsed.volumeClass) ? parsed.volumeClass : fallback.volumeClass;
  const severity = Math.max(0, Math.min(100, Number(parsed.severity ?? parsed.imageProcessingScore)));
  const imageProcessingScore = Math.max(0, Math.min(100, Number(parsed.imageProcessingScore ?? parsed.severity)));
  return { ...fallback, ...parsed, category, volumeClass,
    confidence: Number.isFinite(Number(parsed.confidence)) ? Math.max(0, Math.min(1, Number(parsed.confidence))) : fallback.confidence,
    severity: Number.isFinite(severity) ? severity : fallback.severity,
    imageProcessingScore: Number.isFinite(imageProcessingScore) ? imageProcessingScore : fallback.imageProcessingScore,
    aiExplanation: String(parsed.explanation || parsed.aiExplanation || fallback.aiExplanation),
    manualReviewRequired: Number(parsed.confidence || 0) < 0.6, aiProvider: provider };
}
export async function analyzeImage(file?: string, description = "") {
  const fallback = await analyzeFallbackForImage(file, description);
  if (!file) return fallback;
  const nvidia = process.env.NVIDIA_API_KEY ? { key: process.env.NVIDIA_API_KEY, baseUrl: process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1", model: process.env.NVIDIA_VISION_MODEL || "meta/llama-3.2-11b-vision-instruct", name: "NVIDIA" } : undefined;
  if (nvidia) {
    try {
      const result = normalizeVisionResult(await analyzeWithVisionProvider(nvidia.key, nvidia.baseUrl, nvidia.model, file, description), fallback, nvidia.name);
      console.info("Vision analysis completed with NVIDIA");
      return result;
    } catch (error: any) { console.warn("NVIDIA vision analysis failed:", error?.response?.status || error?.message || "unknown error"); }
  }
  return { ...fallback, manualReviewRequired: true, aiProvider: "local-fallback" };
}
export function chooseCrew(
  category: string,
  score: number,
  volume: Volume,
  lat: number,
  lng: number,
) {
  const list = crews()
    .filter((c) => c.status === "available")
    .sort(
      (a, b) =>
        haversine(lat, lng, a.latitude, a.longitude) -
        haversine(lat, lng, b.latitude, b.longitude),
    );
  const playbook = getWasteIntervention(category, volume);
  const specialtyMatch = list.find((c) =>
    c.specialties?.some((specialty) => playbook.crewTypes.includes(specialty)),
  );
  const preferred = specialtyMatch ||
    (score >= 75 || volume === "large" || volume === "very_large"
      ? list.find((c) => c.capability === "large")
      : list.find((c) => c.capability === volume)) || list[0];
  if (!preferred) return undefined;
  const eta = Math.max(
    5,
    Math.round(
      haversine(lat, lng, preferred.latitude, preferred.longitude) / 250,
    ),
  );
  return {
    crew: preferred,
    etaMinutes: eta,
    distanceKm: Number(
      (haversine(lat, lng, preferred.latitude, preferred.longitude) / 1000).toFixed(
        2,
      ),
    ),
  };
}
export function saveIssue(i: Issue) {
  const all = issues();
  all.unshift(i);
  write("issues.json", all);
  return i;
}
export function updateIssue(i: Issue) {
  write(
    "issues.json",
    issues().map((x) => (x.id === i.id ? i : x)),
  );
  return i;
}
export function saveReport(report: Report) {
  const all = reports();
  all.unshift(report);
  write("reports.json", all);
  return report;
}
export function log(action: string, issueId: string, actor = "admin") {
  const logs = read<any>("auditLogs.json");
  logs.unshift({
    id: crypto.randomUUID(),
    action,
    issueId,
    actor,
    createdAt: new Date().toISOString(),
  });
  write("auditLogs.json", logs);
}
