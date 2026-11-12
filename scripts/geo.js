// Country shapes (Natural Earth 10m), land borders (shared arcs) and map regions for the 197 countries.
import fs from 'node:fs';
import { topology } from 'topojson-server';
import { feature, neighbors } from 'topojson-client';

const dir = new URL('../', import.meta.url);
export const COUNTRIES = JSON.parse(fs.readFileSync(new URL('data/countries.json', dir), 'utf8'));
const ne = JSON.parse(fs.readFileSync(new URL('data/raw/natural-earth/ne_10m_admin_0_countries.json', dir), 'utf8'));

const key = (iso) => (iso === 'XKX' ? 'KOS' : iso);
const raw = new Map();
for (const f of ne.features) for (const k of [f.properties.ISO_A3_EH, f.properties.ADM0_A3, f.properties.ISO_A3]) if (k && !raw.has(k)) raw.set(k, f);

const pick = COUNTRIES.map((c) => {
  const f = raw.get(key(c.iso));
  if (!f) throw new Error(`No shape for ${c.iso}`);
  return { type: 'Feature', id: c.iso, properties: { iso: c.iso, continent: f.properties.CONTINENT }, geometry: f.geometry };
});
const topo = topology({ countries: { type: 'FeatureCollection', features: pick } });
const geoms = topo.objects.countries.geometries;
const adj = neighbors(geoms);
// Round-tripping through topojson rewinds the rings to the winding d3 expects.
export const shapes = new Map(feature(topo, topo.objects.countries).features.map((f) => [f.id, f]));
const idx = new Map(geoms.map((g, i) => [g.id, i]));

export const borders = (iso) => adj[idx.get(iso)].map((j) => geoms[j].id);

// Map region per country. Region box and display label can differ (Russia).
export const regionOf = (iso) => {
  if (iso === 'RUS') return 'Northern Eurasia';
  const c = shapes.get(iso).properties.continent;
  return { Africa: 'Africa', Europe: 'Europe', Asia: 'Asia', Oceania: 'Oceania', 'North America': 'North America', 'South America': 'South America' }[c] || 'Asia';
};
export const regionLabel = (iso) => (iso === 'RUS' ? 'Europe' : regionOf(iso));

// ISO numeric code (as used by the 50m atlas ids) for matching the target out of the atlas backdrop.
export const numeric = (iso) => +raw.get(key(iso)).properties.ISO_N3_EH || null;
