import { invoke } from "@tauri-apps/api/core";
import Database from "@tauri-apps/plugin-sql";
import { open, save } from "@tauri-apps/plugin-dialog";
import productConfig from "../../config/product.json";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = { settings: null, session: null, products: [], sales: [], customers: [], expenses: [], cart: [], cash: null, backups: [] };
let sqlDatabase;
const titles = { dashboard: "Buenos días", pos: "Punto de venta", products: "Productos e inventario", customers: "Clientes", sales: "Historial de ventas", cash: "Control de caja", expenses: "Gastos", users: "Usuarios y cajeros", reports: "Reportes", settings: "Configuración", backups: "Copias de seguridad" };

function money(value = 0) {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: state.settings?.currency || productConfig.currency, maximumFractionDigits: Number(state.settings?.currency_decimals ?? productConfig.currencyDecimals) }).format(Number(value) / 10 ** Number(state.settings?.currency_decimals ?? productConfig.currencyDecimals));
}
function dateTime(value) { return value ? new Intl.DateTimeFormat("es-CO", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "—"; }
function minor(value) { return Math.round(Number(value || 0) * 10 ** Number(state.settings?.currency_decimals ?? productConfig.currencyDecimals)); }
function toast(message) { const el = $("#toast"); el.textContent = message; el.classList.add("show"); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove("show"), 2800); }
function showFatal(error) { $("#fatalMessage").textContent = String(error?.message || error); $("#fatalError").hidden = false; }
function formObject(form) { return Object.fromEntries(new FormData(form)); }
function h(value) { return String(value ?? "").replace(/[&<>"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]); }

async function initialize() {
  try {
    sqlDatabase = await Database.load("sqlite:pos.db");
    const boot = await invoke("initialize_app");
    state.settings = boot.settings;
    if (!boot.configured) { $("#setupScreen").hidden = false; return; }
    $("#loginBusiness").textContent = state.settings.business_name;
    $("#loginScreen").hidden = false;
  } catch (error) { showFatal(error); }
}

$("#setupForm").addEventListener("submit", async (event) => {
  event.preventDefault(); const data = formObject(event.currentTarget); const error = $("#setupError"); error.textContent = "";
  if (data.pin !== data.pinConfirm) { error.textContent = "Los PIN no coinciden."; return; }
  try {
    await invoke("complete_setup", { payload: { business_name: data.businessName, currency: data.currency, currency_symbol: data.currencySymbol, currency_decimals: data.currency === "COP" ? 0 : 2, tax_basis_points: Math.round(Number(data.taxPercent) * 100), admin_name: data.adminName, pin: data.pin, printer_name: data.printerName || null } });
    state.settings = (await invoke("initialize_app")).settings; $("#setupScreen").hidden = true; $("#loginBusiness").textContent = state.settings.business_name; $("#loginScreen").hidden = false; toast("Configuración completada");
  } catch (err) { error.textContent = String(err); }
});

$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault(); const data = formObject(event.currentTarget); const error = $("#loginError"); error.textContent = "";
  try { state.session = await invoke("login", { pin: data.pin }); $("#loginScreen").hidden = true; $("#appShell").hidden = false; $("#avatar").textContent = state.session.name.slice(0, 1).toUpperCase(); event.currentTarget.reset(); await loadAll(); }
  catch (err) { error.textContent = String(err); }
});

async function loadAll() {
  const [dashboard, products, sales, customers, expenses, cash, users, backups] = await Promise.all([invoke("dashboard_summary"), invoke("list_products"), invoke("list_sales", { limit: 250 }), invoke("list_customers"), invoke("list_expenses"), invoke("cash_status"), invoke("list_users"), invoke("list_backups")]);
  state.products = products; state.sales = sales; state.customers = customers; state.expenses = expenses; state.cash = cash; state.backups = backups;
  renderDashboard(dashboard); renderProducts(); renderSales(); renderCustomers(); renderExpenses(); renderCash(); renderUsers(users); renderBackups(); fillSettings();
}

function renderDashboard(data) {
  $("#todayRevenue").textContent = money(data.today_revenue_minor); $("#todayTransactions").textContent = `${data.today_transactions} transacciones`; $("#todayUnits").textContent = data.today_units; $("#cashExpected").textContent = money(data.cash_expected_minor); $("#cashState").textContent = data.cash_open ? "Caja abierta" : "Caja cerrada"; $("#lowStock").textContent = data.low_stock_count;
  $("#recentSales").innerHTML = data.recent_sales.length ? data.recent_sales.map(saleRow).join("") : `<tr><td colspan="4">Aún no hay ventas registradas.</td></tr>`;
}
function saleRow(sale) { return `<tr><td><strong>${sale.sale_number}</strong></td><td>${dateTime(sale.created_at)}</td><td>${paymentLabel(sale.payment_method)}</td><td><strong>${money(sale.total_minor)}</strong></td></tr>`; }
function paymentLabel(method) { return ({ cash: "Efectivo", card: "Tarjeta", transfer: "Transferencia", mixed: "Mixto" })[method] || method || "—"; }

function renderProducts() {
  const term = ($("#productSearch")?.value || "").toLowerCase(); const visible = state.products.filter(p => `${p.name} ${p.sku || ""} ${p.barcode || ""}`.toLowerCase().includes(term));
  $("#productGrid").innerHTML = visible.length ? visible.map(p => `<button class="product-card" data-product="${h(p.id)}" ${!p.active || p.stock_quantity <= 0 ? "disabled" : ""}><span>${h(p.sku || "SIN SKU")}</span><b>${h(p.name)}</b><strong>${money(p.price_minor)}</strong><small>${p.track_stock ? `${p.stock_quantity} disponibles` : "Sin control de stock"}</small></button>`).join("") : `<div class="empty-cart">No encontramos productos.</div>`;
  $("#productsTable").innerHTML = state.products.length ? state.products.map(p => `<tr><td><strong>${h(p.name)}</strong></td><td>${h(p.sku || "—")}</td><td>${h(p.category_name || "Sin categoría")}</td><td>${money(p.price_minor)}</td><td>${p.stock_quantity}</td><td><span class="${p.stock_quantity <= p.min_stock ? "stock-low" : "stock-ok"}">${p.stock_quantity <= p.min_stock ? "Stock bajo" : "Disponible"}</span></td></tr>`).join("") : `<tr><td colspan="6">No hay productos.</td></tr>`;
  $$("[data-product]").forEach(button => button.addEventListener("click", () => addToCart(button.dataset.product)));
}
function addToCart(id) { const product = state.products.find(p => p.id === id); if (!product) return; const line = state.cart.find(item => item.product_id === id); if (line) { if (line.quantity >= product.stock_quantity) return toast("No hay más existencias disponibles"); line.quantity += 1; } else state.cart.push({ product_id: id, name: product.name, unit_price_minor: product.price_minor, tax_basis_points: state.settings.tax_basis_points, quantity: 1, max: product.stock_quantity }); renderCart(); }
function renderCart() {
  $("#cartItems").innerHTML = state.cart.length ? state.cart.map(item => `<div class="cart-line"><div><strong>${h(item.name)}</strong><span>${money(item.unit_price_minor)} c/u</span></div><div class="quantity"><button data-delta="-1" data-id="${h(item.product_id)}">−</button><b>${item.quantity}</b><button data-delta="1" data-id="${h(item.product_id)}">+</button></div></div>`).join("") : `<div class="empty-cart"><span>Agrega productos para comenzar una venta.</span></div>`;
  $$('[data-delta]').forEach(button => button.addEventListener("click", () => changeQuantity(button.dataset.id, Number(button.dataset.delta))));
  const subtotal = state.cart.reduce((sum, item) => sum + item.unit_price_minor * item.quantity, 0); const tax = state.cart.reduce((sum, item) => sum + Math.round(item.unit_price_minor * item.quantity * item.tax_basis_points / 10000), 0); $("#cartSubtotal").textContent = money(subtotal); $("#cartTax").textContent = money(tax); $("#cartTotal").textContent = money(subtotal + tax); $("#amountReceived").value = (subtotal + tax) / 10 ** Number(state.settings.currency_decimals);
}
function changeQuantity(id, delta) { const line = state.cart.find(item => item.product_id === id); if (!line) return; line.quantity += delta; if (line.quantity > line.max) { line.quantity = line.max; toast("Stock máximo alcanzado"); } if (line.quantity <= 0) state.cart = state.cart.filter(item => item !== line); renderCart(); }

$("#checkoutButton").addEventListener("click", async () => {
  const msg = $("#saleMessage"); msg.textContent = ""; if (!state.cart.length) return toast("Agrega al menos un producto");
  const total = state.cart.reduce((sum, item) => sum + item.unit_price_minor * item.quantity + Math.round(item.unit_price_minor * item.quantity * item.tax_basis_points / 10000), 0); const method = $("#paymentMethod").value; const received = minor($("#amountReceived").value);
  if (method === "cash" && received < total) return toast("El efectivo recibido es insuficiente");
  try { const result = await invoke("create_sale", { payload: { customer_id: null, user_id: state.session.id, items: state.cart.map(({ product_id, quantity }) => ({ product_id, quantity })), payments: [{ method, amount_minor: total, reference: null }], amount_received_minor: method === "cash" ? received : total } }); state.cart = []; renderCart(); msg.textContent = `Venta ${result.sale_number} guardada · Cambio ${money(result.change_minor)}`; toast("Venta registrada correctamente"); await loadAll(); }
  catch (error) { msg.textContent = String(error); }
});

function renderSales() { $("#salesTable").innerHTML = state.sales.length ? state.sales.map(s => `<tr><td><strong>${s.sale_number}</strong></td><td>${dateTime(s.created_at)}</td><td>${s.item_count}</td><td>${paymentLabel(s.payment_method)}</td><td>${money(s.total_minor)}</td><td><span class="status-ok">Completada</span></td></tr>`).join("") : `<tr><td colspan="6">No hay ventas registradas.</td></tr>`; }
function renderCash() { const c = state.cash; const open = Boolean(c?.is_open); $("#cashBadge").textContent = open ? "Abierta" : "Cerrada"; $("#cashBadge").classList.toggle("open", open); $("#cashFormTitle").textContent = open ? "Cerrar caja" : "Abrir caja"; $("#cashAmountLabel").firstChild.textContent = open ? "Efectivo contado" : "Monto inicial"; $("#openingAmount").textContent = money(c?.opening_amount_minor); $("#cashSales").textContent = money(c?.cash_sales_minor); $("#cashMovements").textContent = money(c?.movements_minor); $("#expectedCash").textContent = money(c?.expected_amount_minor); }
$("#cashSessionForm").addEventListener("submit", async event => { event.preventDefault(); const data = formObject(event.currentTarget), msg = $("#cashMessage"); try { if (state.cash?.is_open) await invoke("close_cash_session", { payload: { counted_amount_minor: minor(data.amount), notes: data.notes || null, user_id: state.session.id } }); else await invoke("open_cash_session", { payload: { opening_amount_minor: minor(data.amount), notes: data.notes || null, user_id: state.session.id } }); event.currentTarget.reset(); msg.textContent = state.cash?.is_open ? "Caja cerrada correctamente." : "Caja abierta correctamente."; await loadAll(); } catch (error) { msg.textContent = String(error); } });
$("#cashMovementForm").addEventListener("submit", async event => { event.preventDefault(); const data = formObject(event.currentTarget); try { await invoke("add_cash_movement", { payload: { movement_type: data.type, amount_minor: minor(data.amount), description: data.description, user_id: state.session.id } }); event.currentTarget.reset(); toast("Movimiento de caja registrado"); await loadAll(); } catch (error) { toast(String(error)); } });

function renderCustomers() { $("#customersTable").innerHTML = state.customers.length ? state.customers.map(c => `<tr><td><strong>${h(c.name)}</strong></td><td>${h(c.document || "—")}</td><td>${h(c.phone || "—")}</td><td>${h(c.email || "—")}</td></tr>`).join("") : `<tr><td colspan="4">No hay clientes registrados.</td></tr>`; }
$("#customerForm").addEventListener("submit", async event => { event.preventDefault(); const data = formObject(event.currentTarget); try { await invoke("create_customer", { payload: { name: data.name, document: data.document || null, phone: data.phone || null, email: data.email || null } }); event.currentTarget.reset(); state.customers = await invoke("list_customers"); renderCustomers(); $("#customerMessage").textContent = "Cliente guardado."; } catch (error) { $("#customerMessage").textContent = String(error); } });

function renderExpenses() { $("#expensesTable").innerHTML = state.expenses.length ? state.expenses.map(e => `<tr><td>${dateTime(e.created_at)}</td><td>${h(e.category)}</td><td>${h(e.description)}</td><td><strong>${money(e.amount_minor)}</strong></td></tr>`).join("") : `<tr><td colspan="4">No hay gastos registrados.</td></tr>`; }
$("#expenseForm").addEventListener("submit", async event => { event.preventDefault(); const data = formObject(event.currentTarget); try { await invoke("create_expense", { payload: { category: data.category, description: data.description, amount_minor: minor(data.amount), user_id: state.session.id } }); event.currentTarget.reset(); $("#expenseMessage").textContent = "Gasto guardado y descontado de caja."; await loadAll(); } catch (error) { $("#expenseMessage").textContent = String(error); } });

function renderUsers(users) { $("#usersTable").innerHTML = users.map(u => `<tr><td><strong>${u.name}</strong></td><td>${u.role === "admin" ? "Administrador" : "Cajero"}</td><td><span class="status-ok">${u.active ? "Activo" : "Inactivo"}</span></td><td>${dateTime(u.created_at)}</td></tr>`).join(""); }
function fillSettings() { const form = $("#settingsForm"); form.businessName.value = state.settings.business_name; form.currencySymbol.value = state.settings.currency_symbol; form.taxPercent.value = state.settings.tax_basis_points / 100; }
$("#settingsForm").addEventListener("submit", async event => { event.preventDefault(); const data = formObject(event.currentTarget); try { state.settings = await invoke("update_settings", { payload: { business_name: data.businessName, currency_symbol: data.currencySymbol, tax_basis_points: Math.round(Number(data.taxPercent) * 100) } }); $("#settingsMessage").textContent = "Configuración guardada."; } catch (error) { $("#settingsMessage").textContent = String(error); } });

async function loadDiagnostics() { try { const d = await invoke("diagnostics"); $("#diagDb").textContent = d.database_ok ? "OK" : "Revisar"; $("#diagStatus").textContent = d.database_ok ? "Operativo" : "Atención requerida"; $("#diagVersion").textContent = d.app_version; $("#diagBackup").textContent = dateTime(d.last_backup_at); $("#diagPath").textContent = d.data_path; } catch (error) { $("#diagDb").textContent = "Error"; $("#diagStatus").textContent = String(error); } }
function renderBackups() { $("#backupsTable").innerHTML = state.backups.length ? state.backups.map(b => `<tr><td><strong>${b.file_name}</strong></td><td>${dateTime(b.created_at)}</td><td>${(b.size_bytes / 1048576).toFixed(2)} MB</td><td><span class="status-ok">${b.status}</span></td><td><button class="text-btn" data-restore="${encodeURIComponent(b.path)}">Restaurar</button></td></tr>`).join("") : `<tr><td colspan="5">Aún no hay copias.</td></tr>`; $$('[data-restore]').forEach(btn => btn.addEventListener("click", () => restoreBackup(decodeURIComponent(btn.dataset.restore)))); }
async function createBackup() { try { const backup = await invoke("create_backup"); toast(`Backup creado: ${backup.file_name}`); state.backups = await invoke("list_backups"); renderBackups(); } catch (error) { toast(String(error)); } }
async function restoreBackup(path) { if (!confirm("Se creará una copia del estado actual antes de restaurar. ¿Continuar?")) return; try { if (sqlDatabase) { await sqlDatabase.close(); sqlDatabase = null; } await invoke("restore_backup", { path }); toast("Copia restaurada. Reiniciando…"); setTimeout(() => location.reload(), 900); } catch (error) { $("#backupMessage").textContent = String(error); try { sqlDatabase = await Database.load("sqlite:pos.db"); } catch {} } }

$("#createBackup").addEventListener("click", createBackup); $("#quickBackup").addEventListener("click", createBackup);
$("#importBackup").addEventListener("click", async () => { const path = await open({ multiple: false, filters: [{ name: "Base SQLite", extensions: ["db", "sqlite", "sqlite3"] }] }); if (path) restoreBackup(path); });
$$('[data-export]').forEach(button => button.addEventListener("click", async () => { try { const defaultPath = await invoke("suggest_export_path", { kind: button.dataset.export }); const path = await save({ defaultPath, filters: [{ name: "CSV", extensions: ["csv"] }] }); if (!path) return; await invoke("export_csv", { kind: button.dataset.export, destination: path }); $("#exportMessage").textContent = `Archivo guardado en ${path}`; toast("Exportación completada"); } catch (error) { $("#exportMessage").textContent = String(error); } }));

$("#newProduct").addEventListener("click", () => $("#productDialog").showModal()); $$('[data-close-dialog]').forEach(b => b.addEventListener("click", () => $("#productDialog").close()));
$("#productForm").addEventListener("submit", async event => { event.preventDefault(); const data = formObject(event.currentTarget); try { await invoke("create_product", { payload: { name: data.name, sku: data.sku || null, barcode: data.barcode || null, price_minor: minor(data.price), cost_minor: minor(data.cost), stock_quantity: Number(data.stock), min_stock: Number(data.minStock) } }); event.currentTarget.reset(); $("#productDialog").close(); state.products = await invoke("list_products"); renderProducts(); toast("Producto creado"); } catch (error) { $("#productError").textContent = String(error); } });

$("#mainNav").addEventListener("click", event => { const button = event.target.closest("button[data-view]"); if (button) showView(button.dataset.view); }); $$('[data-go]').forEach(button => button.addEventListener("click", () => showView(button.dataset.go)));
function showView(view) { $$('[data-view]').forEach(b => b.classList.toggle("active", b.dataset.view === view)); $$('[data-view-panel]').forEach(p => p.classList.toggle("active", p.dataset.viewPanel === view)); $("#crumb").textContent = view.toUpperCase(); $("#pageTitle").textContent = titles[view]; if (view === "settings") loadDiagnostics(); }
$("#productSearch").addEventListener("input", renderProducts); $("#productsFilter").addEventListener("input", event => { $("#productSearch").value = event.target.value; renderProducts(); }); $("#clearCart").addEventListener("click", () => { state.cart = []; renderCart(); }); $("#refreshProducts").addEventListener("click", async () => { state.products = await invoke("list_products"); renderProducts(); }); $("#reloadSales").addEventListener("click", loadAll); $("#runDiagnostics").addEventListener("click", loadDiagnostics);
$("#lockButton").addEventListener("click", () => { state.session = null; $("#appShell").hidden = true; $("#loginScreen").hidden = false; });
setInterval(() => { $("#clock").textContent = new Intl.DateTimeFormat("es-CO", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date()); }, 1000);
initialize();
