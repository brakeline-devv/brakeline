// Plays the coin loop (media/hero.mp4, 10.2 s) and drives the HTML copy, nav and fades from the video clock,
// so text timing stays frame-locked to the picture. All copy and timing live in config.js.
import CFG from "./config.js";

const loopT = (t) => ((t % CFG.loop) + CFG.loop) % CFG.loop;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
function lin(keys, t) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) if (t <= keys[i][0]) { const [a, va] = keys[i - 1], [b, vb] = keys[i]; return va + (vb - va) * ((t - a) / (b - a)); }
  return keys[keys.length - 1][1];
}
const inWin = (t, a, b) => (b >= a ? t >= a && t <= b : t >= a || t <= b);

document.title = CFG.brand;
document.querySelector(".logo").textContent = CFG.brand;
document.querySelector(".btn-ghost").textContent = CFG.navCta;
const isLocal = ["localhost", "127.0.0.1"].includes(location.hostname);
const ICONS = {
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.2L2 3h6.33l4.37 5.77L17.75 3Zm-1.08 16.17h1.7L7.4 4.74H5.58l11.09 14.43Z"/></svg>',
  cli: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="4" width="19" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m7 9.5 3 2.5-3 2.5M12.5 15h4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  github: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.56 9.56 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.75c0 .27.18.58.69.48A10 10 0 0 0 12 2Z"/></svg>',
};
document.querySelector(".links").innerHTML = CFG.nav.filter((n) => n.href && (isLocal || !n.local)).map((n) =>
  `<a href="${n.href}"${n.ext ? ' target="_blank" rel="noopener" class="ext"' : ""}${n.icon ? ` aria-label="${n.label}"` : ""}>${n.icon ? ICONS[n.icon] : ""}<span>${n.label}</span></a>`).join("");
const slides = {};
for (const k of ["a", "b"]) {
  const s = CFG.slides[k], el = document.querySelector(`.slide-${k}`);
  el.querySelector("h1").innerHTML = s.lines.map((l) => `<span class="ln">${l}</span>`).join("");
  el.querySelector(".sub").textContent = s.sub;
  if (s.cta) el.querySelector(".cta").textContent = s.cta;
  if (s.actions) el.querySelector(".actions").innerHTML = s.actions;
  slides[k] = { root: el, lines: [...el.querySelectorAll(".ln")], sub: el.querySelector(".sub"), act: el.querySelector(".actions") };
}
function vis(t, [i0, i1, o0, o1]) {
  const off = (x) => loopT(x - i0), tt = off(t), vin = smooth(0, off(i1), tt);
  return { v: Math.min(vin, 1 - smooth(off(o0), off(o1), tt)), vin };
}
function textState(el, spec, t) {
  const items = [...el.lines.map((n, i) => [n, spec.lines[i]]), [el.sub, spec.sub], [el.act, spec.act]];
  for (const [node, w] of items) {
    const { v, vin } = vis(t, w);
    node.style.opacity = v.toFixed(3);
    node.style.filter = vin < 1 ? `brightness(${(0.45 + 0.55 * vin).toFixed(3)})` : "";
  }
}

const video = document.getElementById("bg"), fade = document.getElementById("fade"), nav = document.querySelector(".nav");
const pinned = new URLSearchParams(location.search).get("t");
video.loop = true;
if (pinned != null) { video.addEventListener("loadeddata", () => { video.currentTime = Number(pinned); }, { once: true }); }
else video.play().catch(() => { /* autoplay blocked: start on first interaction */ addEventListener("pointerdown", () => video.play(), { once: true }); });

function frame() {
  const t = pinned != null ? Number(pinned) : loopT(video.currentTime || 0);
  const inA = inWin(t, CFG.sceneASpan[0], CFG.sceneASpan[1]);
  fade.style.opacity = lin(CFG.fade, t).toFixed(3);
  // the nav follows the video's fades only while the hero fills the screen; once scrolled it stays solid
  const scrolled = scrollY > 40;
  nav.classList.toggle("solid", scrolled);
  nav.style.opacity = scrolled ? "1" : lin(CFG.navFade, t).toFixed(3);
  slides.a.root.style.visibility = inA ? "visible" : "hidden";
  slides.b.root.style.visibility = inA ? "hidden" : "visible";
  textState(slides.a, CFG.text.a, t);
  textState(slides.b, CFG.text.b, t);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// demo terminal: lines appear one by one when it scrolls into view
const term = document.querySelector(".term");
if (term) {
  term.querySelectorAll(".l").forEach((l, i) => { l.style.transitionDelay = `${i * 0.22}s`; });
  new IntersectionObserver((es, io) => { if (es[0].isIntersecting) { term.classList.add("in"); io.disconnect(); } }, { threshold: 0.3 }).observe(term);
}
