import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";

const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".xml": "application/xml",
  ".webmanifest": "application/manifest+json",
  ".wasm": "application/wasm",
};

function isFile(file: string) {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

/** Serves a built `dist/client` the way Workers static assets do: `/x/` → `x/index.html`, else 404.html. */
export function serveStatic(root: string, port: number) {
  const server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
    const file = path.join(root, pathname.endsWith("/") ? `${pathname}index.html` : pathname);
    const found = file.startsWith(root) && isFile(file);
    const served = found
      ? file
      : path.join(root, pathname.startsWith("/en/") ? "en/404.html" : "404.html");
    response.writeHead(found ? 200 : 404, {
      "Content-Type": types[path.extname(served)] ?? "application/octet-stream",
    });
    createReadStream(served).pipe(response);
  });
  return new Promise<() => Promise<void>>((resolve) => {
    server.listen(port, "127.0.0.1", () =>
      resolve(() => new Promise((done) => server.close(() => done()))),
    );
  });
}
