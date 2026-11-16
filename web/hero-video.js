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
document.querySelector(".links").innerHTML = CFG.nav.map((n, i) => `<a href="${n.href}">${n.label}</a>`).join("");
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
