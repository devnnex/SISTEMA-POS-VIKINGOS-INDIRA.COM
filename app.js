const STORAGE_KEY = "vikingos_pos_state_v1";
const ADMIN_SESSION_KEY = "vikingos_admin_unlocked";
const ADMIN_PASSWORD = "5678";

const defaultState = {
  price: 5000,
  theme: "light",
  sales: []
};

const els = {
  body: document.body,
  navBtns: document.querySelectorAll(".nav-btn"),
  saleSection: document.getElementById("saleSection"),
  adminSection: document.getElementById("adminSection"),
  saleForm: document.getElementById("saleForm"),
  quantityInput: document.getElementById("quantityInput"),
  previewQty: document.getElementById("previewQty"),
  sidePrice: document.getElementById("sidePrice"),
  priceInput: document.getElementById("priceInput"),
  updatePriceBtn: document.getElementById("updatePriceBtn"),
  themeToggle: document.getElementById("themeToggle"),
  todayStatus: document.getElementById("todayStatus"),
  lastSaleAmount: document.getElementById("lastSaleAmount"),
  lastSaleMeta: document.getElementById("lastSaleMeta"),
  rangeBtns: document.querySelectorAll(".range-btn"),
  searchInput: document.getElementById("searchInput"),
  kpiUnits: document.getElementById("kpiUnits"),
  kpiRevenue: document.getElementById("kpiRevenue"),
  kpiTransactions: document.getElementById("kpiTransactions"),
  kpiRange: document.getElementById("kpiRange"),
  monthlyChart: document.getElementById("monthlyChart"),
  kpiBest: document.getElementById("kpiBest"),
  kpiBestMeta: document.getElementById("kpiBestMeta"),
  smartInsight: document.getElementById("smartInsight"),
  trendPercent: document.getElementById("trendPercent"),
  recordsBody: document.getElementById("recordsBody"),
  recordsCount: document.getElementById("recordsCount"),
  emptyState: document.getElementById("emptyState"),
  clearHistoryBtn: document.getElementById("clearHistoryBtn"),
  confirmModal: document.getElementById("confirmModal"),
  cancelClear: document.getElementById("cancelClear"),
  confirmClear: document.getElementById("confirmClear"),
  chatToggle: document.getElementById("chatToggle"),
  chatPanel: document.getElementById("chatPanel"),
  chatClose: document.getElementById("chatClose"),
  chatMessages: document.getElementById("chatMessages"),
  chatForm: document.getElementById("chatForm"),
  chatInput: document.getElementById("chatInput"),
  adminLoginModal: document.getElementById("adminLoginModal"),
  adminLoginForm: document.getElementById("adminLoginForm"),
  adminPassword: document.getElementById("adminPassword"),
  loginError: document.getElementById("loginError"),
  cancelLogin: document.getElementById("cancelLogin")
};

let state = loadState();
let currentRange = "today";
let searchTerm = "";
let priceFeedbackTimer;
let activeSection = "sale";

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return { ...defaultState, ...saved, sales: Array.isArray(saved?.sales) ? saved.sales : [] };
  } catch {
    return { ...defaultState };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function money(value) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0
  }).format(Number(value) || 0);
}

function prettyDate(value) {
  return new Intl.DateTimeFormat("es-CO", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function onlyDigits(value) {
  return String(value).replace(/\D/g, "");
}

function startOfDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function endOfDay(date) {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

function getRangeDates(range) {
  const now = new Date();
  const todayStart = startOfDay(now);

  if (range === "today") return { from: todayStart, to: endOfDay(now), label: "Hoy" };

  if (range === "yesterday") {
    const yesterday = new Date(todayStart);
    yesterday.setDate(yesterday.getDate() - 1);
    return { from: startOfDay(yesterday), to: endOfDay(yesterday), label: "Ayer" };
  }

  if (range === "7" || range === "15") {
    const from = new Date(todayStart);
    from.setDate(from.getDate() - (Number(range) - 1));
    return { from, to: endOfDay(now), label: `Ultimos ${range} dias` };
  }

  if (range === "month") {
    return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: endOfDay(now), label: "Este mes" };
  }

  if (range === "year") {
    return { from: new Date(now.getFullYear(), 0, 1), to: endOfDay(now), label: "Este año" };
  }

  return { from: null, to: null, label: "Todo el historico" };
}

function saleInRange(sale, range) {
  const { from, to } = getRangeDates(range);
  const date = new Date(sale.createdAt);
  if (!from || !to) return true;
  return date >= from && date <= to;
}

function salesForRange(range = currentRange) {
  return state.sales.filter((sale) => saleInRange(sale, range));
}

function summarize(sales) {
  const units = sales.reduce((sum, sale) => sum + sale.quantity, 0);
  const revenue = sales.reduce((sum, sale) => sum + sale.total, 0);
  const best = sales.reduce((top, sale) => (sale.total > (top?.total || 0) ? sale : top), null);
  return { units, revenue, best, transactions: sales.length };
}

function filteredSales() {
  const term = searchTerm.trim().toLowerCase();
  return salesForRange().filter((sale) => {
    if (!term) return true;
    const haystack = [
      prettyDate(sale.createdAt),
      sale.quantity,
      sale.unitPrice,
      sale.total,
      money(sale.total)
    ].join(" ").toLowerCase();
    return haystack.includes(term);
  });
}

function render() {
  applyTheme();
  els.sidePrice.textContent = money(state.price);
  els.priceInput.value = state.price || "";
  renderHome();
  renderAdmin();
}

function renderHome() {
  const today = summarize(salesForRange("today"));
  const lastSale = [...state.sales].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];

  els.todayStatus.textContent = `Hoy: ${today.units} vendidos`;

  if (lastSale) {
    els.lastSaleAmount.textContent = money(lastSale.total);
    els.lastSaleMeta.textContent = `${lastSale.quantity} unidades - ${prettyDate(lastSale.createdAt)}`;
  } else {
    els.lastSaleAmount.textContent = money(0);
    els.lastSaleMeta.textContent = "Sin registros todavia";
  }
}

function renderAdmin() {
  const visibleSales = filteredSales().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const stats = summarize(visibleSales);
  const allRangeStats = summarize(salesForRange());
  const range = getRangeDates(currentRange);

  els.kpiUnits.textContent = stats.units;
  els.kpiRevenue.textContent = money(stats.revenue);
  els.kpiTransactions.textContent = `${stats.transactions} ${stats.transactions === 1 ? "registro" : "registros"}`;
  els.kpiRange.textContent = range.label;
  els.kpiBest.textContent = money(stats.best?.total || 0);
  els.kpiBestMeta.textContent = stats.best ? `${stats.best.quantity} unidades - ${prettyDate(stats.best.createdAt)}` : "Sin datos";
  els.recordsCount.textContent = `${visibleSales.length} ${visibleSales.length === 1 ? "resultado" : "resultados"}`;
  els.trendPercent.textContent = `${calculateTrend(allRangeStats)}%`;
  els.smartInsight.textContent = buildInsight(visibleSales, allRangeStats);
  renderMonthlyChart();

  els.recordsBody.innerHTML = visibleSales.map((sale) => `
    <tr>
      <td>${prettyDate(sale.createdAt)}</td>
      <td>${sale.quantity}</td>
      <td>${money(sale.unitPrice)}</td>
      <td>${money(sale.total)}</td>
    </tr>
  `).join("");

  els.emptyState.style.display = visibleSales.length ? "none" : "block";
}

function renderMonthlyChart() {
  const monthNames = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  const currentYear = new Date().getFullYear();
  const months = Array.from({ length: 12 }, (_, index) => ({
    label: monthNames[index],
    revenue: 0,
    units: 0
  }));

  state.sales.forEach((sale) => {
    const date = new Date(sale.createdAt);
    if (date.getFullYear() !== currentYear) return;
    months[date.getMonth()].revenue += sale.total;
    months[date.getMonth()].units += sale.quantity;
  });

  const maxRevenue = Math.max(...months.map((month) => month.revenue), 0);

  els.monthlyChart.innerHTML = months.map((month) => {
    const height = maxRevenue ? Math.max(8, Math.round((month.revenue / maxRevenue) * 100)) : 8;
    const label = `${month.label}: ${money(month.revenue)} - ${month.units} vendidos`;
    return `
      <div class="month-bar" data-label="${label}">
        <div class="month-bar-fill" style="height: ${height}%"></div>
        <span>${month.label}</span>
      </div>
    `;
  }).join("");
}

function calculateTrend(stats) {
  if (!state.sales.length || !stats.transactions) return 0;
  return Math.min(100, Math.round((stats.transactions / state.sales.length) * 100));
}

function buildInsight(visibleSales, rangeStats) {
  if (!visibleSales.length) {
    return searchTerm
      ? "No encontre ventas con esa busqueda dentro del periodo seleccionado."
      : "No hay ventas en este periodo. Cuando registres unidades, aqui veras una lectura clara de ingreso, volumen y mejores movimientos.";
  }

  const stats = summarize(visibleSales);
  const unitWord = stats.units === 1 ? "Vikingo" : "Vikingos";
  const bestHour = getTopHour(visibleSales);
  const coverage = rangeStats.transactions ? Math.round((stats.transactions / rangeStats.transactions) * 100) : 100;

  return `En ${getRangeDates(currentRange).label.toLowerCase()} tienes ${stats.units} ${unitWord} vendidos y ${money(stats.revenue)} ingresados. La hora con mejor movimiento es ${bestHour}. La busqueda actual cubre el ${coverage}% de los registros del periodo.`;
}

function getTopHour(sales) {
  const buckets = sales.reduce((acc, sale) => {
    const hour = new Date(sale.createdAt).getHours();
    acc[hour] = (acc[hour] || 0) + sale.total;
    return acc;
  }, {});
  const topHour = Object.entries(buckets).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (topHour === undefined) return "sin datos";
  const hour = Number(topHour);
  return new Intl.DateTimeFormat("es-CO", { hour: "numeric" }).format(new Date(2026, 0, 1, hour));
}

function applyTheme() {
  els.body.classList.toggle("dark", state.theme === "dark");
}

function addSale(quantity) {
  const sale = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    quantity,
    unitPrice: Number(state.price) || 0,
    total: quantity * (Number(state.price) || 0),
    createdAt: new Date().toISOString()
  };
  state.sales.push(sale);
  saveState();
  render();
  els.quantityInput.value = "";
  els.previewQty.textContent = "0";
}

function updateUnitPrice() {
  const price = Number(onlyDigits(els.priceInput.value));
  const priceEditor = els.priceInput.closest(".price-editor");

  clearTimeout(priceFeedbackTimer);

  if (!price) {
    priceEditor.classList.add("error");
    els.updatePriceBtn.classList.add("is-error");
    els.updatePriceBtn.innerHTML = '<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><span>Ingresa un precio</span>';
    priceFeedbackTimer = setTimeout(() => {
      priceEditor.classList.remove("error");
      resetPriceButton();
    }, 1500);
    return;
  }

  els.updatePriceBtn.disabled = true;
  els.updatePriceBtn.classList.remove("is-saved", "is-error");
  els.updatePriceBtn.classList.add("is-saving");
  els.updatePriceBtn.innerHTML = '<i class="fa-solid fa-circle-notch" aria-hidden="true"></i><span>Guardando...</span>';

  setTimeout(() => {
    state.price = price;
    saveState();
    render();

    priceEditor.classList.add("saved");
    els.updatePriceBtn.disabled = false;
    els.updatePriceBtn.classList.remove("is-saving");
    els.updatePriceBtn.classList.add("is-saved");
    els.updatePriceBtn.innerHTML = '<i class="fa-solid fa-check" aria-hidden="true"></i><span>Precio actualizado</span>';

    priceFeedbackTimer = setTimeout(() => {
      priceEditor.classList.remove("saved");
      resetPriceButton();
    }, 1400);
  }, 520);
}

function resetPriceButton() {
  els.updatePriceBtn.disabled = false;
  els.updatePriceBtn.classList.remove("is-saving", "is-saved", "is-error");
  els.updatePriceBtn.innerHTML = '<i class="fa-solid fa-money-bill-wave" aria-hidden="true"></i><span>Actualizar precio unitario</span>';
}

function adminUnlocked() {
  return sessionStorage.getItem(ADMIN_SESSION_KEY) === "true";
}

function openAdminLogin() {
  els.adminLoginModal.classList.add("open");
  els.loginError.textContent = "";
  els.adminPassword.value = "";
  setTimeout(() => els.adminPassword.focus(), 60);
}

function closeAdminLogin() {
  els.adminLoginModal.classList.remove("open");
  els.loginError.textContent = "";
  els.adminPassword.value = "";
}

function switchSection(section) {
  if (section === "admin" && !adminUnlocked()) {
    openAdminLogin();
    return;
  }

  activeSection = section;
  els.navBtns.forEach((btn) => btn.classList.toggle("active", btn.dataset.section === section));
  els.saleSection.classList.toggle("active-view", section === "sale");
  els.adminSection.classList.toggle("active-view", section === "admin");
  els.body.classList.toggle("admin-active", section === "admin");

  if (section !== "admin") {
    els.chatPanel.classList.remove("open");
  }
}

function pushMessage(role, text) {
  const bubble = document.createElement("div");
  bubble.className = `message ${role}`;
  bubble.textContent = text;
  els.chatMessages.appendChild(bubble);
  els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
}

function normalizeText(value) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function answerQuestion(question) {
  const q = normalizeText(question);
  let range = currentRange;
  if (q.includes("hoy")) range = "today";
  if (q.includes("ayer")) range = "yesterday";
  if (q.includes("7")) range = "7";
  if (q.includes("15")) range = "15";
  if (q.includes("mes")) range = "month";
  if (q.includes("ano")) range = "year";
  if (q.includes("todo") || q.includes("historico")) range = "all";

  const stats = summarize(salesForRange(range));
  const label = getRangeDates(range).label.toLowerCase();

  if (!stats.transactions) {
    return `Por ahora no hay ventas registradas para ${label}. Cuando ingreses ventas con Intro, podre calcular unidades, ingresos y movimientos por periodo.`;
  }

  if (q.includes("mejor") || q.includes("mayor")) {
    return `La mejor venta de ${label} fue de ${money(stats.best.total)}, con ${stats.best.quantity} unidades a ${money(stats.best.unitPrice)} cada una, registrada el ${prettyDate(stats.best.createdAt)}.`;
  }

  if (q.includes("promedio") || q.includes("ticket")) {
    return `Ese indicador fue reemplazado por la grafica de ventas por mes. Para ${label}, tienes ${stats.units} Vikingos vendidos y ${money(stats.revenue)} ingresados.`;
  }

  if (q.includes("cuanto") || q.includes("total") || q.includes("ingreso") || q.includes("vendi")) {
    return `En ${label} vendiste ${stats.units} Vikingos y el total ingresado es ${money(stats.revenue)}.`;
  }

  return `Resumen de ${label}: ${stats.units} Vikingos vendidos, ${money(stats.revenue)} ingresados y ${stats.transactions} registros.`;
}

els.navBtns.forEach((btn) => {
  btn.addEventListener("click", () => switchSection(btn.dataset.section));
});

els.quantityInput.addEventListener("input", () => {
  els.quantityInput.value = onlyDigits(els.quantityInput.value);
  els.previewQty.textContent = els.quantityInput.value || "0";
});

els.saleForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const quantity = Number(onlyDigits(els.quantityInput.value));
  if (!quantity) return;
  addSale(quantity);
});

els.priceInput.addEventListener("input", () => {
  els.priceInput.value = onlyDigits(els.priceInput.value);
});

els.priceInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  updateUnitPrice();
});

els.updatePriceBtn.addEventListener("click", updateUnitPrice);

els.adminPassword.addEventListener("input", () => {
  els.adminPassword.value = onlyDigits(els.adminPassword.value);
});

els.adminLoginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (els.adminPassword.value === ADMIN_PASSWORD) {
    sessionStorage.setItem(ADMIN_SESSION_KEY, "true");
    closeAdminLogin();
    switchSection("admin");
    return;
  }

  els.loginError.textContent = "Contrasena incorrecta. Intenta de nuevo.";
  els.adminPassword.select();
});

els.cancelLogin.addEventListener("click", () => {
  closeAdminLogin();
  switchSection(activeSection);
});

els.adminLoginModal.addEventListener("click", (event) => {
  if (event.target === els.adminLoginModal) {
    closeAdminLogin();
    switchSection(activeSection);
  }
});

els.rangeBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    currentRange = btn.dataset.range;
    els.rangeBtns.forEach((item) => item.classList.toggle("active", item === btn));
    renderAdmin();
  });
});

els.searchInput.addEventListener("input", () => {
  searchTerm = els.searchInput.value;
  renderAdmin();
});

els.themeToggle.addEventListener("click", () => {
  state.theme = state.theme === "dark" ? "light" : "dark";
  saveState();
  render();
});

els.clearHistoryBtn.addEventListener("click", () => {
  els.confirmModal.classList.add("open");
});

els.cancelClear.addEventListener("click", () => {
  els.confirmModal.classList.remove("open");
});

els.confirmModal.addEventListener("click", (event) => {
  if (event.target === els.confirmModal) els.confirmModal.classList.remove("open");
});

els.confirmClear.addEventListener("click", () => {
  state.sales = [];
  saveState();
  els.confirmModal.classList.remove("open");
  render();
});

els.chatToggle.addEventListener("click", () => {
  els.chatPanel.classList.toggle("open");
  if (!els.chatMessages.children.length) {
    pushMessage("bot", "Hola. Puedo ayudarte con totales, ventas por periodo, grafica mensual y la mejor venta registrada.");
  }
});

els.chatClose.addEventListener("click", () => els.chatPanel.classList.remove("open"));

els.chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const question = els.chatInput.value.trim();
  if (!question) return;
  pushMessage("user", question);
  pushMessage("bot", answerQuestion(question));
  els.chatInput.value = "";
});

render();
