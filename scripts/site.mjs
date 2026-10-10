// Serve demo/site/ on http://localhost:8790, for the demo extension.
// Usage: pnpm site [port]
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve("demo/site");
const port = Number(process.argv[2] ?? 8790);
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css" };
createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://localhost").pathname));
  const file = join(root, path.endsWith("/") ? `${path}index.html` : path);
  if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) return void res.writeHead(404).end("Not found");
  res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
}).listen(port, "127.0.0.1", () => console.log(`The test site runs on http://localhost:${port}/login.html`));
