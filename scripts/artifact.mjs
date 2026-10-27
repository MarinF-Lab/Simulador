// Convierte dist/index.html en artifact/index.html: quita doctype, html, head y body,
// porque el artefacto agrega su propio esqueleto al publicar.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const html = readFileSync("dist/index.html", "utf8");
const head = html.match(/<head>([\s\S]*?)<\/head>/i)?.[1] ?? "";
const body = html.match(/<body>([\s\S]*?)<\/body>/i)?.[1] ?? "";
const keepHead = head
  .replace(/<meta charset[^>]*>/i, "")
  .replace(/<meta name="viewport"[^>]*>/i, "")
  // Manifest, íconos y la app instalable son de GitHub Pages: el artefacto no los usa.
  .replace(/<link rel="(manifest|icon|apple-touch-icon)"[^>]*>\s*/gi, "")
  .replace(/<meta name="apple-mobile-web-app[^"]*"[^>]*>\s*/gi, "");
const title = keepHead.match(/<title>[\s\S]*?<\/title>/i)?.[0] ?? "";
const rest = keepHead.replace(title, "");
mkdirSync("artifact", { recursive: true });
writeFileSync("artifact/index.html", `${title}\n${rest.trim()}\n${body.trim()}\n`);
console.log("artifact/index.html listo");
