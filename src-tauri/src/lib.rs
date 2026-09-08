use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use chrono::{Local, Utc};
use rand_core::OsRng;
use rusqlite::{params, Connection, OpenFlags, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};
use tauri_plugin_sql::{Migration, MigrationKind};
use uuid::Uuid;

const SCHEMA: &str = include_str!("../migrations/0001_initial.sql");
const DB_NAME: &str = "pos.db";
const BACKUP_KEEP: usize = 30;

type CmdResult<T> = Result<T, String>;
fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}
fn id() -> String {
    Uuid::new_v4().to_string()
}
fn now() -> String {
    Utc::now().to_rfc3339()
}

#[derive(Debug, Serialize, Clone)]
pub struct Settings {
    business_name: String,
    currency: String,
    currency_symbol: String,
    currency_decimals: i64,
    tax_basis_points: i64,
    printer_name: Option<String>,
}
#[derive(Serialize)]
struct Boot {
    configured: bool,
    settings: Settings,
}
#[derive(Deserialize)]
struct SetupPayload {
    business_name: String,
    currency: String,
    currency_symbol: String,
    currency_decimals: i64,
    tax_basis_points: i64,
    admin_name: String,
    pin: String,
    printer_name: Option<String>,
}
#[derive(Serialize)]
struct UserSession {
    id: String,
    name: String,
    role: String,
}
#[derive(Serialize)]
struct UserRow {
    id: String,
    name: String,
    role: String,
    active: bool,
    created_at: String,
}
#[derive(Deserialize)]
struct ProductPayload {
    name: String,
    sku: Option<String>,
    barcode: Option<String>,
    price_minor: i64,
    cost_minor: i64,
    stock_quantity: i64,
    min_stock: i64,
}
#[derive(Serialize)]
struct ProductRow {
    id: String,
    name: String,
    sku: Option<String>,
    barcode: Option<String>,
    category_name: Option<String>,
    price_minor: i64,
    cost_minor: i64,
    stock_quantity: i64,
    min_stock: i64,
    track_stock: bool,
    active: bool,
}
#[derive(Deserialize)]
struct SaleLineInput {
    product_id: String,
    quantity: i64,
}
#[derive(Deserialize)]
struct PaymentInput {
    method: String,
    amount_minor: i64,
    reference: Option<String>,
}
#[derive(Deserialize)]
struct SalePayload {
    customer_id: Option<String>,
    user_id: String,
    items: Vec<SaleLineInput>,
    payments: Vec<PaymentInput>,
    amount_received_minor: i64,
}
#[derive(Serialize)]
struct SaleResult {
    id: String,
    sale_number: String,
    total_minor: i64,
    change_minor: i64,
}
#[derive(Serialize, Clone)]
struct SaleRow {
    id: String,
    sale_number: String,
    created_at: String,
    item_count: i64,
    payment_method: String,
    total_minor: i64,
}
#[derive(Serialize)]
struct Dashboard {
    today_revenue_minor: i64,
    today_transactions: i64,
    today_units: i64,
    cash_expected_minor: i64,
    cash_open: bool,
    low_stock_count: i64,
    recent_sales: Vec<SaleRow>,
}
#[derive(Deserialize)]
struct OpenCashPayload {
    opening_amount_minor: i64,
    notes: Option<String>,
    user_id: String,
}
#[derive(Deserialize)]
struct CloseCashPayload {
    counted_amount_minor: i64,
    notes: Option<String>,
    user_id: String,
}
#[derive(Serialize)]
struct CashStatus {
    is_open: bool,
    session_id: Option<String>,
    opening_amount_minor: i64,
    cash_sales_minor: i64,
    movements_minor: i64,
    expected_amount_minor: i64,
}
#[derive(Deserialize)]
struct CashMovementPayload {
    movement_type: String,
    amount_minor: i64,
    description: String,
    user_id: String,
}
#[derive(Deserialize)]
struct CustomerPayload {
    name: String,
    document: Option<String>,
    phone: Option<String>,
    email: Option<String>,
}
#[derive(Serialize)]
struct CustomerRow {
    id: String,
    name: String,
    document: Option<String>,
    phone: Option<String>,
    email: Option<String>,
    created_at: String,
}
#[derive(Deserialize)]
struct ExpensePayload {
    category: String,
    description: String,
    amount_minor: i64,
    user_id: String,
}
#[derive(Serialize)]
struct ExpenseRow {
    id: String,
    category: String,
    description: String,
    amount_minor: i64,
    created_at: String,
}
#[derive(Deserialize)]
struct SettingsPayload {
    business_name: String,
    currency_symbol: String,
    tax_basis_points: i64,
}
#[derive(Serialize)]
struct BackupRow {
    id: String,
    file_name: String,
    path: String,
    size_bytes: i64,
    kind: String,
    status: String,
    created_at: String,
}
#[derive(Serialize)]
struct Diagnostics {
    database_ok: bool,
    app_version: String,
    last_backup_at: Option<String>,
    data_path: String,
}

fn data_dir(app: &AppHandle) -> CmdResult<PathBuf> {
    // El plugin SQL de Tauri resuelve `sqlite:pos.db` bajo app_config_dir.
    // Usamos la misma ruta para garantizar una única fuente de verdad.
    let path = app.path().app_config_dir().map_err(err)?;
    fs::create_dir_all(&path).map_err(err)?;
    Ok(path)
}
fn db_path(app: &AppHandle) -> CmdResult<PathBuf> {
    Ok(data_dir(app)?.join(DB_NAME))
}
fn connect(app: &AppHandle) -> CmdResult<Connection> {
    let conn = Connection::open(db_path(app)?).map_err(err)?;
    configure(&conn)?;
    Ok(conn)
}
fn configure(conn: &Connection) -> CmdResult<()> {
    conn.execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000;").map_err(err)
}
fn ensure_schema(conn: &Connection) -> CmdResult<()> {
    conn.execute_batch(SCHEMA).map_err(err)
}
fn settings(conn: &Connection) -> CmdResult<(bool, Settings)> {
    conn.query_row("SELECT configured,business_name,currency,currency_symbol,currency_decimals,tax_basis_points,printer_name FROM settings WHERE id=1", [], |r| Ok((r.get::<_, i64>(0)? == 1, Settings { business_name:r.get(1)?, currency:r.get(2)?, currency_symbol:r.get(3)?, currency_decimals:r.get(4)?, tax_basis_points:r.get(5)?, printer_name:r.get(6)? }))).map_err(err)
}
fn validate_pin(pin: &str) -> CmdResult<()> {
    if (4..=8).contains(&pin.len()) && pin.chars().all(|c| c.is_ascii_digit()) {
        Ok(())
    } else {
        Err("El PIN debe tener entre 4 y 8 dígitos.".into())
    }
}
fn hash_pin(pin: &str) -> CmdResult<String> {
    validate_pin(pin)?;
    Argon2::default()
        .hash_password(pin.as_bytes(), &SaltString::generate(&mut OsRng))
        .map(|h| h.to_string())
        .map_err(err)
}

#[tauri::command]
fn initialize_app(app: AppHandle) -> CmdResult<Boot> {
    let conn = connect(&app)?;
    ensure_schema(&conn)?;
    let (configured, settings) = settings(&conn)?;
    Ok(Boot {
        configured,
        settings,
    })
}

#[tauri::command]
fn complete_setup(app: AppHandle, payload: SetupPayload) -> CmdResult<()> {
    if payload.business_name.trim().is_empty() || payload.admin_name.trim().is_empty() {
        return Err("Completa el nombre del negocio y del administrador.".into());
    }
    if !(0..=10_000).contains(&payload.tax_basis_points)
        || !(0..=4).contains(&payload.currency_decimals)
    {
        return Err("La configuración monetaria no es válida.".into());
    }
    let password_hash = hash_pin(&payload.pin)?;
    let mut conn = connect(&app)?;
    ensure_schema(&conn)?;
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(err)?;
    let configured: i64 = tx
        .query_row("SELECT configured FROM settings WHERE id=1", [], |r| {
            r.get(0)
        })
        .map_err(err)?;
    if configured == 1 {
        return Err("La configuración inicial ya fue completada.".into());
    }
    tx.execute("UPDATE settings SET business_name=?1,currency=?2,currency_symbol=?3,currency_decimals=?4,tax_basis_points=?5,printer_name=?6,configured=1,updated_at=?7 WHERE id=1", params![payload.business_name.trim(),payload.currency.trim(),payload.currency_symbol.trim(),payload.currency_decimals,payload.tax_basis_points,payload.printer_name,now()]).map_err(err)?;
    let user_id = id();
    tx.execute(
        "INSERT INTO users(id,name,role,password_hash,active) VALUES(?1,?2,'admin',?3,1)",
        params![user_id, payload.admin_name.trim(), password_hash],
    )
    .map_err(err)?;
    let category_id = id();
    tx.execute(
        "INSERT INTO categories(id,name) VALUES(?1,'Vikingos')",
        [&category_id],
    )
    .map_err(err)?;
    let product_id = id();
    tx.execute("INSERT INTO products(id,category_id,name,sku,price_minor,cost_minor,stock_quantity,min_stock) VALUES(?1,?2,'Vikingo','VIK-001',5000,0,100,10)",params![product_id,category_id]).map_err(err)?;
    tx.execute("INSERT INTO inventory_movements(id,product_id,user_id,type,quantity,stock_after,notes) VALUES(?1,?2,?3,'initial',100,100,'Inventario inicial')",params![id(),product_id,user_id]).map_err(err)?;
    tx.commit().map_err(err)
}

#[tauri::command]
fn login(app: AppHandle, pin: String) -> CmdResult<UserSession> {
    let conn = connect(&app)?;
    let mut stmt=conn.prepare("SELECT id,name,role,password_hash FROM users WHERE active=1 ORDER BY role='admin' DESC").map_err(err)?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
            ))
        })
        .map_err(err)?;
    for row in rows {
        let (id, name, role, hash) = row.map_err(err)?;
        if let Ok(parsed) = PasswordHash::new(&hash) {
            if Argon2::default()
                .verify_password(pin.as_bytes(), &parsed)
                .is_ok()
            {
                return Ok(UserSession { id, name, role });
            }
        }
    }
    Err("PIN incorrecto.".into())
}

#[tauri::command]
fn list_products(app: AppHandle) -> CmdResult<Vec<ProductRow>> {
    let conn = connect(&app)?;
    let mut stmt=conn.prepare("SELECT p.id,p.name,p.sku,p.barcode,c.name,p.price_minor,p.cost_minor,p.stock_quantity,p.min_stock,p.track_stock,p.active FROM products p LEFT JOIN categories c ON c.id=p.category_id ORDER BY p.active DESC,p.name COLLATE NOCASE").map_err(err)?;
    let result = stmt
        .query_map([], |r| {
            Ok(ProductRow {
                id: r.get(0)?,
                name: r.get(1)?,
                sku: r.get(2)?,
                barcode: r.get(3)?,
                category_name: r.get(4)?,
                price_minor: r.get(5)?,
                cost_minor: r.get(6)?,
                stock_quantity: r.get(7)?,
                min_stock: r.get(8)?,
                track_stock: r.get::<_, i64>(9)? == 1,
                active: r.get::<_, i64>(10)? == 1,
            })
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err);
    result
}

#[tauri::command]
fn create_product(app: AppHandle, payload: ProductPayload) -> CmdResult<String> {
    if payload.name.trim().is_empty()
        || payload.price_minor < 0
        || payload.cost_minor < 0
        || payload.stock_quantity < 0
        || payload.min_stock < 0
    {
        return Err("Revisa los datos del producto.".into());
    }
    let mut conn = connect(&app)?;
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(err)?;
    let product_id = id();
    tx.execute("INSERT INTO products(id,name,sku,barcode,price_minor,cost_minor,stock_quantity,min_stock) VALUES(?1,?2,NULLIF(?3,''),NULLIF(?4,''),?5,?6,?7,?8)",params![product_id,payload.name.trim(),payload.sku.unwrap_or_default().trim(),payload.barcode.unwrap_or_default().trim(),payload.price_minor,payload.cost_minor,payload.stock_quantity,payload.min_stock]).map_err(|e| if e.to_string().contains("UNIQUE") { "El SKU o código de barras ya existe.".into() } else { err(e) })?;
    if payload.stock_quantity > 0 {
        tx.execute("INSERT INTO inventory_movements(id,product_id,type,quantity,stock_after,notes) VALUES(?1,?2,'initial',?3,?3,'Inventario inicial')",params![id(),product_id,payload.stock_quantity]).map_err(err)?;
    }
    tx.commit().map_err(err)?;
    Ok(product_id)
}

fn query_sales(conn: &Connection, limit: i64) -> CmdResult<Vec<SaleRow>> {
    let mut stmt=conn.prepare("SELECT s.id,s.sale_number,s.created_at,COALESCE(SUM(si.quantity),0),COALESCE(GROUP_CONCAT(DISTINCT p.method),'other'),s.total_minor FROM sales s LEFT JOIN sale_items si ON si.sale_id=s.id LEFT JOIN payments p ON p.sale_id=s.id GROUP BY s.id ORDER BY s.created_at DESC LIMIT ?1").map_err(err)?;
    let result = stmt
        .query_map([limit], |r| {
            Ok(SaleRow {
                id: r.get(0)?,
                sale_number: r.get(1)?,
                created_at: r.get(2)?,
                item_count: r.get(3)?,
                payment_method: r.get(4)?,
                total_minor: r.get(5)?,
            })
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err);
    result
}

#[tauri::command]
fn list_sales(app: AppHandle, limit: Option<i64>) -> CmdResult<Vec<SaleRow>> {
    query_sales(&connect(&app)?, limit.unwrap_or(250).clamp(1, 2000))
}

#[tauri::command]
fn create_sale(app: AppHandle, payload: SalePayload) -> CmdResult<SaleResult> {
    if payload.items.is_empty() || payload.payments.is_empty() {
        return Err("La venta no tiene productos o pagos.".into());
    }
    if payload.items.iter().any(|i| i.quantity <= 0)
        || payload.payments.iter().any(|p| p.amount_minor <= 0)
    {
        return Err("Las cantidades e importes deben ser mayores que cero.".into());
    }
    let mut conn = connect(&app)?;
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(err)?;
    let user_exists: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM users WHERE id=?1 AND active=1)",
            [&payload.user_id],
            |r| r.get(0),
        )
        .map_err(err)?;
    if !user_exists {
        return Err("El usuario no está activo.".into());
    }
    let cash_session_id: Option<String> = tx
        .query_row(
            "SELECT id FROM cash_sessions WHERE status='open' LIMIT 1",
            [],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    if payload.payments.iter().any(|p| p.method == "cash") && cash_session_id.is_none() {
        return Err("Abre la caja antes de recibir pagos en efectivo.".into());
    }
    let mut subtotal = 0i64;
    let mut tax_total = 0i64;
    let mut lines = Vec::new();
    for input in &payload.items {
        let product:(String,i64,i64,i64,bool)=tx.query_row("SELECT name,price_minor,stock_quantity,min_stock,track_stock=1 FROM products WHERE id=?1 AND active=1",[&input.product_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).optional().map_err(err)?.ok_or("Producto no disponible.")?;
        if product.4 && product.2 < input.quantity {
            return Err(format!("Stock insuficiente para {}.", product.0));
        }
        let tax_bp: i64 = tx
            .query_row(
                "SELECT tax_basis_points FROM settings WHERE id=1",
                [],
                |r| r.get(0),
            )
            .map_err(err)?;
        let base = product
            .1
            .checked_mul(input.quantity)
            .ok_or("Importe fuera de rango.")?;
        let tax = (base * tax_bp + 5000) / 10000;
        subtotal += base;
        tax_total += tax;
        lines.push((input, product, tax_bp, tax, base + tax));
    }
    let total = subtotal + tax_total;
    let paid: i64 = payload.payments.iter().map(|p| p.amount_minor).sum();
    if paid != total {
        return Err("La suma de los pagos debe coincidir con el total.".into());
    }
    let cash_paid: i64 = payload
        .payments
        .iter()
        .filter(|p| p.method == "cash")
        .map(|p| p.amount_minor)
        .sum();
    let change = (payload.amount_received_minor - cash_paid).max(0);
    if cash_paid > 0 && payload.amount_received_minor < cash_paid {
        return Err("El efectivo recibido es insuficiente.".into());
    }
    let sale_id = id();
    let sequence: i64 = tx
        .query_row(
            "SELECT COUNT(*)+1 FROM sales WHERE substr(created_at,1,10)=date('now')",
            [],
            |r| r.get(0),
        )
        .map_err(err)?;
    let sale_number = format!("VKI-{}-{:04}", Local::now().format("%Y%m%d"), sequence);
    tx.execute("INSERT INTO sales(id,sale_number,customer_id,user_id,cash_session_id,subtotal_minor,tax_minor,total_minor) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",params![sale_id,sale_number,payload.customer_id,payload.user_id,cash_session_id,subtotal,tax_total,total]).map_err(err)?;
    for (input, product, tax_bp, tax, line_total) in lines {
        tx.execute("INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,unit_price_minor,tax_basis_points,tax_minor,line_total_minor) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",params![id(),sale_id,input.product_id,product.0,input.quantity,product.1,tax_bp,tax,line_total]).map_err(err)?;
        if product.4 {
            let new_stock = product.2 - input.quantity;
            tx.execute(
                "UPDATE products SET stock_quantity=?1,updated_at=?2 WHERE id=?3",
                params![new_stock, now(), input.product_id],
            )
            .map_err(err)?;
            tx.execute("INSERT INTO inventory_movements(id,product_id,sale_id,user_id,type,quantity,stock_after,notes) VALUES(?1,?2,?3,?4,'sale',?5,?6,?7)",params![id(),input.product_id,sale_id,payload.user_id,-input.quantity,new_stock,sale_number]).map_err(err)?;
        }
    }
    for payment in &payload.payments {
        if !matches!(
            payment.method.as_str(),
            "cash" | "card" | "transfer" | "mixed" | "other"
        ) {
            return Err("Método de pago no válido.".into());
        }
        tx.execute(
            "INSERT INTO payments(id,sale_id,method,amount_minor,reference) VALUES(?1,?2,?3,?4,?5)",
            params![
                id(),
                sale_id,
                payment.method,
                payment.amount_minor,
                payment.reference
            ],
        )
        .map_err(err)?;
    }
    if cash_paid > 0 {
        tx.execute("INSERT INTO cash_movements(id,cash_session_id,user_id,sale_id,type,amount_minor,description) VALUES(?1,?2,?3,?4,'sale',?5,?6)",params![id(),cash_session_id,payload.user_id,sale_id,cash_paid,sale_number]).map_err(err)?;
    }
    tx.commit().map_err(err)?;
    Ok(SaleResult {
        id: sale_id,
        sale_number,
        total_minor: total,
        change_minor: change,
    })
}

fn cash_status_conn(conn: &Connection) -> CmdResult<CashStatus> {
    let row: Option<(String, i64)> = conn
        .query_row(
            "SELECT id,opening_amount_minor FROM cash_sessions WHERE status='open' LIMIT 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(err)?;
    if let Some((session_id, opening)) = row {
        let cash_sales:i64=conn.query_row("SELECT COALESCE(SUM(amount_minor),0) FROM cash_movements WHERE cash_session_id=?1 AND type='sale'",[&session_id],|r|r.get(0)).map_err(err)?;
        let movements:i64=conn.query_row("SELECT COALESCE(SUM(amount_minor),0) FROM cash_movements WHERE cash_session_id=?1 AND type IN ('income','withdrawal','expense')",[&session_id],|r|r.get(0)).map_err(err)?;
        Ok(CashStatus {
            is_open: true,
            session_id: Some(session_id),
            opening_amount_minor: opening,
            cash_sales_minor: cash_sales,
            movements_minor: movements,
            expected_amount_minor: opening + cash_sales + movements,
        })
    } else {
        Ok(CashStatus {
            is_open: false,
            session_id: None,
            opening_amount_minor: 0,
            cash_sales_minor: 0,
            movements_minor: 0,
            expected_amount_minor: 0,
        })
    }
}

#[tauri::command]
fn cash_status(app: AppHandle) -> CmdResult<CashStatus> {
    cash_status_conn(&connect(&app)?)
}
#[tauri::command]
fn open_cash_session(app: AppHandle, payload: OpenCashPayload) -> CmdResult<()> {
    if payload.opening_amount_minor < 0 {
        return Err("El monto inicial no puede ser negativo.".into());
    }
    let mut conn = connect(&app)?;
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(err)?;
    let exists: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM cash_sessions WHERE status='open')",
            [],
            |r| r.get(0),
        )
        .map_err(err)?;
    if exists {
        return Err("Ya existe una caja abierta.".into());
    }
    let sid = id();
    tx.execute(
        "INSERT INTO cash_sessions(id,user_id,opening_amount_minor,notes) VALUES(?1,?2,?3,?4)",
        params![
            sid,
            payload.user_id,
            payload.opening_amount_minor,
            payload.notes
        ],
    )
    .map_err(err)?;
    tx.execute("INSERT INTO cash_movements(id,cash_session_id,user_id,type,amount_minor,description) VALUES(?1,?2,?3,'opening',?4,'Apertura de caja')",params![id(),sid,payload.user_id,payload.opening_amount_minor]).map_err(err)?;
    tx.commit().map_err(err)
}
#[tauri::command]
fn close_cash_session(app: AppHandle, payload: CloseCashPayload) -> CmdResult<()> {
    if payload.counted_amount_minor < 0 {
        return Err("El efectivo contado no puede ser negativo.".into());
    }
    let mut conn = connect(&app)?;
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(err)?;
    let status = cash_status_conn(&tx)?;
    let sid = status.session_id.ok_or("No hay una caja abierta.")?;
    let difference = payload.counted_amount_minor - status.expected_amount_minor;
    tx.execute("UPDATE cash_sessions SET closed_at=?1,expected_amount_minor=?2,counted_amount_minor=?3,difference_minor=?4,notes=COALESCE(?5,notes),status='closed' WHERE id=?6",params![now(),status.expected_amount_minor,payload.counted_amount_minor,difference,payload.notes,sid]).map_err(err)?;
    tx.execute("INSERT INTO cash_movements(id,cash_session_id,user_id,type,amount_minor,description) VALUES(?1,?2,?3,'closing',0,'Cierre de caja')",params![id(),sid,payload.user_id]).map_err(err)?;
    tx.commit().map_err(err)
}

#[tauri::command]
fn add_cash_movement(app: AppHandle, payload: CashMovementPayload) -> CmdResult<()> {
    if payload.amount_minor <= 0 || payload.description.trim().is_empty() {
        return Err("Completa el monto y el motivo del movimiento.".into());
    }
    if !matches!(payload.movement_type.as_str(), "income" | "withdrawal") {
        return Err("Tipo de movimiento no válido.".into());
    }
    let conn = connect(&app)?;
    let session_id: String = conn
        .query_row(
            "SELECT id FROM cash_sessions WHERE status='open' LIMIT 1",
            [],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?
        .ok_or("Abre la caja antes de registrar movimientos.")?;
    let signed_amount = if payload.movement_type == "withdrawal" {
        -payload.amount_minor
    } else {
        payload.amount_minor
    };
    conn.execute(
        "INSERT INTO cash_movements(id,cash_session_id,user_id,type,amount_minor,description) VALUES(?1,?2,?3,?4,?5,?6)",
        params![id(), session_id, payload.user_id, payload.movement_type, signed_amount, payload.description.trim()],
    ).map_err(err)?;
    Ok(())
}

#[tauri::command]
fn list_customers(app: AppHandle) -> CmdResult<Vec<CustomerRow>> {
    let conn = connect(&app)?;
    let mut stmt = conn.prepare("SELECT id,name,document,phone,email,created_at FROM customers WHERE active=1 ORDER BY name COLLATE NOCASE").map_err(err)?;
    let result = stmt
        .query_map([], |r| {
            Ok(CustomerRow {
                id: r.get(0)?,
                name: r.get(1)?,
                document: r.get(2)?,
                phone: r.get(3)?,
                email: r.get(4)?,
                created_at: r.get(5)?,
            })
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err);
    result
}

#[tauri::command]
fn create_customer(app: AppHandle, payload: CustomerPayload) -> CmdResult<String> {
    if payload.name.trim().is_empty() {
        return Err("El nombre del cliente es obligatorio.".into());
    }
    let conn = connect(&app)?;
    let customer_id = id();
    conn.execute("INSERT INTO customers(id,name,document,phone,email) VALUES(?1,?2,NULLIF(?3,''),NULLIF(?4,''),NULLIF(?5,''))", params![customer_id,payload.name.trim(),payload.document.unwrap_or_default().trim(),payload.phone.unwrap_or_default().trim(),payload.email.unwrap_or_default().trim()])
        .map_err(|e| if e.to_string().contains("UNIQUE") { "Ese documento ya está registrado.".into() } else { err(e) })?;
    Ok(customer_id)
}

#[tauri::command]
fn list_expenses(app: AppHandle) -> CmdResult<Vec<ExpenseRow>> {
    let conn = connect(&app)?;
    let mut stmt = conn.prepare("SELECT id,category,description,amount_minor,created_at FROM expenses ORDER BY created_at DESC LIMIT 500").map_err(err)?;
    let result = stmt
        .query_map([], |r| {
            Ok(ExpenseRow {
                id: r.get(0)?,
                category: r.get(1)?,
                description: r.get(2)?,
                amount_minor: r.get(3)?,
                created_at: r.get(4)?,
            })
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err);
    result
}

#[tauri::command]
fn create_expense(app: AppHandle, payload: ExpensePayload) -> CmdResult<String> {
    if payload.amount_minor <= 0
        || payload.category.trim().is_empty()
        || payload.description.trim().is_empty()
    {
        return Err("Completa categoría, descripción y monto.".into());
    }
    let mut conn = connect(&app)?;
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(err)?;
    let session_id: String = tx
        .query_row(
            "SELECT id FROM cash_sessions WHERE status='open' LIMIT 1",
            [],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?
        .ok_or("Abre la caja antes de registrar un gasto.")?;
    let expense_id = id();
    tx.execute("INSERT INTO expenses(id,cash_session_id,user_id,category,description,amount_minor) VALUES(?1,?2,?3,?4,?5,?6)", params![expense_id,session_id,payload.user_id,payload.category.trim(),payload.description.trim(),payload.amount_minor]).map_err(err)?;
    tx.execute("INSERT INTO cash_movements(id,cash_session_id,user_id,type,amount_minor,description) VALUES(?1,?2,?3,'expense',?4,?5)", params![id(),session_id,payload.user_id,-payload.amount_minor,payload.description.trim()]).map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(expense_id)
}

#[tauri::command]
fn dashboard_summary(app: AppHandle) -> CmdResult<Dashboard> {
    let conn = connect(&app)?;
    let (revenue,transactions,units):(i64,i64,i64)=conn.query_row("SELECT COALESCE(SUM(s.total_minor),0),COUNT(*),COALESCE(SUM((SELECT SUM(quantity) FROM sale_items WHERE sale_id=s.id)),0) FROM sales s WHERE date(s.created_at)=date('now') AND s.status='completed'",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(err)?;
    let low:i64=conn.query_row("SELECT COUNT(*) FROM products WHERE active=1 AND track_stock=1 AND stock_quantity<=min_stock",[],|r|r.get(0)).map_err(err)?;
    let cash = cash_status_conn(&conn)?;
    Ok(Dashboard {
        today_revenue_minor: revenue,
        today_transactions: transactions,
        today_units: units,
        cash_expected_minor: cash.expected_amount_minor,
        cash_open: cash.is_open,
        low_stock_count: low,
        recent_sales: query_sales(&conn, 8)?,
    })
}

#[tauri::command]
fn list_users(app: AppHandle) -> CmdResult<Vec<UserRow>> {
    let conn = connect(&app)?;
    let mut stmt = conn
        .prepare("SELECT id,name,role,active,created_at FROM users ORDER BY active DESC,name")
        .map_err(err)?;
    let result = stmt
        .query_map([], |r| {
            Ok(UserRow {
                id: r.get(0)?,
                name: r.get(1)?,
                role: r.get(2)?,
                active: r.get::<_, i64>(3)? == 1,
                created_at: r.get(4)?,
            })
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err);
    result
}

#[tauri::command]
fn update_settings(app: AppHandle, payload: SettingsPayload) -> CmdResult<Settings> {
    if payload.business_name.trim().is_empty()
        || payload.currency_symbol.trim().is_empty()
        || !(0..=10000).contains(&payload.tax_basis_points)
    {
        return Err("Revisa los datos de configuración.".into());
    }
    let conn = connect(&app)?;
    conn.execute("UPDATE settings SET business_name=?1,currency_symbol=?2,tax_basis_points=?3,updated_at=?4 WHERE id=1",params![payload.business_name.trim(),payload.currency_symbol.trim(),payload.tax_basis_points,now()]).map_err(err)?;
    Ok(settings(&conn)?.1)
}

fn validate_database(path: &Path) -> CmdResult<()> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|_| "No se pudo abrir la copia como base SQLite válida.".to_string())?;
    let integrity: String = conn
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .map_err(err)?;
    if integrity != "ok" {
        return Err(format!("La copia no superó la validación: {integrity}"));
    }
    let required:i64=conn.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('settings','sales','products','backup_history')",[],|r|r.get(0)).map_err(err)?;
    if required != 4 {
        return Err("La copia no pertenece a Vikingos Indira POS.".into());
    }
    Ok(())
}
fn create_backup_kind(app: &AppHandle, kind: &str) -> CmdResult<BackupRow> {
    let dir = data_dir(app)?.join("Backups");
    fs::create_dir_all(&dir).map_err(err)?;
    let stamp = Local::now().format("%Y-%m-%d-%H%M%S");
    let file_name = format!("backup-{stamp}.db");
    let path = dir.join(&file_name);
    let conn = connect(app)?;
    conn.execute("PRAGMA wal_checkpoint(FULL)", [])
        .map_err(err)?;
    conn.execute("VACUUM INTO ?1", [path.to_string_lossy().as_ref()])
        .map_err(err)?;
    validate_database(&path)?;
    let size = fs::metadata(&path).map_err(err)?.len() as i64;
    let bid = id();
    let created = now();
    conn.execute("INSERT INTO backup_history(id,file_name,path,size_bytes,kind,status,created_at) VALUES(?1,?2,?3,?4,?5,'ok',?6)",params![bid,file_name,path.to_string_lossy(),size,kind,created]).map_err(err)?;
    rotate_backups(&conn)?;
    Ok(BackupRow {
        id: bid,
        file_name,
        path: path.to_string_lossy().into(),
        size_bytes: size,
        kind: kind.into(),
        status: "ok".into(),
        created_at: created,
    })
}
fn rotate_backups(conn: &Connection) -> CmdResult<()> {
    let mut stmt=conn.prepare("SELECT id,path FROM backup_history WHERE status='ok' AND kind!='pre_restore' ORDER BY created_at DESC LIMIT -1 OFFSET ?1").map_err(err)?;
    let old = stmt
        .query_map([BACKUP_KEEP as i64], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    for (id, path) in old {
        let _ = fs::remove_file(&path);
        conn.execute("DELETE FROM backup_history WHERE id=?1", [id])
            .map_err(err)?;
    }
    Ok(())
}

#[tauri::command]
fn create_backup(app: AppHandle) -> CmdResult<BackupRow> {
    create_backup_kind(&app, "manual")
}
#[tauri::command]
fn list_backups(app: AppHandle) -> CmdResult<Vec<BackupRow>> {
    let conn = connect(&app)?;
    let mut stmt=conn.prepare("SELECT id,file_name,path,size_bytes,kind,status,created_at FROM backup_history ORDER BY created_at DESC LIMIT 100").map_err(err)?;
    let result = stmt
        .query_map([], |r| {
            Ok(BackupRow {
                id: r.get(0)?,
                file_name: r.get(1)?,
                path: r.get(2)?,
                size_bytes: r.get(3)?,
                kind: r.get(4)?,
                status: r.get(5)?,
                created_at: r.get(6)?,
            })
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err);
    result
}
#[tauri::command]
fn restore_backup(app: AppHandle, path: String) -> CmdResult<()> {
    let source = PathBuf::from(&path);
    validate_database(&source)?;
    let _safety = create_backup_kind(&app, "pre_restore")?;
    let target = db_path(&app)?;
    let temp = target.with_extension("restore.tmp");
    fs::copy(&source, &temp).map_err(err)?;
    validate_database(&temp)?;
    let old = target.with_extension("before-restore");
    if old.exists() {
        fs::remove_file(&old).map_err(err)?;
    }
    fs::rename(&target, &old)
        .map_err(|e| format!("Cierra las operaciones activas e intenta de nuevo: {e}"))?;
    if let Err(e) = fs::rename(&temp, &target) {
        let _ = fs::rename(&old, &target);
        return Err(format!("No fue posible completar la restauración: {e}"));
    }
    let _ = fs::remove_file(&old);
    let _ = fs::remove_file(target.with_extension("db-wal"));
    let _ = fs::remove_file(target.with_extension("db-shm"));
    Ok(())
}

#[tauri::command]
fn diagnostics(app: AppHandle) -> CmdResult<Diagnostics> {
    let path = db_path(&app)?;
    let conn = connect(&app)?;
    let quick: String = conn
        .query_row("PRAGMA quick_check", [], |r| r.get(0))
        .map_err(err)?;
    let last:Option<String>=conn.query_row("SELECT created_at FROM backup_history WHERE status='ok' ORDER BY created_at DESC LIMIT 1",[],|r|r.get(0)).optional().map_err(err)?;
    Ok(Diagnostics {
        database_ok: quick == "ok",
        app_version: app.package_info().version.to_string(),
        last_backup_at: last,
        data_path: path.to_string_lossy().into(),
    })
}

#[tauri::command]
fn suggest_export_path(app: AppHandle, kind: String) -> CmdResult<String> {
    let dir = data_dir(&app)?.join("Exports");
    fs::create_dir_all(&dir).map_err(err)?;
    Ok(dir
        .join(format!(
            "{}-{}.csv",
            kind,
            Local::now().format("%Y-%m-%d-%H%M%S")
        ))
        .to_string_lossy()
        .into())
}
#[tauri::command]
fn export_csv(app: AppHandle, kind: String, destination: String) -> CmdResult<()> {
    let conn = connect(&app)?;
    let mut writer = csv::WriterBuilder::new()
        .delimiter(b';')
        .from_path(destination)
        .map_err(err)?;
    match kind.as_str() {
        "sales" => {
            writer
                .write_record(["numero", "fecha", "subtotal", "impuesto", "total", "estado"])
                .map_err(err)?;
            let mut s=conn.prepare("SELECT sale_number,created_at,subtotal_minor,tax_minor,total_minor,status FROM sales ORDER BY created_at DESC").map_err(err)?;
            for row in s
                .query_map([], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, i64>(2)?,
                        r.get::<_, i64>(3)?,
                        r.get::<_, i64>(4)?,
                        r.get::<_, String>(5)?,
                    ))
                })
                .map_err(err)?
            {
                let r = row.map_err(err)?;
                writer
                    .write_record([
                        r.0,
                        r.1,
                        r.2.to_string(),
                        r.3.to_string(),
                        r.4.to_string(),
                        r.5,
                    ])
                    .map_err(err)?;
            }
        }
        "products" | "inventory" => {
            writer
                .write_record([
                    "nombre",
                    "sku",
                    "codigo_barras",
                    "precio",
                    "costo",
                    "stock",
                    "stock_minimo",
                    "activo",
                ])
                .map_err(err)?;
            let mut s=conn.prepare("SELECT name,COALESCE(sku,''),COALESCE(barcode,''),price_minor,cost_minor,stock_quantity,min_stock,active FROM products ORDER BY name").map_err(err)?;
            for row in s
                .query_map([], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, i64>(3)?,
                        r.get::<_, i64>(4)?,
                        r.get::<_, i64>(5)?,
                        r.get::<_, i64>(6)?,
                        r.get::<_, i64>(7)?,
                    ))
                })
                .map_err(err)?
            {
                let r = row.map_err(err)?;
                writer
                    .write_record([
                        r.0,
                        r.1,
                        r.2,
                        r.3.to_string(),
                        r.4.to_string(),
                        r.5.to_string(),
                        r.6.to_string(),
                        r.7.to_string(),
                    ])
                    .map_err(err)?;
            }
        }
        _ => return Err("Tipo de exportación no válido.".into()),
    }
    writer.flush().map_err(err)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![Migration {
        version: 1,
        description: "initial_schema",
        sql: SCHEMA,
        kind: MigrationKind::Up,
    }];
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:pos.db", migrations)
                .build(),
        )
        .setup(|app| {
            let handle = app.handle().clone();
            let conn = connect(&handle).map_err(std::io::Error::other)?;
            ensure_schema(&conn).map_err(std::io::Error::other)?;
            log::info!("Aplicación iniciada; almacenamiento local preparado");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            initialize_app,
            complete_setup,
            login,
            list_products,
            create_product,
            list_sales,
            create_sale,
            dashboard_summary,
            cash_status,
            open_cash_session,
            close_cash_session,
            add_cash_movement,
            list_customers,
            create_customer,
            list_expenses,
            create_expense,
            list_users,
            update_settings,
            create_backup,
            list_backups,
            restore_backup,
            diagnostics,
            suggest_export_path,
            export_csv
        ])
        .run(tauri::generate_context!())
        .expect("error al ejecutar Vikingos Indira POS");
}

#[cfg(test)]
mod tests {
    use super::*;
    fn memory_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        configure(&conn).unwrap();
        ensure_schema(&conn).unwrap();
        conn
    }
    #[test]
    fn creates_new_database() {
        let conn = memory_db();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='sales'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }
    #[test]
    fn schema_enforces_non_negative_stock() {
        let conn = memory_db();
        let result = conn.execute(
            "INSERT INTO products(id,name,price_minor,stock_quantity) VALUES('p','P',1,-1)",
            [],
        );
        assert!(result.is_err());
    }
    #[test]
    fn transaction_rolls_back_failed_sale() {
        let mut conn = memory_db();
        let tx = conn.transaction().unwrap();
        tx.execute(
            "INSERT INTO users(id,name,role,password_hash) VALUES('u','U','admin','x')",
            [],
        )
        .unwrap();
        tx.execute("INSERT INTO sales(id,sale_number,user_id,subtotal_minor,total_minor) VALUES('s','1','u',10,10)",[]).unwrap();
        drop(tx);
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM sales", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }
    #[test]
    fn cash_allows_only_one_open_session() {
        let conn = memory_db();
        conn.execute(
            "INSERT INTO users(id,name,role,password_hash) VALUES('u','U','admin','x')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO cash_sessions(id,user_id,opening_amount_minor) VALUES('1','u',0)",
            [],
        )
        .unwrap();
        assert!(conn
            .execute(
                "INSERT INTO cash_sessions(id,user_id,opening_amount_minor) VALUES('2','u',0)",
                []
            )
            .is_err());
    }

    #[test]
    fn creates_and_validates_consistent_backup() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("source.db");
        let backup = dir.path().join("backup.db");
        let conn = Connection::open(&source).unwrap();
        configure(&conn).unwrap();
        ensure_schema(&conn).unwrap();
        conn.execute("VACUUM INTO ?1", [backup.to_string_lossy().as_ref()])
            .unwrap();
        validate_database(&backup).unwrap();
    }
}
