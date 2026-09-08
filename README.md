# Vikingos Indira POS

POS para Windows, completamente local: HTML/CSS/JavaScript, Tauri 2 y SQLite incluido. La aplicación funciona sin Internet y guarda los datos en AppData, no junto al ejecutable.

## Desarrollo

Requisitos: Node.js 24, Rust estable y dependencias de Tauri para Windows.

```powershell
npm install
npm run desktop:dev
```

## Verificación y build

```powershell
npm run check
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
npm run desktop:build
```

El build local no necesita certificado. El release público sí lo exige. La base `pos.db`, los logs, exports y `Backups/` se crean bajo el directorio de datos de la aplicación.

## Estructura

- `app/`: interfaz de escritorio.
- `src-tauri/`: backend local, migraciones, permisos e instalador NSIS.
- raíz (`index.html`, `style.css`, `app.js`): web de descarga.
- `config/product.json`: identidad, URLs y valores predeterminados centralizados.
- `docs/`: firma y publicación.

Consulta [docs/RELEASE.md](docs/RELEASE.md) y [docs/CODE_SIGNING.md](docs/CODE_SIGNING.md).
