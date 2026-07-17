// generate-stats.mjs
//
// Fetches public profile + repo data from the GitHub REST API and renders a
// self-hosted stats panel (repos, stars, followers, since-year, top
// languages) in the same palette as the other widgets. This replaces
// third-party stat-card services, which sit on a shared, occasionally
// rate-limited public instance.
//
// Output: assets/stats-panel.svg (only overwritten when the fetch succeeds).

import { writeFile, mkdir } from 'node:fs/promises';
import { BG, BORDER, GOLD, BRIGHT, DIM } from './lib/palette.mjs';

const USERNAME = process.env.GH_USERNAME || process.argv[2];
const TOKEN = process.env.GITHUB_TOKEN; // set by the workflow for a higher rate limit

if (!USERNAME) {
  console.error('Missing username. Set the GH_USERNAME env var.');
  process.exit(1);
}

const OUT_PATH = 'assets/stats-panel.svg';
const LANG_SHADES = ['#f3d896', '#C9A15A', '#a3853a', '#6b5626', '#4a3d1c'];
const W = 900;
const H = 200;

function ghHeaders() {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (compatible; stats-panel-bot/1.0)',
    Accept: 'application/vnd.github+json',
  };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  return headers;
}

async function fetchProfile(username) {
  const userRes = await fetch(`https://api.github.com/users/${username}`, { headers: ghHeaders() });
  if (!userRes.ok) throw new Error(`user endpoint responded ${userRes.status}`);
  const user = await userRes.json();

  const repos = [];
  for (let page = 1; page <= 5; page++) {
    const res = await fetch(
      `https://api.github.com/users/${username}/repos?per_page=100&page=${page}&type=owner`,
      { headers: ghHeaders() }
    );
    if (!res.ok) throw new Error(`repos endpoint responded ${res.status}`);
    const batch = await res.json();
    if (!Array.isArray(batch)) throw new Error('unexpected repos payload');
    repos.push(...batch);
    if (batch.length < 100) break;
  }

  return { user, repos };
}

function buildSvg({ user, repos }) {
  const own = repos.filter((r) => !r.fork);
  const totalStars = own.reduce((s, r) => s + (r.stargazers_count || 0), 0);
  const langCounts = {};
  for (const r of own) {
    if (r.language) langCounts[r.language] = (langCounts[r.language] || 0) + 1;
  }
  const topLangs = Object.entries(langCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const sinceYear = new Date(user.created_at).getFullYear();

  const stats = [
    { label: 'REPOS', value: own.length },
    { label: 'STARS', value: totalStars },
    { label: 'FOLLOWERS', value: user.followers ?? 0 },
    { label: 'ACTIVE SINCE', value: sinceYear },
  ];

  const defs = `
    <filter id="glow" x="-300%" y="-300%" width="700%" height="700%">
      <feGaussianBlur stdDeviation="2" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  `;

  const out = [];

  out.push(`<text x="28" y="30" font-family="Helvetica, Arial, sans-serif" font-size="11" letter-spacing="3" fill="${GOLD}" opacity="0">SYSTEM READOUT
    <animate attributeName="opacity" values="0;1" dur="0.6s" begin="0.1s" fill="freeze"/>
  </text>`);
  out.push(`<text x="28" y="46" font-family="Consolas, Menlo, monospace" font-size="9" letter-spacing="0.5" fill="${DIM}" opacity="0">LIVE FROM THE GITHUB API
    <animate attributeName="opacity" values="0;1" dur="0.6s" begin="0.2s" fill="freeze"/>
  </text>`);

  const statX0 = 28, statSpacing = 100, statY = 110;
  stats.forEach((s, i) => {
    const cx = statX0 + i * statSpacing;
    const begin = (0.5 + i * 0.15).toFixed(2);
    out.push(`<g opacity="0" transform="translate(${cx},${statY})">
      <animateTransform attributeName="transform" type="scale" additive="sum" from="0.7" to="1" dur="0.4s" begin="${begin}s" fill="freeze" calcMode="spline" keySplines="0.2 0 0.2 1"/>
      <animate attributeName="opacity" values="0;1" dur="0.4s" begin="${begin}s" fill="freeze"/>
      <text x="0" y="0" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="30" fill="#f5f1e8">${s.value}</text>
      <text x="0" y="18" text-anchor="middle" font-family="Consolas, Menlo, monospace" font-size="8" letter-spacing="1" fill="${DIM}">${s.label}</text>
    </g>`);
  });

  const spineY = 140;
  out.push(`<line x1="28" y1="${spineY}" x2="${W - 28}" y2="${spineY}" stroke="${BORDER}" stroke-width="1" stroke-dasharray="${W - 56}" stroke-dashoffset="${W - 56}">
    <animate attributeName="stroke-dashoffset" from="${W - 56}" to="0" dur="1s" begin="0.9s" fill="freeze"/>
  </line>`);
  stats.forEach((s, i) => {
    const cx = statX0 + i * statSpacing;
    const begin = (1.1 + i * 0.05).toFixed(2);
    out.push(`<line x1="${cx}" y1="${statY + 24}" x2="${cx}" y2="${spineY}" stroke="${BORDER}" stroke-width="1" opacity="0">
      <animate attributeName="opacity" values="0;0.6" dur="0.3s" begin="${begin}s" fill="freeze"/>
    </line>`);
    out.push(`<circle cx="${cx}" cy="${spineY}" r="2" fill="${GOLD}" opacity="0">
      <animate attributeName="opacity" values="0;1" dur="0.3s" begin="${begin}s" fill="freeze"/>
    </circle>`);
  });

  out.push(`<circle r="2.2" fill="${BRIGHT}" filter="url(#glow)" opacity="0">
    <animate attributeName="opacity" values="0;1" dur="0.2s" begin="2s" fill="freeze"/>
    <animateMotion dur="4s" begin="2s" repeatCount="indefinite" path="M 28 ${spineY} L ${W - 28} ${spineY}"/>
  </circle>`);

  const LABEL_X = 460, BAR_X = 545, BAR_MAX_W = 280, COUNT_X = BAR_X + BAR_MAX_W + 14;
  const langY0 = 68, rowH = 20, barH = 8;
  const maxCount = Math.max(...topLangs.map(([, c]) => c), 1);
  out.push(`<text x="${LABEL_X}" y="${langY0 - 14}" font-family="Consolas, Menlo, monospace" font-size="9" letter-spacing="1" fill="${DIM}" opacity="0">TOP LANGUAGES
    <animate attributeName="opacity" values="0;1" dur="0.5s" begin="0.4s" fill="freeze"/>
  </text>`);
  topLangs.forEach(([lang, count], i) => {
    const y = langY0 + i * rowH;
    const w = Math.max(6, (count / maxCount) * BAR_MAX_W);
    const begin = (0.6 + i * 0.12).toFixed(2);
    out.push(`<text x="${LABEL_X}" y="${y + barH - 1}" font-family="Consolas, Menlo, monospace" font-size="9" fill="#cfcac0" opacity="0">${lang}
      <animate attributeName="opacity" values="0;1" dur="0.3s" begin="${begin}s" fill="freeze"/>
    </text>`);
    out.push(`<rect x="${BAR_X}" y="${y}" width="0" height="${barH}" rx="2" fill="${LANG_SHADES[i % LANG_SHADES.length]}">
      <animate attributeName="width" from="0" to="${w.toFixed(1)}" dur="0.6s" begin="${begin}s" fill="freeze" calcMode="spline" keySplines="0.2 0 0.2 1"/>
    </rect>`);
    out.push(`<text x="${COUNT_X}" y="${y + barH - 1}" font-family="Consolas, Menlo, monospace" font-size="9" fill="${DIM}" opacity="0">${count}
      <animate attributeName="opacity" values="0;1" dur="0.3s" begin="${(parseFloat(begin) + 0.5).toFixed(2)}s" fill="freeze"/>
    </text>`);
  });

  const pad = 10;
  const corners = [[pad, pad], [W - pad, pad], [pad, H - pad], [W - pad, H - pad]]
    .map(([cx, cy]) => `<circle cx="${cx}" cy="${cy}" r="2.2" fill="none" stroke="${BORDER}" stroke-width="1"/>`)
    .join('');

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Profile stats panel">
<defs>${defs}</defs>
<rect width="${W}" height="${H}" fill="${BG}"/>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" fill="none" stroke="${BORDER}" stroke-width="1"/>
${corners}
${out.join('\n')}
</svg>`;
}

try {
  const data = await fetchProfile(USERNAME);
  const svg = buildSvg(data);
  await mkdir('assets', { recursive: true });
  await writeFile(OUT_PATH, svg, 'utf-8');
  console.log(`Wrote ${OUT_PATH}`);
} catch (err) {
  console.warn('Skipping this run:', err.message);
}
