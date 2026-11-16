// All website copy + timing. Times are seconds of the 10.2 s coin loop (media/hero.mp4).
const shield = '<svg viewBox="0 0 24 24"><path fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round" d="M12 3 4.5 6v5.5c0 4.6 3.2 8.2 7.5 9.5 4.3-1.3 7.5-4.9 7.5-9.5V6L12 3z"/><path fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="m8.5 12 2.5 2.5 4.5-5"/></svg>';
const play = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="#fff" stroke-width="2"/><path fill="#fff" d="M10 8.5v7l6-3.5z"/></svg>';

export default {
  brand: "Brakeline",
  nav: [
    { label: "How it works", href: "#how" },
    { label: "Rules", href: "#rules" },
    { label: "Install", href: "#install" },
    // external links (icon + label, open in a new tab). X stays hidden until its URL is filled in.
    { label: "X", icon: "x", href: "https://x.com/brakelinetrade", ext: true },
    { label: "CLI", icon: "cli", href: "https://www.npmjs.com/package/brakeline", ext: true },
    { label: "GitHub", icon: "github", href: "https://github.com/brakeline-devv/brakeline", ext: true },
    { label: "Dashboard", href: "app", local: true }, // only shown when the site runs on your own computer
  ],
  navCta: "Add to Claude",

  // $BRAKE token strip under the hero. Hidden while `ca` is empty.
  token: {
    ticker: "$BRAKE",
    chain: "Robinhood Chain",
    ca: "", // contract address, e.g. "0x..."
    buy: "https://www.ponsfamily.com/launchpad/", // + ca
    explorer: "https://robinhoodchain.blockscout.com/token/", // + ca
  },

  slides: {
    a: { lines: ["Fast.", "Guarded."], sub: "Risk rules your AI trading agent can't override.", cta: "Add to Claude" },
    b: {
      lines: ["Every order", "checked", "first"],
      sub: "Loss limits, size caps and revenge-trade blocks",
      actions: `<a class="store" href="#install">${shield}<span><small>MCP server for</small>Claude &amp; Cursor</span></a>`
        + `<a class="store" href="#modes">${play}<span><small>No account needed</small>Try simulation</span></a>`,
    },
  },

  loop: 10.2,
  // black overlay keys [t, opacity]; the nav uses its own keys
  fade: [[0, 0], [2.2, 0], [2.95, 1], [3.05, 1], [3.5, 0], [8.45, 0], [8.6, 1], [9.0, 1], [9.55, 0], [10.2, 0]],
  navFade: [[0, 1], [8.45, 1], [8.6, 0], [9.25, 0], [9.75, 1], [10.2, 1]],
  // copy: per element [fadeInStart, fadeInEnd, fadeOutStart, fadeOutEnd] (times may wrap past the loop)
  text: {
    a: { lines: [[9.05, 9.6, 1.75, 2.3], [9.3, 9.85, 2.0, 2.6]], sub: [9.5, 10.0, 2.2, 2.8], act: [9.6, 10.15, 2.3, 2.9] },
    b: { lines: [[3.0, 3.5, 8.45, 8.55], [3.15, 3.6, 8.45, 8.55], [3.45, 3.95, 8.45, 8.55]], sub: [3.4, 3.9, 8.45, 8.55], act: [3.4, 3.9, 8.45, 8.55] },
  },
  sceneASpan: [9.0, 3.0],
  sceneBSpan: [3.0, 9.0],
};
