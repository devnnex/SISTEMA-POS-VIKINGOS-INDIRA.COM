const button = document.querySelector("#downloadButton");
const meta = document.querySelector("#releaseMeta");
const fallback = document.querySelector("#releaseFallback");
const checksum = document.querySelector("#checksum");
const notice = document.querySelector("#releaseNotice");
const config = await fetch("config/product.json").then((response) => response.json()).catch(() => ({}));

function repositoryUrl() {
  if (config.repositoryUrl && !config.repositoryUrl.includes("OWNER/REPOSITORY")) return config.repositoryUrl.replace(/\/$/, "");
  if (location.hostname.endsWith("github.io")) {
    const owner = location.hostname.split(".")[0];
    const repo = location.pathname.split("/").filter(Boolean)[0];
    if (owner && repo) return `https://github.com/${owner}/${repo}`;
  }
  return config.repositoryUrl || "https://github.com/OWNER/REPOSITORY";
}

async function resolveLatestRelease() {
  const repository = repositoryUrl();
  fallback.href = `${repository}/releases/latest`;
  fallback.hidden = false;
  if (repository.includes("OWNER/REPOSITORY")) {
    meta.textContent = "Configura repositoryUrl para habilitar la descarga automática.";
    button.textContent = "Ver configuración";
    button.href = "config/product.json";
    button.classList.remove("disabled");
    button.removeAttribute("aria-disabled");
    return;
  }
  try {
    const [owner, repo] = new URL(repository).pathname.split("/").filter(Boolean);
    const headers = { Accept: "application/vnd.github+json" };
    const stableResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, { headers });
    let release;
    if (stableResponse.ok) {
      release = await stableResponse.json();
    } else {
      const releasesResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases?per_page=10`, { headers });
      if (!releasesResponse.ok) throw new Error("Release no disponible");
      const releases = await releasesResponse.json();
      release = releases.find((candidate) => !candidate.draft && candidate.assets.some((asset) => /setup.*\.exe$/i.test(asset.name)));
      if (!release) throw new Error("Instalador no disponible");
    }
    const installer = release.assets.find((asset) => /setup.*x64.*\.exe$/i.test(asset.name)) || release.assets.find((asset) => /setup.*\.exe$/i.test(asset.name));
    if (!installer) throw new Error("Instalador no encontrado");
    const digest = release.assets.find((asset) => asset.name === `${installer.name}.sha256`);
    button.href = installer.browser_download_url;
    button.textContent = "Descargar para Windows";
    button.classList.remove("disabled");
    button.removeAttribute("aria-disabled");
    const size = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 1 }).format(installer.size / 1048576);
    const releaseType = release.prerelease ? "Prueba sin firma digital" : "Versión estable";
    meta.textContent = `${release.tag_name} · ${releaseType} · Windows 10/11 · x64 · ${size} MB · ${new Date(release.published_at).toLocaleDateString("es-CO")}`;
    if (release.prerelease) {
      notice.textContent = "Versión de prueba: Windows puede mostrar una advertencia de SmartScreen. No desactives la seguridad del equipo.";
      notice.hidden = false;
    }
    if (digest) {
      const digestResponse = await fetch(digest.browser_download_url);
      if (digestResponse.ok) {
        checksum.textContent = `SHA-256: ${(await digestResponse.text()).trim().split(/\s+/)[0]}`;
        checksum.hidden = false;
      }
    }
  } catch {
    button.href = `${repository}/releases/latest`;
    button.textContent = "Ver última versión";
    button.classList.remove("disabled");
    button.removeAttribute("aria-disabled");
    meta.textContent = "No pudimos consultar GitHub ahora. Puedes abrir la página de descargas.";
  }
}

document.querySelector("#year").textContent = new Date().getFullYear();
const support = document.querySelector("#supportLink");
if (config.supportEmail) support.href = `mailto:${config.supportEmail}`;
document.querySelectorAll(".download-link").forEach((link) => link.addEventListener("click", (event) => {
  if (!button.href || button.getAttribute("aria-disabled") === "true") return;
  event.preventDefault();
  button.click();
}));
resolveLatestRelease();
