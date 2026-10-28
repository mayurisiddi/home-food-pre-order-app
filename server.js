require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { randomUUID } = require("crypto");

const app = express();
const PORT = Number(process.env.PORT) || 3000;

const allowedOrigins = new Set(
  [process.env.FRONTEND_ORIGIN || "http://127.0.0.1:5500", "http://localhost:5500", "http://127.0.0.1:5500", "http://localhost:3000"]
    .concat((process.env.EXTRA_FRONTEND_ORIGINS || "").split(","))
    .map(origin => origin.trim()).filter(Boolean)
);

app.disable("x-powered-by");
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error("This origin is not allowed by the API CORS configuration."));
  },
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type"]
}));
app.use(express.json({ limit: "20kb" }));

let supabase;
try {
  ({ supabase } = require("./supabase"));
} catch (error) {
  console.error(`Configuration error: ${error.message}`);
  process.exitCode = 1;
}

const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const sendDbError = (res, error, context = "Database request failed") => {
  console.error(`${context}:`, error?.message || error);
  return res.status(500).json({ error: context + ". Check the backend logs and Supabase setup." });
};
const isUuid = value => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const validText = (value, max) => typeof value === "string" && value.trim().length > 0 && value.trim().length <= max;
const validPhone = value => typeof value === "string" && /^[0-9+\-()\s]{7,20}$/.test(value.trim());
const allowedStatuses = new Set(["pending", "confirmed", "preparing", "ready", "completed", "cancelled"]);
const orderSelect = "id, meal_id, customer_name, customer_phone, pickup_time, notes, quantity, total_price, status, created_at, meals(name, emoji)";

app.get("/api/health", (req, res) => res.json({ status: "ok", service: "HomeBite API", databaseConfigured: Boolean(supabase) }));

app.get("/api/meals", asyncRoute(async (req, res) => {
  if (!supabase) return res.status(503).json({ error: "Database is not configured." });
  const { category, search, available } = req.query;
  let query = supabase.from("meals").select("id,name,description,price,category,cook_name,prep_minutes,emoji,card_color,available,created_at").order("created_at", { ascending: true });
  if (category && category !== "all") {
    if (!["thali", "rice", "snacks", "breakfast", "curry"].includes(category)) return res.status(400).json({ error: "Invalid category filter." });
    query = query.eq("category", category);
  }
  if (typeof search === "string" && search.trim()) {
    const safeSearch = search.trim().slice(0, 60).replace(/[,%()]/g, " ");
    query = query.or(`name.ilike.%${safeSearch}%,description.ilike.%${safeSearch}%,cook_name.ilike.%${safeSearch}%`);
  }
  if (available === "true") query = query.eq("available", true);
  const { data, error } = await query;
  if (error) return sendDbError(res, error, "Could not load meals");
  res.json({ data });
}));

app.get("/api/meals/:id", asyncRoute(async (req, res) => {
  if (!supabase) return res.status(503).json({ error: "Database is not configured." });
  if (!isUuid(req.params.id)) return res.status(400).json({ error: "Meal ID must be a valid UUID." });
  const { data, error } = await supabase.from("meals").select("*").eq("id", req.params.id).maybeSingle();
  if (error) return sendDbError(res, error, "Could not load meal");
  if (!data) return res.status(404).json({ error: "Meal not found." });
  res.json({ data });
}));

app.post("/api/meals", asyncRoute(async (req, res) => {
  if (!supabase) return res.status(503).json({ error: "Database is not configured." });
  const { name, description, price, category, cook_name, prep_minutes, emoji, card_color, available } = req.body || {};
  if (!validText(name, 100) || !validText(description, 500) || !Number.isFinite(price) || price <= 0 || price > 100000 ||
      !["thali", "rice", "snacks", "breakfast", "curry"].includes(category) || !validText(cook_name, 100) ||
      !Number.isInteger(prep_minutes) || prep_minutes < 1 || prep_minutes > 600 ||
      (emoji !== undefined && !validText(emoji, 12)) || (card_color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(card_color)) ||
      (available !== undefined && typeof available !== "boolean")) {
    return res.status(400).json({ error: "Invalid meal fields. Check name, description, price, category, cook, and preparation time." });
  }
  const payload = { name:name.trim(), description:description.trim(), price, category, cook_name:cook_name.trim(), prep_minutes, emoji:emoji || "🍲", card_color:card_color || "#f3eadc", available:available ?? true };
  const { data, error } = await supabase.from("meals").insert(payload).select().single();
  if (error) return sendDbError(res, error, "Could not create meal");
  res.status(201).json({ data });
}));

app.patch("/api/meals/:id", asyncRoute(async (req, res) => {
  if (!supabase) return res.status(503).json({ error: "Database is not configured." });
  if (!isUuid(req.params.id)) return res.status(400).json({ error: "Meal ID must be a valid UUID." });
  const allowed = ["name", "description", "price", "category", "cook_name", "prep_minutes", "emoji", "card_color", "available"];
  const body = req.body || {};
  const keys = Object.keys(body);
  if (!keys.length || keys.some(key => !allowed.includes(key))) return res.status(400).json({ error: "Provide one or more valid meal fields to update." });
  const current = await supabase.from("meals").select("*").eq("id", req.params.id).maybeSingle();
  if (current.error) return sendDbError(res, current.error, "Could not check meal");
  if (!current.data) return res.status(404).json({ error: "Meal not found." });
  const merged = { ...current.data, ...body };
  if (!validText(merged.name,100) || !validText(merged.description,500) || !Number.isFinite(merged.price) || merged.price <= 0 || merged.price > 100000 ||
      !["thali","rice","snacks","breakfast","curry"].includes(merged.category) || !validText(merged.cook_name,100) ||
      !Number.isInteger(merged.prep_minutes) || merged.prep_minutes < 1 || merged.prep_minutes > 600 ||
      !validText(merged.emoji,12) || !/^#[0-9a-fA-F]{6}$/.test(merged.card_color) || typeof merged.available !== "boolean") {
    return res.status(400).json({ error: "The updated meal would contain invalid fields." });
  }
  const patch = Object.fromEntries(keys.map(key => [key, merged[key]]));
  const { data, error } = await supabase.from("meals").update(patch).eq("id", req.params.id).select().maybeSingle();
  if (error) return sendDbError(res, error, "Could not update meal");
  if (!data) return res.status(404).json({ error: "Meal not found." });
  res.json({ data });
}));

app.delete("/api/meals/:id", asyncRoute(async (req, res) => {
  if (!supabase) return res.status(503).json({ error: "Database is not configured." });
  if (!isUuid(req.params.id)) return res.status(400).json({ error: "Meal ID must be a valid UUID." });
  const { data, error } = await supabase.from("meals").delete().eq("id", req.params.id).select("id").maybeSingle();
  if (error) return sendDbError(res, error, "Could not delete meal");
  if (!data) return res.status(404).json({ error: "Meal not found." });
  res.json({ data: { id: data.id, deleted: true } });
}));

app.get("/api/orders", asyncRoute(async (req, res) => {
  if (!supabase) return res.status(503).json({ error: "Database is not configured." });
  const { status } = req.query;
  if (status && !allowedStatuses.has(status)) return res.status(400).json({ error: "Invalid order status filter." });
  let query = supabase.from("orders").select(orderSelect).order("created_at", { ascending: false }).limit(100);
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) return sendDbError(res, error, "Could not load orders");
  res.json({ data: data.map(order => ({ ...order, meal_name: order.meals?.name || "Meal unavailable", meal_emoji: order.meals?.emoji || "🍲", meals: undefined })) });
}));

app.post("/api/orders", asyncRoute(async (req, res) => {
  if (!supabase) return res.status(503).json({ error: "Database is not configured." });
  const { meal_id, customer_name, customer_phone, pickup_time, notes } = req.body || {};
  if (!isUuid(meal_id) || !validText(customer_name,80) || !validPhone(customer_phone) ||
      typeof pickup_time !== "string" || !Number.isFinite(Date.parse(pickup_time)) ||
      Date.parse(pickup_time) < Date.now() + 60 * 60 * 1000 ||
      (notes !== undefined && notes !== null && (typeof notes !== "string" || notes.length > 300))) {
    return res.status(400).json({ error: "Invalid order details. Enter your name, valid phone number, meal, pickup time at least one hour ahead, and notes under 300 characters." });
  }
  const { data: meal, error: mealError } = await supabase.from("meals").select("id,price,available").eq("id", meal_id).maybeSingle();
  if (mealError) return sendDbError(res, mealError, "Could not check meal availability");
  if (!meal) return res.status(404).json({ error: "That meal was not found." });
  if (!meal.available) return res.status(409).json({ error: "That meal is currently unavailable." });
  const payload = {
    id: randomUUID(), meal_id, customer_name: customer_name.trim(), customer_phone: customer_phone.trim(),
    pickup_time: new Date(pickup_time).toISOString(), notes: notes?.trim() || null, quantity: 1, total_price: meal.price, status: "pending"
  };
  const { data, error } = await supabase.from("orders").insert(payload).select(orderSelect).single();
  if (error) return sendDbError(res, error, "Could not create order");
  res.status(201).json({ data: { ...data, meal_name: data.meals?.name || "Meal", meal_emoji: data.meals?.emoji || "🍲", meals: undefined } });
}));

app.patch("/api/orders/:id", asyncRoute(async (req, res) => {
  if (!supabase) return res.status(503).json({ error: "Database is not configured." });
  if (!isUuid(req.params.id)) return res.status(400).json({ error: "Order ID must be a valid UUID." });
  const { status } = req.body || {};
  if (status !== "cancelled") return res.status(400).json({ error: "For this public demo, customers may only cancel pending orders." });
  const { data, error } = await supabase.from("orders").update({ status:"cancelled" }).eq("id", req.params.id).eq("status", "pending").select("id,status").maybeSingle();
  if (error) return sendDbError(res, error, "Could not cancel order");
  if (!data) return res.status(404).json({ error: "Pending order not found. It may already be cancelled or updated." });
  res.json({ data });
}));

app.delete("/api/orders/:id", asyncRoute(async (req, res) => {
  if (!supabase) return res.status(503).json({ error: "Database is not configured." });
  if (!isUuid(req.params.id)) return res.status(400).json({ error: "Order ID must be a valid UUID." });
  const { data, error } = await supabase.from("orders").delete().eq("id", req.params.id).eq("status", "cancelled").select("id").maybeSingle();
  if (error) return sendDbError(res, error, "Could not delete order");
  if (!data) return res.status(404).json({ error: "Cancelled order not found." });
  res.json({ data: { id:data.id, deleted:true } });
}));

app.use((req, res) => res.status(404).json({ error: "Route not found." }));
app.use((error, req, res, next) => {
  console.error("Unhandled API error:", error?.message || error);
  if (res.headersSent) return next(error);
  const status = error?.type === "entity.parse.failed" ? 400 : 500;
  res.status(status).json({ error: status === 400 ? "Request body must be valid JSON." : (error.message || "Unexpected server error.") });
});

if (require.main === module) {
  if (process.env.NODE_ENV !== "test") {
    const server = app.listen(PORT, () => console.log(`HomeBite API listening on http://localhost:${PORT}`));
    server.on("error", error => { console.error("Server failed to start:", error.message); process.exitCode = 1; });
  }
}
module.exports = app;
