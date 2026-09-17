import type { APIRoute } from "astro";

// The only on-demand route: keeps a Worker script in the deploy so `run_worker_first: ["/api/*"]`
// is valid. Everything else is prerendered and served as static assets.
export const prerender = false;

export const GET: APIRoute = () => Response.json({ ok: true });
