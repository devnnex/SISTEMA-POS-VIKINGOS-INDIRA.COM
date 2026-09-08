# Publicar una versión

1. Actualiza la misma versión en `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` y `config/product.json`.
2. Ejecuta `npm ci`, `npm run check`, `cargo test --manifest-path src-tauri/Cargo.toml --locked` y `cargo check --manifest-path src-tauri/Cargo.toml --locked`.
3. Confirma los cambios: `git add . && git commit -m "release: v1.0.0"`.
4. Crea el tag: `git tag v1.0.0`.
5. Publica: `git push origin main && git push origin v1.0.0`.
6. `release.yml` exige el certificado, compila Windows x64 con WebView2 offline, firma, verifica con SignTool, calcula SHA-256 y crea el GitHub Release.

El workflow falla si el tag y la versión no coinciden o si falta/carece de validez la firma. Nunca publica un instalador sin firma.
