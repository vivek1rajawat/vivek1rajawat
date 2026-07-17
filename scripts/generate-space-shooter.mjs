// generate-space-shooter.mjs
//
// Renders assets/contrib-space-shooter.svg: each day is an invader glyph
// (dim if quiet, bigger/brighter the busier it was), a ship flies the
// bottom track once per loop and fires on every day with real activity,
// synced via keyTimes so the whole thing repeats forever with no drift.

import { writeFile, mkdir } from 'node:fs/promises';
import { fetchContributionGrid } from './lib/contributions.mjs';
import { BG, BORDER, GOLD, BRIGHT, DIM, LEVEL_FILL } from './lib/palette.mjs';

const USERNAME = process.env.GH_USERNAME || process.argv[2];

if (!USERNAME) {
  console.error('Missing username. Set the GH_USERNAME env var.');
  process.exit(1);
}

const OUT_PATH = 'assets/contrib-space-shooter.svg';

const SPACING_X = 13, SPACING_Y = 14;
const MARGIN_L = 28, MARGIN_R = 28, MARGIN_T = 56;
const SHIP_GAP = 24, MARGIN_B = 24;
const LOOP_DUR = 10; // seconds per full ship pass
const FLASH = 0.02; // fraction of the loop each impact flash lasts
const TARGET_LEVEL_MIN = 2; // only days at/above this level get shot at

function hash(i) {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function buildSvg(grid) {
  const ROWS = grid.length;
  const COLS = Math.max(...grid.map((r) => r.length));
  const gridBottom = MARGIN_T + (ROWS - 1) * SPACING_Y;
  const SHIP_Y = gridBottom + SHIP_GAP;
  const W = MARGIN_L + (COLS - 1) * SPACING_X + MARGIN_R;
  const H = SHIP_Y + MARGIN_B;

  const X = (c) => MARGIN_L + c * SPACING_X;
  const Y = (r) => MARGIN_T + r * SPACING_Y;
  const lvl = (r, c) => (grid[r] && grid[r][c] ? grid[r][c].level : 0);

  const defs = `
    <filter id="softGlow" x="-200%" y="-200%" width="500%" height="500%">
      <feGaussianBlur stdDeviation="1.2" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="strongGlow" x="-300%" y="-300%" width="700%" height="700%">
      <feGaussianBlur stdDeviation="2.2" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  `;

  const out = [];

  // starfield
  for (let i = 0; i < 70; i++) {
    const sx = hash(i * 3.1) * W;
    const sy = hash(i * 7.7 + 1) * (gridBottom - 10) + 4;
    const r = 0.5 + hash(i * 5.3) * 1;
    const twinkle = hash(i * 9.1) > 0.75;
    if (twinkle) {
      const dur = (2 + hash(i) * 3).toFixed(1);
      out.push(`<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="${r.toFixed(1)}" fill="#cfcac0" opacity="0.5">
        <animate attributeName="opacity" values="0.15;0.7;0.15" dur="${dur}s" repeatCount="indefinite"/>
      </circle>`);
    } else {
      out.push(`<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="${r.toFixed(1)}" fill="#cfcac0" opacity="0.25"/>`);
    }
  }

  // faint reference scan-lines
  for (let r = 0; r < ROWS; r++) {
    out.push(`<line x1="${MARGIN_L}" y1="${Y(r)}" x2="${W - MARGIN_R}" y2="${Y(r)}" stroke="${BORDER}" stroke-width="1" opacity="0.3"/>`);
  }

  // invader glyphs, base state
  for (let r = 0; r < ROWS; r++) {
    const cols = grid[r].length;
    for (let c = 0; c < cols; c++) {
      const L = lvl(r, c);
      const cx = X(c), cy = Y(r);
      if (L === 0) {
        out.push(`<circle cx="${cx}" cy="${cy}" r="1.3" fill="${BORDER}" opacity="0.6"/>`);
      } else {
        const s = 2 + L * 0.9;
        out.push(`<path d="M ${cx - s} ${cy} L ${cx - s * 0.4} ${cy - s} L ${cx + s * 0.4} ${cy - s} L ${cx + s} ${cy} L ${cx + s * 0.4} ${cy + s * 0.6} L ${cx - s * 0.4} ${cy + s * 0.6} Z" fill="${LEVEL_FILL[L]}" opacity="0.75"/>`);
      }
    }
  }

  // targets: busy days get shot as the ship's column lines up with them
  const targets = [];
  for (let r = 0; r < ROWS; r++) {
    const cols = grid[r].length;
    for (let c = 0; c < cols; c++) {
      if (lvl(r, c) >= TARGET_LEVEL_MIN) targets.push({ r, c, L: lvl(r, c) });
    }
  }

  targets.forEach(({ r, c, L }) => {
    const t = COLS > 1 ? c / (COLS - 1) : 0;
    const t0 = Math.max(0.0001, t - FLASH);
    const t1 = Math.min(0.9999, t + FLASH);
    const cx = X(c), cy = Y(r);
    const filter = L >= 4 ? 'strongGlow' : 'softGlow';

    out.push(`<line x1="${cx}" y1="${SHIP_Y}" x2="${cx}" y2="${cy}" stroke="${BRIGHT}" stroke-width="1.4" filter="url(#${filter})" opacity="0">
      <animate attributeName="opacity" values="0;0;1;0;0" keyTimes="0;${t0.toFixed(4)};${t.toFixed(4)};${t1.toFixed(4)};1" dur="${LOOP_DUR}s" begin="0s" repeatCount="indefinite"/>
    </line>`);

    out.push(`<circle cx="${cx}" cy="${cy}" r="1" fill="${BRIGHT}" filter="url(#${filter})" opacity="0">
      <animate attributeName="opacity" values="0;0;1;0;0" keyTimes="0;${t0.toFixed(4)};${t.toFixed(4)};${t1.toFixed(4)};1" dur="${LOOP_DUR}s" begin="0s" repeatCount="indefinite"/>
      <animate attributeName="r" values="1;1;5;1;1" keyTimes="0;${t0.toFixed(4)};${t.toFixed(4)};${t1.toFixed(4)};1" dur="${LOOP_DUR}s" begin="0s" repeatCount="indefinite"/>
    </circle>`);
  });

  // ship: body + flame, one group moved by a single animateMotion
  out.push(`<g>
    <path d="M -5,-4 L 6,0 L -5,4 L -2,0 Z" fill="${GOLD}" filter="url(#softGlow)"/>
    <ellipse cx="-7" cy="0" rx="2.4" ry="1.3" fill="${BRIGHT}" opacity="0.8">
      <animate attributeName="rx" values="2.4;1.4;2.4" dur="0.12s" repeatCount="indefinite"/>
    </ellipse>
    <animateMotion dur="${LOOP_DUR}s" begin="0s" repeatCount="indefinite" path="M ${MARGIN_L} ${SHIP_Y} L ${W - MARGIN_R} ${SHIP_Y}"/>
  </g>`);

  // HUD corner brackets
  const bl = 8;
  const brackets = [
    [10, 10, 1, 1], [W - 10, 10, -1, 1], [10, H - 10, 1, -1], [W - 10, H - 10, -1, -1],
  ].map(([x, y, dx, dy]) => `<path d="M ${x} ${y + bl * dy} L ${x} ${y} L ${x + bl * dx} ${y}" stroke="${BORDER}" stroke-width="1.2" fill="none"/>`).join('');
  out.push(brackets);

  out.push(`<text x="${MARGIN_L}" y="28" font-family="Helvetica, Arial, sans-serif" font-size="11" letter-spacing="3" fill="${GOLD}">CONTRIBUTION COMMAND</text>`);
  out.push(`<text x="${MARGIN_L}" y="44" font-family="Consolas, Menlo, monospace" font-size="9" letter-spacing="0.5" fill="${DIM}">365 DAYS ON PATROL &#8212; TARGETS LIT UP LIVE</text>`);

  const legendY = H - 8;
  const lx = W - MARGIN_R - 4 * 12 - 40;
  out.push(`<text x="${lx - 26}" y="${legendY + 3}" font-family="Consolas, Menlo, monospace" font-size="8" fill="${DIM}">faint</text>`);
  for (let L = 0; L < 5; L++) {
    out.push(`<circle cx="${lx + L * 12}" cy="${legendY}" r="${1.3 + L * 0.5}" fill="${LEVEL_FILL[L]}"/>`);
  }
  out.push(`<text x="${lx + 5 * 12 + 4}" y="${legendY + 3}" font-family="Consolas, Menlo, monospace" font-size="8" fill="${DIM}">lit</text>`);

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Contribution space shooter">
<defs>${defs}</defs>
<rect width="${W}" height="${H}" fill="${BG}"/>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" fill="none" stroke="${BORDER}" stroke-width="1"/>
${out.join('\n')}
</svg>`;
}

try {
  const grid = await fetchContributionGrid(USERNAME);
  const svg = buildSvg(grid);
  await mkdir('assets', { recursive: true });
  await writeFile(OUT_PATH, svg, 'utf-8');
  console.log(`Wrote ${OUT_PATH}`);
} catch (err) {
  // Don't fail the workflow over a transient GitHub hiccup — just skip this
  // run and keep whatever image is already committed.
  console.warn('Skipping this run:', err.message);
}
