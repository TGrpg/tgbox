import { createStart } from "@tanstack/react-start";

export const startInstance = createStart(() => ({
  // Client-rendered: Mini App auth (initData) only exists in the browser, and admin pages don't
  // need SEO. The Worker still serves the HTML shell and server functions.
  defaultSsr: false,
}));
