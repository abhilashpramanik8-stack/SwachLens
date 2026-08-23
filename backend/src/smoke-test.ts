import assert from "assert/strict";
import request from "supertest";
import { app } from "./app";

async function run() {
  const health = await request(app).get("/api/health");
  assert.equal(health.status, 200);
  assert.equal(health.body.ok, true);
  const campuses = await request(app).get("/api/campuses");
  assert.equal(campuses.status, 200);
  assert.equal(campuses.body.length, 30);
  const unauthorized = await request(app).get("/api/admin/dashboard");
  assert.equal(unauthorized.status, 401);
  const login = await request(app).post("/api/auth/login").send({ username: process.env.ADMIN_USERNAME || "admin", password: process.env.ADMIN_PASSWORD || "admin123" });
  assert.equal(login.status, 200);
  const dashboard = await request(app).get("/api/admin/dashboard").set("Authorization", `Bearer ${login.body.token}`);
  assert.equal(dashboard.status, 200);
  assert.ok(Array.isArray(dashboard.body.wasteCategories));
  console.log("API smoke checks passed");
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
