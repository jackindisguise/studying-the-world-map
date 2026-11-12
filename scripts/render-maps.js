// Renders one PNG per country: a regional map with the country highlighted and no labels.
// Tiny countries also get a ring on the main map and a zoomed inset. Usage: node render-maps.js [name ...]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { feature, merge } from 'topojson-client';
import { geoMercator, geoPath, geoNaturalEarth1, geoCentroid, geoBounds, geoContains, geoArea, geoAzimuthalEquidistant } from 'd3-geo';
import { Resvg } from '@resvg/resvg-js';

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const W = 1000, H = 650;
const COLORS = { ...{ ocean: '#7fb0d0', land: '#f4f1e6', border: '#8f897a', target: '#d9381e', ring: '#d9381e' }, ...JSON.parse(process.env.MAP_COLORS || '{}') };

// lon/lat boxes [west, south, east, north]; rotate shifts the antimeridian for the Pacific.
export const REGIONS = {
  Africa: { box: [-27, -36, 60, 38] },
  Europe: { box: [-25, 34, 45, 72] },
  Asia: { box: [25, -11, 150, 56] },
  'Northern Eurasia': { box: [10, 35, 190, 80], rotate: [-100, 0] },
  'North America': { box: [-170, 5, -50, 80] },
  'South America': { box: [-85, -57, -32, 14] },
  Oceania: { box: [110, -48, 212, 14], rotate: [-150, 0] },
};

const topo = JSON.parse(fs.readFileSync(path.join(HERE, 'node_modules/world-atlas/countries-50m.json'), 'utf8'));
export const land = feature(topo, topo.objects.countries).features;
export const byName = (n) => land.find((f) => f.properties.name === n);

// Sampled points along the box edge: a Polygon fit would treat the edges as great circles and fit the whole globe.
function boxPoints([w, s, e, n]) {
  const pts = [];
  for (let i = 0; i <= 20; i++) {
    const x = w + ((e - w) * i) / 20, y = s + ((n - s) * i) / 20;
    pts.push([x, s], [x, n], [w, y], [e, y]);
  }
  return { type: 'MultiPoint', coordinates: pts };
}

// North-up frame of a fixed ground width: Mercator centred on [lon, lat], scaled so distances are true at the centre latitude.
export function frameProjection([lon, lat], miles, w = W, h = H) {
  return geoMercator().rotate([-lon, 0]).center([0, lat]).scale((w / miles) * 3959 * Math.cos((lat * Math.PI) / 180)).translate([w / 2, h / 2]);
}
function projectionFor(box, rotate, w, h, frac = 1) {
  const p = geoNaturalEarth1().rotate(rotate || [0, 0]);
  p.fitExtent([[0, 0], [w, h * frac]], boxPoints(box));
  p.clipExtent([[-20, -20], [w + 20, h + 20]]); // nothing outside the canvas is written to the SVG
  return p;
}

// Drops vertices closer than `min` px to the previous kept one (sub-pixel detail nobody can see); keeps the last point before each Z.
function thin(d, min = 0.5) {
  let px = 0, py = 0;
  return d.replace(/([MLZ])([^MLZ]*)/g, (m, c, rest) => {
    if (c === 'Z') return m;
    const [x, y] = rest.split(',').map(Number);
    if (c === 'L' && Math.hypot(x - px, y - py) < min) return '';
    px = x; py = y;
    return m;
  });
}

function panel(proj, target, w, h, ring, backdrop, isTarget, withDots = false, dotR = 2, ui = 1) {
  const path = geoPath(proj).digits(1);
  const bg = `<path d="${thin(backdrop.filter((f) => !isTarget(f)).map((f) => path(f)).filter(Boolean).join(''))}" fill="${COLORS.land}" stroke="${COLORS.border}" stroke-width="${0.8 * ui}"/>`;
  const hit = `<path d="${thin(path(target) || '')}" fill="${COLORS.target}" stroke="${COLORS.target}" stroke-width="${0.6 * ui}"/>`;
  let mark = withDots || ring ? dots(proj, target, dotR) : '';
  if (ring) {
    const [x, y] = proj(geoCentroid(target));
    mark += `<circle cx="${x}" cy="${y}" r="${ring}" fill="none" stroke="${COLORS.ring}" stroke-width="3"/>`;
  }
  return bg + hit + mark;
}

// Minimum-size marker: every part of the target that covers less than ~10 px gets a solid red dot, so the ring never looks empty.
function dots(proj, target, r = 2) {
  const g = target.geometry || target;
  const parts = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
  const gp = geoPath(proj);
  let out = '';
  for (const c of parts) {
    const poly = { type: 'Polygon', coordinates: c };
    if (gp.area(poly) >= Math.PI * r * r) continue;
    const p = proj(geoCentroid(poly));
    if (p) out += `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${r}" fill="${COLORS.target}"/>`;
  }
  return out;
}

// Neighbour names: one label per visible country, centred on the visible part (above it when it is tiny), biggest first;
// labels that would overlap an earlier one are skipped.
// Only large countries (>= LABEL_MIN_KM2) are labelled, so clusters of small islands do not fill the map with text.
const LABEL_MIN_KM2 = 200000;
// ---- Continent labels ----
// One merged outline per continent (borders between its countries dissolved), from the 50m atlas plus Natural Earth's CONTINENT tags.
let CONT = null;
const IDEAL = { Africa: [20, 3], Asia: [95, 45], Europe: [20, 52], 'North America': [-100, 45], 'South America': [-60, -12], Oceania: [134, -25], Antarctica: [0, -82] };
function continents() {
  if (CONT) return CONT;
  const ne = JSON.parse(fs.readFileSync(path.join(HERE, 'data/raw/natural-earth/ne_10m_admin_0_countries.json'), 'utf8'));
  const byNum = new Map(ne.features.map((f) => [+f.properties.ISO_N3, f.properties.CONTINENT]));
  const groups = {};
  for (const g of topo.objects.countries.geometries) {
    const c = byNum.get(+g.id);
    if (c && IDEAL[c]) (groups[c] ||= []).push(g);
  }
  CONT = Object.fromEntries(Object.entries(groups).map(([name, gs]) => [name, merge(topo, gs)]));
  return CONT;
}
// Path tokens "M x,y L x,y ... Z" -> segments [x1, y1, x2, y2] that are not along the clip border.
function segments(d, w, h) {
  const segs = [];
  let prev = null, start = null;
  for (const m of d.matchAll(/([MLZ])([^MLZ]*)/g)) {
    if (m[1] === 'Z') { if (prev && start) segs.push([prev[0], prev[1], start[0], start[1]]); prev = null; continue; }
    const [x, y] = m[2].split(',').map(Number);
    if (m[1] === 'M') start = [x, y];
    else if (prev) segs.push([prev[0], prev[1], x, y]);
    prev = [x, y];
  }
  const out = (x, y) => x < -15 || x > w + 15 || y < -15 || y > h + 15;
  return segs.filter(([a, b, c, e]) => !(out(a, b) && out(c, e)));
}
function continentLabels(proj, w, h, target, maxSize = 24, minSize = 11) {
  const gp = geoPath(proj).digits(1);
  const all = continents();
  const G = 10, gw = Math.ceil(w / G), gh = Math.ceil(h / G);
  // 1 where the centre of a grid cell is inside geom: the outline is drawn with resvg at 1 px per cell and the pixels are read back.
  const mask = (geom) => {
    const d = gp(geom) || '';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
    const r = new Resvg(svg, { fitTo: { mode: 'width', value: gw } }).render();
    const px = r.pixels, rw = r.width, m = new Uint8Array(gw * gh);
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) m[j * gw + i] = px[((Math.min(j, r.height - 1)) * rw + i) * 4] < 128 ? 1 : 0;
    return m;
  };
  const at = (m, x, y) => { const i = Math.floor(x / G), j = Math.floor(y / G); return i >= 0 && j >= 0 && i < gw && j < gh ? m[j * gw + i] : 0; };
  const tgt = mask(target);
  let out = '';
  for (const [name, geom] of Object.entries(all)) {
    const [[bx0, by0], [bx1, by1]] = gp.bounds(geom);
    if (!isFinite(bx0) || Math.min(bx1, w) - Math.max(bx0, 0) < 60 || Math.min(by1, h) - Math.max(by0, 0) < 40) continue;
    const m = mask(geom);
    const samples = [];
    for (let j = 0; j < gh; j += 2) for (let i = 0; i < gw; i += 2) if (m[j * gw + i]) samples.push([i * G + G / 2, j * G + G / 2]);
    if (samples.length < 6) continue;
    const mean = samples.reduce((a, p) => [a[0] + p[0] / samples.length, a[1] + p[1] / samples.length], [0, 0]);
    const ip = proj(IDEAL[name]);
    const ideal = ip && ip[0] > 40 && ip[0] < w - 40 && ip[1] > 30 && ip[1] < h - 30 && at(m, ip[0], ip[1]) ? ip : mean;
    const segs = segments(gp(geom) || '', w, h);
    const angleAt = (p) => {
      let best = null, bd = 1e9;
      for (const [x1, y1, x2, y2] of segs) {
        const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((p[0] - x1) * dx + (p[1] - y1) * dy) / l2));
        const d = Math.hypot(p[0] - (x1 + t * dx), p[1] - (y1 + t * dy));
        if (d < bd) { bd = d; best = Math.atan2(dy, dx); }
      }
      if (best === null) return 0;
      let a = best;
      if (a > Math.PI / 2) a -= Math.PI; else if (a < -Math.PI / 2) a += Math.PI;
      return a;
    };
    // Prefer horizontal text. At the biggest size try angles 0, +-5 ... +-45 (the tilt direction the nearest coast suggests first),
    // and only when none fits shrink by 1 and try again. A box fits when no sample touches the highlighted country and at most
    // OVERHANG of the samples poke outside the continent (a few letters grazing the coast).
    const OVERHANG = 0.06, MAX_TILT = 45;
    const fitAt = (p, a, size) => {
      const c = Math.cos(a), sn = Math.sin(a);
      const tw = name.length * size * 0.95, hh = size * 0.65;
      let n = 0, bad = 0;
      for (let u = -tw / 2; u <= tw / 2; u += 6) for (const v of [-hh, 0, hh]) {
        const x = p[0] + u * c - v * sn, y = p[1] + u * sn + v * c;
        if (x < 8 || x > w - 8 || y < 10 || y > h - 10 || at(tgt, x, y)) return false;
        n++;
        if (!at(m, x, y)) bad++;
      }
      return bad <= n * OVERHANG;
    };
    const fitBest = (p) => {
      const tan = angleAt(p), sign = tan >= 0 ? 1 : -1;
      const angles = [0];
      for (let d = 5; d <= MAX_TILT; d += 5) angles.push((sign * d * Math.PI) / 180, (-sign * d * Math.PI) / 180);
      for (let size = maxSize; size >= minSize; size--) for (const a of angles) if (fitAt(p, a, size)) return { p, a, size };
      return null;
    };
    const cands = [ideal, ...samples.slice().sort((a, b) => Math.hypot(a[0] - ideal[0], a[1] - ideal[1]) - Math.hypot(b[0] - ideal[0], b[1] - ideal[1]))].slice(0, 100);
    const scored = [];
    let maxS = 0;
    for (const p of cands) { const r = fitBest(p); if (r) { scored.push(r); maxS = Math.max(maxS, r.size); } }
    // Closest-to-centre spot that still gets nearly the biggest size on offer, flattest tilt first among equals.
    const pick = scored.find((c) => c.size >= Math.max(minSize, maxS * 0.9));
    if (!pick) continue;
    out += `<text transform="translate(${pick.p[0].toFixed(1)},${pick.p[1].toFixed(1)}) rotate(${((pick.a * 180) / Math.PI).toFixed(1)})" text-anchor="middle" dominant-baseline="middle" font-family="Segoe UI, Arial, sans-serif" font-weight="700" font-size="${pick.size}" letter-spacing="${(pick.size / 4.4).toFixed(1)}" fill="#27323c" fill-opacity="0.62" stroke="#ffffff" stroke-opacity="0.6" stroke-width="3" paint-order="stroke">${name.toUpperCase()}</text>`;
  }
  return out;
}

// The US feature is split so Hawaii and Alaska get their own labels when only those parts are in view.
const SHORT = { 'United States of America': 'United States', 'Dem. Rep. Congo': 'DR Congo', 'Papua New Guinea': 'Papua New Guinea' };
function splitUS(f) {
  if (f.properties?.name !== 'United States of America' || f.geometry.type !== 'MultiPolygon') return [f];
  const parts = { Hawaii: [], Alaska: [], 'United States': [] };
  for (const c of f.geometry.coordinates) {
    const [x, y] = geoCentroid({ type: 'Polygon', coordinates: c });
    (x > -161 && x < -154 && y > 18 && y < 23 ? parts.Hawaii : x < -129 && y > 50 ? parts.Alaska : parts['United States']).push(c);
  }
  return Object.entries(parts).filter(([, v]) => v.length).map(([name, v]) => ({ type: 'Feature', properties: { name, keep: name !== 'United States' }, geometry: { type: 'MultiPolygon', coordinates: v } }));
}
function countryLabels(proj, feats, w, h, size = 15) {
  const gp = geoPath(proj);
  const cand = [];
  for (const f of feats.flatMap(splitUS)) {
    if (!f.properties.keep && geoArea(f) * 6371 * 6371 < LABEL_MIN_KM2) continue;
    const [[x0, y0], [x1, y1]] = gp.bounds(f);
    if (!isFinite(x0)) continue;
    const vx0 = Math.max(x0, 0), vy0 = Math.max(y0, 0), vx1 = Math.min(x1, w), vy1 = Math.min(y1, h);
    if (vx1 - vx0 < 3 || vy1 - vy0 < 3) continue;
    let cx = (vx0 + vx1) / 2, cy = (vy0 + vy1) / 2;
    const g = proj.invert([cx, cy]);
    if (!(g && geoContains(f, g))) { const c = gp.centroid(f); if (c && isFinite(c[0]) && c[0] > 0 && c[0] < w && c[1] > 0 && c[1] < h) { cx = c[0]; cy = c[1]; } }
    cand.push({ name: SHORT[f.properties.name] || f.properties.name, cx, cy, area: (vx1 - vx0) * (vy1 - vy0), small: vx1 - vx0 < 24 && vy1 - vy0 < 24 });
  }
  cand.sort((a, b) => b.area - a.area);
  const placed = [];
  let out = '';
  for (const c of cand) {
    const tw = c.name.length * size * 0.52;
    const x = c.cx, y = c.small ? c.cy - 10 : c.cy;
    const box = [x - tw / 2 - 2, y - size, x + tw / 2 + 2, y + 4];
    if (box[0] < 2 || box[2] > w - 2 || box[1] < 2 || box[3] > h - 2) continue;
    if (placed.some((p) => box[0] < p[2] && box[2] > p[0] && box[1] < p[3] && box[3] > p[1])) continue;
    placed.push(box);
    out += `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="${size}" fill="#2b2f33" stroke="#ffffff" stroke-width="3.5" stroke-linejoin="round" paint-order="stroke">${c.name.replace(/&/g, '&amp;')}</text>`;
  }
  return out;
}

// opts: w/h canvas size; frac = share of the height the region is fitted into (the rest shows more map, which a bottom
// details panel can cover); iw/ih = inset size.
// opts.backdrop / opts.isTarget / opts.insetBackdrop let callers draw the neighbours from other data than the 50m atlas.
export function renderSvg(target, regionName, { w = W, h = H, frac = 1, iw = 300, ih = 240, backdrop = land, isTarget = (f) => f === target, insetBackdrop = null, labels = false, continents = false, ui = 1 } = {}) {
  const reg = REGIONS[regionName];
  if (!reg) throw new Error(`Unknown region ${regionName}`);
  // reg.center + reg.miles: true-distance frame, `miles` wide, centred on [lon, lat] (azimuthal equidistant).
  const proj = reg.center ? frameProjection(reg.center, reg.miles, w, h).clipExtent([[-20, -20], [w + 20, h + 20]]) : projectionFor(reg.box, reg.rotate, w, h, frac);
  const area = geoPath(proj).area(target);
  const tiny = area < 60;
  const small = area < 400;
  // The ring is only for places whose whole outline is a few pixels across; scattered islands (Maldives) are visible without it.
  const [[bx0, by0], [bx1, by1]] = geoPath(proj).bounds(target);
  const speck = small && Math.max(bx1 - bx0, by1 - by0) < 16;
  const ringSize = 0; // no ring any more: the minimum-size dot (bigger for specks) marks tiny places
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">`;
  svg += `<defs><clipPath id="c"><rect width="${w}" height="${h}"/></clipPath></defs>`;
  svg += `<rect width="${w}" height="${h}" fill="${COLORS.ocean}"/><g clip-path="url(#c)">${panel(proj, target, w, h, ringSize, backdrop, isTarget, small, speck ? 3.5 * ui : 2 * ui, ui)}</g>`;
  if (continents) svg += continentLabels(proj, w, h, target, 24 * ui, 11 * ui);
  if (labels) svg += countryLabels(proj, backdrop.filter((f) => !isTarget(f) && f.properties?.name), w, h);
  if (tiny && !regionName.startsWith('tight:') && !reg.center) {
    // Zoomed inset: a window about 7 degrees around the country, bottom-left of the visible part (top-left if the ring is down there).
    const [lon, lat] = geoCentroid(target);
    const [[bw, bs], [be, bn]] = geoBounds(target);
    const half = Math.max(3.5, (bn - bs) / 2 + 1.5, ((be - bw + 360) % 360) / 2.5 + 1.5);
    const ip = projectionFor([lon - half * 1.25, lat - half, lon + half * 1.25, lat + half], reg.rotate, iw, ih);
    const [cx, cy] = proj([lon, lat]);
    const vis = h * frac;
    const top = cx < iw + 80 && cy > vis - ih - 80;
    const ox = 14, oy = top ? 14 : vis - ih - 14;
    const ipath = geoPath(ip).digits(1);
    const near = `<path d="${thin((insetBackdrop || backdrop).filter((f) => !(f === target || isTarget(f))).map((f) => ipath(f)).filter(Boolean).join(''))}" fill="${COLORS.land}" stroke="${COLORS.border}" stroke-width="1"/>`;
    const [ix, iy] = ip([lon, lat]);
    svg += `<g transform="translate(${ox},${oy})"><clipPath id="i"><rect width="${iw}" height="${ih}"/></clipPath>`;
    svg += `<rect width="${iw}" height="${ih}" fill="${COLORS.ocean}"/><g clip-path="url(#i)">${near}`;
    svg += `<path d="${thin(ipath(target) || '')}" fill="${COLORS.target}" stroke="${COLORS.target}" stroke-width="1.5"/>`;
    svg += `${dots(ip, target)}<circle cx="${ix}" cy="${iy}" r="14" fill="none" stroke="${COLORS.ring}" stroke-width="3"/></g>`;
    svg += `<rect width="${iw}" height="${ih}" fill="none" stroke="#33414d" stroke-width="3"/></g>`;

 }
  return svg + '</svg>';
}

// Portrait (tall, 6:13) version for phones held upright: the region sits in the top half, the details panel covers the rest.
export const PORTRAIT = { w: 720, h: 1560, frac: 0.5, iw: 250, ih: 200 };
