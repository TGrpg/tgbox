/**
 * Shared vanilla Motion layer for static pages (no React). Loaded once as a module by BaseLayout.
 * Budget: < 6KB gzipped (asserted in test/build.test.ts). Hooks: [data-reveal], [data-hover-lift], [data-press], [data-count-up], [data-nav] indicator,
 * [data-site-header] scroll state, [data-back-to-top]; share dialogs and copy toasts via ./overlays.ts.
 */
import { animate } from "motion/mini";
import { durations, easeOut, reveal, springs, springTransition } from "@/lib/motion-presets.ts";
import { overlays } from "./overlays.ts";

const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const snappy = springTransition(springs.snappy);
const liftSpring = springTransition(springs.lift);
const bouncy = springTransition(springs.bouncy);
const gentle = springTransition(springs.gentle);

/** Native stand-in for Motion's `inView` (keeps the layer under budget): fires once per element. */
function inView(selector: string, callback: (element: Element) => void) {
  const observer = new IntersectionObserver((records) => {
    for (const record of records) {
      if (!record.isIntersecting) continue;
      observer.unobserve(record.target);
      callback(record.target);
    }
  });
  for (const element of document.querySelectorAll(selector)) observer.observe(element);
}

function revealOnScroll() {
  let batch: Element[] = [];
  inView("[data-reveal]", (element) => {
    element.setAttribute("data-revealed", "");
    if (reduced) return;
    // Elements entering in the same frame form one staggered group.
    if (batch.push(element) > 1) return;
    requestAnimationFrame(() => {
      batch.forEach((item, index) => {
        animate(
          item,
          { opacity: [0, 1], translate: [`0 ${reveal.distance}px`, "0 0"] },
          { ...gentle, delay: Math.min(index, reveal.maxStaggered) * reveal.stagger },
        );
      });
      batch = [];
    });
  });
}

/** Delegated instead of Motion's `hover()`: ~0.4KB smaller (room for ./overlays.ts) and covers rows added later. */
function hoverLift() {
  let current: Element | null = null;
  const lift = (element: Element | null) => {
    if (element === current) return;
    if (current) {
      current.removeAttribute("data-lifted");
      if (!reduced) animate(current, { translate: "0 0" }, liftSpring);
    }
    current = element;
    if (element) {
      element.setAttribute("data-lifted", "");
      if (!reduced) animate(element, { translate: "0 -3px" }, liftSpring);
    }
  };
  document.addEventListener("pointerover", (event) => {
    if (event.pointerType === "touch") return;
    lift(event.target instanceof Element ? event.target.closest("[data-hover-lift]") : null);
  });
  document.addEventListener("pointerout", (event) => {
    if (!event.relatedTarget) lift(null);
  });
}

/** Delegated instead of Motion's `press()`: ~0.6KB smaller and covers elements added later. */
function pressScale() {
  if (reduced) return;
  document.addEventListener("pointerdown", (event) => {
    const element = event.target instanceof Element ? event.target.closest("[data-press]") : null;
    if (!element || event.button !== 0) return;
    animate(element, { scale: 0.94 }, { duration: durations.fast, ease: easeOut });
    // A leftover listener of the other type only re-settles an element already at rest.
    const release = () => animate(element, { scale: 1 }, bouncy);
    addEventListener("pointerup", release, { once: true });
    addEventListener("pointercancel", release, { once: true });
  });
}

function countUp() {
  const format = new Intl.NumberFormat(document.documentElement.lang);
  inView("[data-count-up]", (element) => {
    const target = Number(element.getAttribute("data-count-up"));
    if (reduced || !Number.isFinite(target) || target <= 0) return;
    const start = performance.now();
    const ms = durations.slow * 2500;
    const tick = (now: number) => {
      const progress = Math.min((now - start) / ms, 1);
      element.textContent = format.format(Math.round(target * (1 - (1 - progress) ** 5)));
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

const NAV_KEY = "nav-indicator";

function navIndicator() {
  const nav = document.querySelector<HTMLElement>("[data-nav]");
  const indicator = nav?.querySelector<HTMLElement>("[data-nav-indicator]");
  if (!nav || !indicator) return;
  const links = [...nav.querySelectorAll<HTMLElement>(".nav-link")];
  const active = links.find((link) => link.getAttribute("aria-current") === "page");

  const place = (link: HTMLElement | undefined, animated: boolean) => {
    const box = link?.parentElement;
    const frame = { translate: `${box?.offsetLeft ?? 0}px 0`, width: `${box?.offsetWidth ?? 0}px` };
    const opacity = link ? 1 : 0;
    if (!animated || reduced) {
      Object.assign(indicator.style, frame, { opacity: String(opacity) });
      return;
    }
    animate(indicator, { ...frame, opacity }, snappy);
  };

  // Slide in from where the pill sat on the previous page.
  const previous = sessionStorage.getItem(NAV_KEY);
  const from = previous ? links[Number(previous)] : undefined;
  place(from && from !== active ? from : active, false);
  nav.setAttribute("data-ready", "");
  if (from && from !== active) requestAnimationFrame(() => place(active, true));
  sessionStorage.setItem(NAV_KEY, String(active ? links.indexOf(active) : -1));

  for (const link of links) {
    link.addEventListener("pointerenter", () => place(link, true));
    link.addEventListener("focus", () => place(link, true));
  }
  nav.addEventListener("pointerleave", () => place(active, true));
  nav.addEventListener("focusout", () => place(active, true));
  window.addEventListener("resize", () => place(active, false), { passive: true });
}

function scrollState() {
  const header = document.querySelector("[data-site-header]");
  const toTop = document.querySelector<HTMLElement>("[data-back-to-top]");
  let scrolled = false;
  let showTop = false;
  const update = () => {
    const y = window.scrollY;
    if (y > 8 !== scrolled) {
      scrolled = y > 8;
      header?.toggleAttribute("data-scrolled", scrolled);
    }
    if (toTop && y > 640 !== showTop) {
      showTop = y > 640;
      if (showTop) toTop.hidden = false;
      if (reduced) {
        toTop.hidden = !showTop;
        return;
      }
      const done = animate(
        toTop,
        { opacity: showTop ? [0, 1] : 0, scale: showTop ? [0.6, 1] : 0.6 },
        showTop ? bouncy : { duration: durations.fast, ease: easeOut },
      );
      if (!showTop) done.then(() => (toTop.hidden = !showTop));
    }
  };
  update();
  window.addEventListener("scroll", update, { passive: true });
  toTop?.addEventListener("click", () =>
    window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" }),
  );
}

revealOnScroll();
hoverLift();
pressScale();
countUp();
navIndicator();
scrollState();
overlays(reduced, liftSpring);
