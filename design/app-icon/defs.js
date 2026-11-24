const G = `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5b6cf0"/><stop offset=".55" stop-color="#8b5cf6"/><stop offset="1" stop-color="#e0559b"/></linearGradient>
<radialGradient id="cloud1" cx=".2" cy=".15" r=".6"><stop offset="0" stop-color="#7dd3fc" stop-opacity=".55"/><stop offset="1" stop-color="#7dd3fc" stop-opacity="0"/></radialGradient>
<radialGradient id="cloud2" cx=".9" cy=".95" r=".6"><stop offset="0" stop-color="#fda4af" stop-opacity=".6"/><stop offset="1" stop-color="#fda4af" stop-opacity="0"/></radialGradient>
<linearGradient id="glass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity=".18"/></linearGradient>
<linearGradient id="edge" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".5" stop-color="#fff" stop-opacity=".25"/><stop offset="1" stop-color="#fff" stop-opacity=".6"/></linearGradient>
<filter id="sh" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#2a1065" flood-opacity=".35"/></filter>
<filter id="blur" filterUnits="userSpaceOnUse" x="-600" y="-600" width="2224" height="2224"><feGaussianBlur stdDeviation="40"/></filter>`;
const bg = (dark) => dark
 ? `<rect width="1024" height="1024" fill="#14132b"/><circle cx="220" cy="200" r="380" fill="#5b6cf0" opacity=".55" filter="url(#blur)"/><circle cx="860" cy="880" r="400" fill="#e0559b" opacity=".5" filter="url(#blur)"/><circle cx="800" cy="200" r="260" fill="#8b5cf6" opacity=".4" filter="url(#blur)"/>`
 : `<rect width="1024" height="1024" fill="url(#g)"/><rect width="1024" height="1024" fill="url(#cloud1)"/><rect width="1024" height="1024" fill="url(#cloud2)"/>`;
// foregrounds kept within the central 66% safe zone (~174..850)
const fg = {
 // 1: glass stack: three frosted cards + check
 stack: `<g filter="url(#sh)">
  <rect x="300" y="250" width="440" height="330" rx="70" fill="#fff" fill-opacity=".18" stroke="#fff" stroke-opacity=".35" stroke-width="4" transform="rotate(-12 520 415)"/>
  <rect x="290" y="330" width="440" height="330" rx="70" fill="#fff" fill-opacity=".28" stroke="#fff" stroke-opacity=".5" stroke-width="4" transform="rotate(-5 510 495)"/>
  <rect x="282" y="420" width="460" height="350" rx="76" fill="url(#glass)" stroke="url(#edge)" stroke-width="6"/>
  </g>
  <path d="M410 600 L480 668 L620 524" fill="none" stroke="#fff" stroke-width="54" stroke-linecap="round" stroke-linejoin="round"/>`,
 // 2: orbit C with three agency dots (dark glass)
 orbit: `<g filter="url(#sh)"><circle cx="512" cy="512" r="250" fill="#fff" fill-opacity=".08" stroke="url(#edge)" stroke-width="5"/></g>
  <path d="M672 372 A200 200 0 1 0 672 652" fill="none" stroke="url(#g)" stroke-width="92" stroke-linecap="round"/>
  <path d="M672 372 A200 200 0 1 0 672 652" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="10" stroke-linecap="round" transform="translate(-14 -14)"/>
  <circle cx="742" cy="420" r="34" fill="#7dd3fc"/><circle cx="772" cy="512" r="34" fill="#c4b5fd"/><circle cx="742" cy="604" r="34" fill="#fda4af"/>`,
 // 3: glass briefcase with spark
 case: `<g filter="url(#sh)">
  <path d="M430 360 v-40 a40 40 0 0 1 40 -40 h84 a40 40 0 0 1 40 40 v40" fill="none" stroke="#fff" stroke-width="34" stroke-opacity=".9"/>
  <rect x="262" y="360" width="500" height="380" rx="80" fill="url(#glass)" stroke="url(#edge)" stroke-width="6"/>
  </g>
  <rect x="262" y="500" width="500" height="10" fill="#fff" opacity=".45"/>
  <path d="M512 452 C522 512 536 526 596 536 C536 546 522 560 512 620 C502 560 488 546 428 536 C488 526 502 512 512 452Z" fill="#fff"/>
  <circle cx="640" cy="440" r="14" fill="#fff" opacity=".9"/>`,
 // 4: chat bubble + C (command center / requests)
 chat: `<g filter="url(#sh)"><path d="M300 290 h424 a80 80 0 0 1 80 80 v240 a80 80 0 0 1 -80 80 h-200 l-120 100 v-100 h-104 a80 80 0 0 1 -80 -80 v-240 a80 80 0 0 1 80 -80Z" fill="url(#glass)" stroke="url(#edge)" stroke-width="6"/></g>
  <text x="512" y="575" text-anchor="middle" font-family="Inter, 'Helvetica Neue', Arial, sans-serif" font-weight="800" font-size="190" letter-spacing="-6" fill="#fff">CMA</text>`,
};
module.exports = { G, bg, fg };
