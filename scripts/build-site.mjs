import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const out = resolve(root, "dist-site");

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

for (const item of ["index.html", "style.css", "app.js", "images", "screenshots", "config"]) {
  await cp(resolve(root, item), resolve(out, item), { recursive: true });
}

await cp(resolve(root, ".nojekyll"), resolve(out, ".nojekyll"));
console.log(`Sitio listo en ${out}`);
