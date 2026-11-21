// Renders the landscape SVG map for every country, or only the ISO codes given, into build/media/.
// The target uses the 10m shape; neighbours use the 50m atlas (fast).
// Frames have a consistent ground scale (true distances, azimuthal equidistant centred on the country's main land) in tiers:
//   small  (country <= 600 mi across)   2500 mi wide
//   medium (<= 1800 mi)                 5600 mi wide
//   large  (anything bigger)            9000 mi wide
// Runs one worker process per core (JOBS=n to change, JOBS=1 for a single process); each renders a share of the countries.
//   micro  (small + almost no land nearby, e.g. Fiji) keeps widening x1.2 from 2500 mi, up to ~10000, until other land covers 7% of the frame.
import fs from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { geoPath, geoArea, geoCentroid, geoContains, geoBounds, geoDistance, geoInterpolate, geoAzimuthalEquidistant } from 'd3-geo';
import { COUNTRIES, shapes, numeric } from './geo.js';
import { renderSvg, renderZoomSvg, REGIONS, land, frameProjection } from './render-maps.js';

// Countries that also get a zoom box (build/media/zoom-<ISO>.svg) the card pins to its top-left corner. Testing.
// outline: an OpenStreetMap boundary (Nominatim search result file) to draw instead of the coarse Natural Earth shape.
// backdrop: an OSM land polygon for the neighbouring country, drawn instead of the Natural Earth shapes (which do not line up with the OSM outline).
// enclave: the frame is all land (Vatican City inside Rome), so no neighbour shapes and no ocean.
// Any country with less land than ZOOM_MAX_KM2 (env ZOOM_MAX_KM2 overrides) gets a zoom box; this table only holds per-country overrides.
const ZOOM_MAX_KM2 = Number(process.env.ZOOM_MAX_KM2 || 3000);
const ZOOM = {
  MCO: { outline: 'data/raw/outlines/MCO-osm.json', backdrop: 'data/raw/outlines/MCO-france-osm.json' },
  VAT: { outline: 'data/raw/outlines/VAT-nominatim.json', enclave: true },
};
const landKm2 = Object.fromEntries(JSON.parse(fs.readFileSync('data/records.json', 'utf8')).map((r) => [r.ISO, Number((r['Land Area'] || '').split(' ')[0].replace(/[^0-9]/g, '')) || Infinity]));
// d3 wants exterior rings clockwise on the sphere (GeoJSON from OpenStreetMap is the other way round).
const rewind = (g) => {
  const flip = (poly) => poly.map((ring) => ring.slice().reverse());
  const fixed = (poly) => (geoArea({ type: 'Polygon', coordinates: poly }) > 2 * Math.PI ? flip(poly) : poly);
  return g.type === 'MultiPolygon' ? { ...g, coordinates: g.coordinates.map(fixed) } : { ...g, coordinates: fixed(g.coordinates) };
};
const outlineFeature = (iso, file) => ({ type: 'Feature', id: iso, properties: {}, geometry: rewind(JSON.parse(fs.readFileSync(file, 'utf8'))[0].geojson) });

const TIERS = [[600, 2500], [1800, 5600], [1e9, 9000]]; // [max country extent in miles, frame width in miles]
// Frames shift toward the nearest-fitting landmass anchor by default (NO_SHIFT=1 for centred tiers); continent labels are on by default (NO_CONTINENTS=1 to drop them).
const SHIFT = !process.env.NO_SHIFT;
// Default: no size tiers (set USE_TIERS=1 for the old ones); every frame starts at FLOOR_MI wide and widens (x1.1) only until the whole country and an anchor are in view.
const NO_TIERS = !process.env.USE_TIERS, FLOOR_MI = Number(process.env.FLOOR_MI) || 5000; // USE_TIERS=1 brings the old size tiers back
const MICRO_SHARE = 0.07, MICRO_MAX = 10000, R_MI = 3959;

const lbox = new Map();
const inBox = (f, [x, y]) => {
  if (!lbox.has(f)) lbox.set(f, geoBounds(f));
  const [[w, s], [e, n]] = lbox.get(f);
  return y >= s && y <= n && (w <= e ? x >= w && x <= e : x >= w || x <= e);
};
// Experiment (env ANCHORS=1): every frame must contain the centre of at least one major landmass, widening until it does.
const ANCHORS = { Africa: [20, 5], 'North America': [-100, 45], 'South America': [-60, -15], Europe: [15, 50], China: [103, 35], Russia: [90, 60], Australia: [134, -25], Japan: [138, 37], India: [79, 22], 'United States': [-98.5, 39.5], Florida: [-81.5, 28], Mexico: [-102.5, 23.6], Brazil: [-52, -10] };
const MAX_ANCHOR_MI = 14000;
const FLOOR_OVERRIDE = { CAN: 1000 }; // per-country minimum width (mi); Canada is only as wide as its shape needs
// Prototype (China): a big square canvas with the country centred and about 40% of its width; the card script scales and
// positions the image so the whole country (box recorded in build/fit/boxes.json) fits any window.
const FIT_ISOS = { has: () => !process.env.NO_FIT }, FIT_UI = 2, FIT_SIZE = 1600, FIT_SHARE = 0.4, FIT_MIN_CANVAS_MI = 8000, FIT_CONTEXT_MI = 5000;
const FIT = {}; // per country: { geom (main land), canvas miles }
const COVER_ISOS = new Set(); // the old centred/cover test (replaced by the box fit)
const MERC_CENTRE = FIT_ISOS;
// Test (Canada only): a large frame centred on the country, drawn so the card can crop it to cover (preserveAspectRatio slice) instead of stretching.
const COVER_MIN_MI = 6500, COVER_FACTOR = 1.5; // cover frames: at least 6500 mi wide, and 1.5x the country's own extent
const PREFER_ANCHOR = { CAN: 'United States' }; // anchor tried first instead of the nearest
const anchorIn = (cx, cy, mi) => {
  const p = frameProjection([cx, cy], mi, 1000, 650);
  for (const [name, pt] of Object.entries(ANCHORS)) {
    if (geoDistance([cx, cy], pt) > 2.6) continue;
    const [x, y] = p(pt);
    if (x > 20 && x < 980 && y > 20 && y < 630) return name;
  }
  return null;
};
// Experiment (env ANCHORS=shift): slide the frame centre from the country toward an anchor, as far as possible while the
// whole country stays in view and the anchor is in view; widen the frame (x1.1) until some anchor is reachable.
function shiftFrame(cx, cy, pts, base, iso) {
  const proj = (c, mi) => frameProjection(c, mi, 1000, 650);
  const inView = (p, pt, m) => { const q = p(pt); return q && q[0] > m && q[0] < 1000 - m && q[1] > m && q[1] < 650 - m; };
  for (let mi = base; mi <= MAX_ANCHOR_MI; mi = Math.round(mi * 1.1)) {
    let best = null;
    // Nearest anchor first (a country's own landmass wins); a farther one is only used when the nearer cannot be brought into view at this width.
    for (const [name, a] of Object.entries(ANCHORS).sort((p, q) => (p[0] === PREFER_ANCHOR[iso] ? -1 : q[0] === PREFER_ANCHOR[iso] ? 1 : 0) || geoDistance([cx, cy], p[1]) - geoDistance([cx, cy], q[1]))) {
      if (best) break;
      if (geoDistance([cx, cy], a) > 2.6) continue;
      // Straight line in lon/lat (not a great circle): the centre stays between the country's and the anchor's latitudes, so the
      // Mercator frame never balloons near the poles.
      const dl = ((a[0] - cx + 540) % 360) - 180;
      const lerp = (t) => [cx + t * dl, cy + t * (a[1] - cy)];
      for (let k = 20; k >= 0; k--) {
        const t = k / 20, c = lerp(t), p = proj(c, mi);
        if (pts.every((pt) => inView(p, pt, 30)) && inView(p, a, 20)) { if (!best || t > best.t) best = { name, t, c, mi }; break; }
      }
    }
    if (best) return best;
  }
  return null;
}
function scaleFrame(iso, target, skip) {
  const g = target.geometry;
  const polys = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
  const areas = polys.map((c) => geoArea({ type: 'Polygon', coordinates: c }));
  // Ignore small overseas bits, except where the islands are part of the country's own landmass (Canada's Arctic islands).
  const main = polys.filter((_, i) => areas[i] >= Math.max(...areas) * (iso === 'CAN' ? 0.01 : 0.08));
  const [lc] = geoCentroid({ type: 'MultiPolygon', coordinates: main });
  let lo = 1e9, hi = -1e9, s0 = 90, n0 = -90;
  for (const c of main) for (const ring of c) for (const [x, y] of ring) {
    const d = ((x - lc + 540) % 360) - 180;
    lo = Math.min(lo, d); hi = Math.max(hi, d); s0 = Math.min(s0, y); n0 = Math.max(n0, y);
  }
  // Countries that reach far north (Canada): centre on the middle of the Mercator span, not of the latitude range.
  const my = (l) => Math.log(Math.tan(Math.PI / 4 + (l * Math.PI) / 360));
  const cx = lc + (lo + hi) / 2, cy = MERC_CENTRE.has(iso) ? ((2 * Math.atan(Math.exp((my(s0) + my(n0)) / 2)) - Math.PI / 2) * 180) / Math.PI : (s0 + n0) / 2;
  const extent = Math.max((hi - lo) * Math.cos((cy * Math.PI) / 180) * 69.17, (n0 - s0) * 69.17);
  let miles = NO_TIERS ? (FLOOR_OVERRIDE[iso] || FLOOR_MI) : TIERS.find(([m]) => extent <= m)[1];
  if (!NO_TIERS && miles === TIERS[0][1]) {
    const share = (mi) => {
      const p = frameProjection([cx, cy], mi, 1000, 650);
      let hit = 0, tot = 0;
      for (let i = 0; i < 20; i++) for (let j = 0; j < 13; j++) {
        const pt = p.invert([(i + 0.5) * 50, (j + 0.5) * 50]);
        tot++;
        if (pt && land.some((f) => !skip(f) && inBox(f, pt) && geoContains(f, pt))) hit++;
      }
      return hit / tot;
    };
    while (miles < MICRO_MAX && share(miles) < MICRO_SHARE) miles = Math.round(miles * 1.2);
  }
  const base = miles;
  if (FIT_ISOS.has(iso)) {
    const geom = { type: 'MultiPolygon', coordinates: main };
    const trial = Math.max(1000, Math.round(extent / FIT_SHARE)); // bounds scale linearly with the frame, so a floor keeps tiny countries from rounding to 0 mi
    const [[a0, b0], [a1, b1]] = geoPath(frameProjection([cx, cy], trial, FIT_SIZE, FIT_SIZE)).bounds(geom);
    // bounds scale linearly with the frame: resize so the country's larger side is FIT_SHARE of the canvas (never below FIT_MIN_CANVAS_MI)
    const mi = Math.max(FIT_MIN_CANVAS_MI, Math.round((trial * Math.max(a1 - a0, b1 - b0)) / (FIT_SIZE * FIT_SHARE)));
    FIT[iso] = { geom, mi };
    REGIONS['scale:' + iso] = { center: [cx, cy], miles: mi };
    console.log(`   fit canvas: ${iso} centred, ${mi} mi on ${FIT_SIZE}px`);
    return 'scale:' + iso;
  }
  if (COVER_ISOS.has(iso)) { const mi = Math.max(COVER_MIN_MI, Math.round(extent * COVER_FACTOR)); REGIONS['scale:' + iso] = { center: [cx, cy], miles: mi }; console.log(`   cover test: ${iso} centred, ${mi} mi (extent ${Math.round(extent)})`); return 'scale:' + iso; }
  let anchor = null;
  if (SHIFT) {
    const pts = [];
    for (const c of main) for (const ring of c) ring.forEach((pt, i) => { if (i % 4 === 0) pts.push(pt); });
    const best = shiftFrame(cx, cy, pts, miles, iso);
    if (best) { REGIONS['scale:' + iso] = { center: best.c, miles: best.mi }; console.log(`   shift: ${iso} ${base} -> ${best.mi} mi, toward ${best.name} (${Math.round(best.t * 100)}% of the way)`); return 'scale:' + iso; }
    console.log(`   shift: ${iso} no anchor reachable, centred`);
  } else if (process.env.ANCHORS === 'widen') {
    while (!(anchor = anchorIn(cx, cy, miles)) && miles < MAX_ANCHOR_MI) miles = Math.round(miles * 1.1);
    if (miles !== base) console.log(`   anchor rule: ${iso} ${base} -> ${miles} mi (${anchor || 'none found'})`);
  }
  const name = 'scale:' + iso;
  REGIONS[name] = { center: [cx, cy], miles };
  return name;
}

const BOX_FILE = process.env.BOX_FILE || 'build/fit/boxes.json';
const OUT = process.env.OUT_DIR || 'build/media';
const only = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const insetBackdrop = [...shapes.values()];
let n = 0;
const t0 = Date.now();
const todo = COUNTRIES.filter((c) => !only.length || only.includes(c.iso));
const jobs = Math.min(Number(process.env.JOBS) || os.availableParallelism(), todo.length);
if (jobs > 1 && !process.env.RENDER_WORKER) {
  // Parent: hand every worker a share (interleaved, so big and small countries mix) and merge their fit boxes afterwards.
  console.log(`Rendering ${todo.length} maps to ${OUT} on ${jobs} processes`);
  fs.mkdirSync('build/fit', { recursive: true });
  const parts = [];
  const codes = await Promise.all(Array.from({ length: jobs }, (_, i) => new Promise((res) => {
    const part = `build/fit/boxes.part${i}.json`;
    fs.rmSync(part, { force: true });
    parts.push(part);
    const isos = todo.filter((_, k) => k % jobs === i).map((c) => c.iso);
    spawn(process.execPath, [fileURLToPath(import.meta.url), ...isos], { stdio: 'inherit', env: { ...process.env, RENDER_WORKER: '1', BOX_FILE: part } }).on('exit', res);
  })));
  const merged = fs.existsSync(BOX_FILE) ? JSON.parse(fs.readFileSync(BOX_FILE, 'utf8')) : {};
  for (const part of parts) if (fs.existsSync(part)) { Object.assign(merged, JSON.parse(fs.readFileSync(part, 'utf8'))); fs.rmSync(part); }
  if (Object.keys(merged).length) fs.writeFileSync(BOX_FILE, JSON.stringify(merged));
  console.log('rendered', todo.length, 'countries in', Math.round((Date.now() - t0) / 1000), 's');
  process.exit(codes.some((c) => c) ? 1 : 0);
}
if (!process.env.RENDER_WORKER) console.log(`Rendering ${todo.length} maps to ${OUT}`);
for (const c of todo) {
  const t1 = Date.now();
  const target = shapes.get(c.iso);
  const num = numeric(c.iso);
  const isTarget = (f) => f === target || f.id === c.iso || (num && +f.id === num) || (c.iso === 'XKX' && f.properties?.name === 'Kosovo');
  const region = scaleFrame(c.iso, target, isTarget);
  const fitMode = FIT_ISOS.has(c.iso);
  let svgText = renderSvg(target, region, { isTarget, insetBackdrop, labels: !!process.env.LABELS, continents: !process.env.NO_CONTINENTS, ...(fitMode ? { w: FIT_SIZE, h: FIT_SIZE, ui: FIT_UI } : {}) });
  if (fitMode) {
    const [[x0, y0], [x1, y1]] = geoPath(frameProjection(REGIONS[region].center, REGIONS[region].miles, FIT_SIZE, FIT_SIZE)).bounds(FIT[c.iso].geom);
    fs.mkdirSync('build/fit', { recursive: true });
    const boxes = fs.existsSync(BOX_FILE) ? JSON.parse(fs.readFileSync(BOX_FILE, 'utf8')) : {};
    boxes[c.iso] = [x0, y0, x1, y1].map((v) => +(v / FIT_SIZE).toFixed(4)).concat(+(FIT_CONTEXT_MI / FIT[c.iso].mi).toFixed(4)); // 5th value: share of the canvas that is FIT_CONTEXT_MI miles (the card never zooms in past it)
    fs.writeFileSync(BOX_FILE, JSON.stringify(boxes));
    console.log('   box', boxes[c.iso].join(','));
  }
  if (COVER_ISOS.has(c.iso)) svgText = svgText.replace('preserveAspectRatio="none"', 'preserveAspectRatio="xMidYMid slice"');
  fs.writeFileSync(`${OUT}/map-${c.iso}.svg`, svgText);
  if (ZOOM[c.iso] || landKm2[c.iso] < ZOOM_MAX_KM2) {
    const z = ZOOM[c.iso] || {};
    const outline = z.outline ? outlineFeature(c.iso, z.outline) : target;
    const zoom = renderZoomSvg(outline, z.enclave ? [] : z.backdrop ? [outlineFeature('backdrop', z.backdrop)] : insetBackdrop, { isTarget: (f) => isTarget(f) || f === outline, surround: z.enclave ? 'land' : 'ocean' });
    if (zoom) fs.writeFileSync(`${OUT}/zoom-${c.iso}.svg`, zoom);
    else console.log(`   no zoom for ${c.iso}: too spread out`);
  }
  n++;
  const kb = Math.round(fs.statSync(`${OUT}/map-${c.iso}.svg`).size / 1024);
  const eta = Math.round(((Date.now() - t0) / n) * (todo.length - n) / 1000);
  console.log(`[${String(n).padStart(3)}/${todo.length}] ${c.iso} ${(c.name || '').padEnd(28)} ${String(REGIONS[region].miles).padStart(6)} mi  ${String(kb).padStart(4)} KB  ${Date.now() - t1} ms  (~${eta}s left)`);
}
console.log('rendered', n, 'countries in', Math.round((Date.now() - t0) / 1000), 's');
