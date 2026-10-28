/* HomeBite frontend. The API is served by the Express backend. */
const API_BASE = window.HOMEBITE_API_BASE || "http://localhost:3000/api";
const state = { meals: [], orders: [], selectedMeal: null };
const $ = (selector) => document.querySelector(selector);
const mealGrid = $("#mealGrid");
const menuCount = $("#menuCount");
const menuNotice = $("#menuNotice");
const ordersList = $("#ordersList");
const ordersNotice = $("#ordersNotice");
const orderDialog = $("#orderDialog");
const orderForm = $("#orderForm");
const submitOrder = $("#submitOrder");
let toastTimer;

document.addEventListener("DOMContentLoaded", () => {
  $("#year").textContent = new Date().getFullYear();
  $("#menuToggle").addEventListener("click", toggleNav);
  document.querySelectorAll("#navLinks a").forEach(link => link.addEventListener("click", closeNav));
  $("#searchInput").addEventListener("input", renderMeals);
  $("#categoryFilter").addEventListener("change", renderMeals);
  $("#sortFilter").addEventListener("change", renderMeals);
  $("#refreshOrders").addEventListener("click", loadOrders);
  $("#closeDialog").addEventListener("click", closeOrderDialog);
  orderDialog.addEventListener("click", event => { if (event.target === orderDialog) closeOrderDialog(); });
  orderForm.addEventListener("submit", submitPreorder);
  loadMeals();
  loadOrders();
});

function toggleNav() {
  const links = $("#navLinks");
  const isOpen = links.classList.toggle("open");
  $("#menuToggle").setAttribute("aria-expanded", String(isOpen));
  $("#menuToggle").textContent = isOpen ? "×" : "☰";
}
function closeNav() {
  $("#navLinks").classList.remove("open");
  $("#menuToggle").setAttribute("aria-expanded", "false");
  $("#menuToggle").textContent = "☰";
}
function setNotice(element, message, visible = true) {
  element.textContent = message;
  element.hidden = !visible;
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[ch]));
}
function money(value) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);
}
async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}
async function loadMeals() {
  mealGrid.innerHTML = '<div class="loading-state"><span class="spinner"></span> Bringing the menu to your table…</div>';
  setNotice(menuNotice, "", false);
  try {
    const result = await api("/meals");
    state.meals = result.data || [];
    renderMeals();
  } catch (error) {
    menuCount.textContent = "Menu unavailable";
    mealGrid.innerHTML = `<div class="empty-state"><span class="empty-icon">🍲</span><strong>We couldn't load the menu.</strong><span>${escapeHtml(error.message)}. Check that the backend and Supabase are configured.</span><button class="button button-outline" id="retryMeals">Try again</button></div>`;
    $("#retryMeals").addEventListener("click", loadMeals);
    setNotice(menuNotice, "The menu comes from your Supabase database. No sample meals are substituted when the API is unavailable.");
  }
}
const categoryLabels = { thali:"Thali", rice:"Rice bowls", snacks:"Snacks", breakfast:"Breakfast", curry:"Curries" };
function renderMeals() {
  const search = $("#searchInput").value.trim().toLowerCase();
  const category = $("#categoryFilter").value;
  const sort = $("#sortFilter").value;
  let meals = state.meals.filter(meal => (category === "all" || meal.category === category) &&
    `${meal.name} ${meal.description} ${meal.cook_name} ${meal.category}`.toLowerCase().includes(search));
  if (sort === "price-low") meals.sort((a,b) => a.price - b.price);
  if (sort === "price-high") meals.sort((a,b) => b.price - a.price);
  menuCount.textContent = `${meals.length} ${meals.length === 1 ? "meal" : "meals"} to love`;
  if (!meals.length) {
    mealGrid.innerHTML = '<div class="empty-state"><span class="empty-icon">🥣</span><strong>No meals found just yet.</strong><span>Try another search or select a different category.</span><button class="button button-outline" id="clearFilters">Clear filters</button></div>';
    $("#clearFilters").addEventListener("click", () => { $("#searchInput").value = ""; $("#categoryFilter").value = "all"; $("#sortFilter").value = "featured"; renderMeals(); });
    return;
  }
  mealGrid.innerHTML = meals.map(meal => {
    const emoji = escapeHtml(meal.emoji || "🍲");
    const color = safeColor(meal.card_color);
    return `<article class="meal-card">
      <div class="meal-art" style="background:${color}"><span class="meal-badge">${escapeHtml(categoryLabels[meal.category] || "Homemade")}</span><span class="meal-emoji" aria-hidden="true">${emoji}</span></div>
      <div class="meal-body"><div class="meal-topline"><h3>${escapeHtml(meal.name)}</h3><span class="meal-price">${money(meal.price)}</span></div>
      <p class="meal-description">${escapeHtml(meal.description)}</p>
      <div class="meal-meta"><span>◷ ${escapeHtml(meal.prep_minutes)} min prep</span><span>✦ Home-cooked</span></div>
      <div class="meal-footer"><span class="cook-name">PREPARED BY<strong>${escapeHtml(meal.cook_name)}</strong></span><button class="order-button" data-meal-id="${escapeHtml(meal.id)}" ${meal.available ? "" : "disabled"}>${meal.available ? "Pre-order →" : "Unavailable"}</button></div></div></article>`;
  }).join("");
  mealGrid.querySelectorAll("[data-meal-id]").forEach(button => button.addEventListener("click", () => openOrderDialog(button.dataset.mealId)));
}
function safeColor(color) {
  return /^#[0-9a-fA-F]{6}$/.test(color || "") ? color : "#f3eadc";
}
function openOrderDialog(id) {
  const meal = state.meals.find(item => item.id === id);
  if (!meal) return showToast("That meal is no longer available. Refresh the menu.");
  state.selectedMeal = meal;
  $("#mealId").value = meal.id;
  $("#dialogMealName").textContent = `${meal.name} · prepared by ${meal.cook_name}`;
  $("#dialogPrice").textContent = money(meal.price);
  $("#pickupTime").min = localDateTimeValue(new Date(Date.now() + 60 * 60 * 1000));
  $("#pickupTime").value = "";
  $("#formMessage").hidden = true;
  orderForm.reset();
  $("#mealId").value = meal.id;
  $("#dialogMealName").textContent = `${meal.name} · prepared by ${meal.cook_name}`;
  $("#dialogPrice").textContent = money(meal.price);
  orderDialog.showModal();
  $("#customerName").focus();
}
function localDateTimeValue(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}
function closeOrderDialog() { if (orderDialog.open) orderDialog.close(); }
async function submitPreorder(event) {
  event.preventDefault();
  if (!orderForm.reportValidity()) return;
  const meal = state.selectedMeal;
  if (!meal) return;
  const pickupDate = new Date($("#pickupTime").value);
  if (!Number.isFinite(pickupDate.getTime()) || pickupDate.getTime() < Date.now() + 60 * 60 * 1000) {
    showFormMessage("Please choose a pickup time at least one hour from now.", "error");
    return;
  }
  const payload = {
    meal_id: $("#mealId").value,
    customer_name: $("#customerName").value.trim(),
    customer_phone: $("#customerPhone").value.trim(),
    pickup_time: pickupDate.toISOString(),
    notes: $("#orderNotes").value.trim() || null
  };
  submitOrder.disabled = true;
  submitOrder.innerHTML = '<span class="spinner"></span> Placing your order…';
  try {
    const result = await api("/orders", { method: "POST", body: JSON.stringify(payload) });
    showFormMessage(`Pre-order placed! Your order number is #${result.data.id.slice(0, 8).toUpperCase()}.`, "success");
    showToast("Your pre-order has been saved.");
    await loadOrders();
    setTimeout(closeOrderDialog, 1400);
  } catch (error) {
    showFormMessage(error.message || "We couldn't place your order. Please try again.", "error");
  } finally {
    submitOrder.disabled = false;
    submitOrder.innerHTML = 'Place pre-order <span>→</span>';
  }
}
function showFormMessage(message, type) {
  const element = $("#formMessage");
  element.textContent = message;
  element.className = `form-message ${type}`;
  element.hidden = false;
}
async function loadOrders() {
  ordersList.innerHTML = '<div class="loading-state"><span class="spinner"></span> Loading your orders…</div>';
  setNotice(ordersNotice, "", false);
  try {
    const result = await api("/orders");
    state.orders = result.data || [];
    renderOrders();
  } catch (error) {
    ordersList.innerHTML = `<div class="empty-state"><span class="empty-icon">🧾</span><strong>Orders aren't available right now.</strong><span>${escapeHtml(error.message)}</span><button class="button button-outline" id="retryOrders">Try again</button></div>`;
    $("#retryOrders").addEventListener("click", loadOrders);
    setNotice(ordersNotice, "For this learning project, order history is shared on this demo. Do not enter sensitive personal information.");
  }
}
function renderOrders() {
  if (!state.orders.length) {
    ordersList.innerHTML = '<div class="empty-state"><span class="empty-icon">🧺</span><strong>Your order list is looking fresh.</strong><span>Pre-order a meal from the menu and it will show up here.</span><a class="button button-outline" href="#meals">Browse meals</a></div>';
    return;
  }
  ordersList.innerHTML = state.orders.map(order => {
    const status = order.status || "pending";
    const date = new Date(order.pickup_time);
    const dateLabel = Number.isFinite(date.getTime()) ? date.toLocaleString("en-IN", { dateStyle:"medium", timeStyle:"short" }) : "Time not available";
    return `<article class="order-row"><div class="order-main"><div class="order-mini-art">${escapeHtml(order.meal_emoji || "🍲")}</div><div><strong>${escapeHtml(order.meal_name || "Meal")}</strong><small>Order #${escapeHtml(order.id.slice(0,8).toUpperCase())} · ${escapeHtml(order.customer_name)}</small></div></div><div class="order-detail">PICKUP TIME<strong>${escapeHtml(dateLabel)}</strong></div><div class="order-detail">TOTAL<strong>${money(order.total_price)}</strong></div><span class="status-pill ${status === "cancelled" ? "status-cancelled" : ""}">${escapeHtml(status[0].toUpperCase() + status.slice(1))}</span>${status === "pending" ? `<button class="cancel-button" data-cancel-id="${escapeHtml(order.id)}">Cancel order</button>` : ""}</article>`;
  }).join("");
  ordersList.querySelectorAll("[data-cancel-id]").forEach(button => button.addEventListener("click", () => cancelOrder(button.dataset.cancelId, button)));
}
async function cancelOrder(id, button) {
  if (!confirm("Cancel this pre-order?")) return;
  button.disabled = true;
  button.textContent = "Cancelling…";
  try {
    await api(`/orders/${encodeURIComponent(id)}`, { method:"PATCH", body:JSON.stringify({ status:"cancelled" }) });
    showToast("Order cancelled.");
    await loadOrders();
  } catch (error) {
    showToast(error.message || "Couldn't cancel this order.");
    button.disabled = false;
    button.textContent = "Cancel order";
  }
}
function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
}
