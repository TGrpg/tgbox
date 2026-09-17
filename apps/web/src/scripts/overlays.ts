/**
 * Delegated, markup-driven overlays, bundled into the motion layer (so kept tiny for the page JS budget):
 * - `[data-copy="<text>"]` copies to the clipboard and shows `data-copy-done` in the page's `[data-toast]`.
 * - Inside `[data-share]`: `[data-share-open]` / `[data-share-close]` / backdrop click animate the native `<dialog>`.
 * The toast and the dialog backdrop animate in CSS on the spring tokens (starwind.css).
 */
import { animate } from "motion/mini";
import type { springTransition } from "@/lib/motion-presets.ts";

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function overlays(reduced: boolean, spring: ReturnType<typeof springTransition>) {
  document.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const copy = target.closest<HTMLElement>("[data-copy]");
    const toast = document.querySelector("[data-toast]");
    if (copy && toast) {
      await navigator.clipboard?.writeText(`${copy.dataset.copy}`);
      toast.textContent = `${copy.dataset.copyDone}`;
      toast.setAttribute("data-shown", "");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toast.removeAttribute("data-shown"), 1800);
    }
    const dialog = target.closest("[data-share]")?.querySelector("dialog");
    if (!dialog) return;
    if (target.closest("[data-share-open]")) {
      dialog.showModal();
      if (!reduced) animate(dialog, { opacity: [0, 1], scale: [0.92, 1] }, spring);
    } else if (target.closest("[data-share-close]") || target === dialog) {
      // A click on the dialog element itself is a click on its backdrop.
      dialog.setAttribute("data-closing", "");
      if (!reduced) await animate(dialog, { opacity: 0, scale: 0.96 }, { duration: 0.15 });
      dialog.close();
      dialog.removeAttribute("data-closing");
    }
  });
}
