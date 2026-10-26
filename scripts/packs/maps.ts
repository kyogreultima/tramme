// The maps pack's data, converted once from Natural Earth (public domain):
// the countries at 1:110m and 1:50m, the first-level regions at 1:50m, and
// the populated places, simplified and quantised to 1e-4° into plugins/maps/.
//
//   node scripts/packs/maps.ts            # write plugins/maps/
//
// Sources (written here so the provenance is the script's):
//   martynafford/natural-earth-geojson (a conversion of Natural Earth 5.1.1):
//     110m/cultural/ne_110m_admin_0_countries.json
//     50m/cultural/ne_50m_admin_0_countries.json
//     50m/cultural/ne_50m_admin_1_states_provinces.json
//     10m/cultural/ne_10m_populated_places_simple.json

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(import.meta.dirname, '../../plugins/maps');
const RAW = 'https://raw.githubusercontent.com/martynafford/natural-earth-geojson/master/';
const Q = 1e4; // quantised to 1e-4°: about 11 m at the equator

interface Ring { pts: [number, number][]; }

/** the points of a ring, decimated to the step and quantised to 1e-4° */
function simplify(ring: number[][], step: number): [number, number][] {
  const out: [number, number][] = [];
  let last: [number, number] | null = null;
  for (const c of ring) {
    const p: [number, number] = [Math.round(c[0] * Q) / Q, Math.round(c[1] * Q) / Q];
    if (!last || Math.abs(p[0] - last[0]) >= step || Math.abs(p[1] - last[1]) >= step) { out.push(p); last = p; }
  }
  // a ring keeps its closure: the first point again at the end
  if (out.length > 2) {
    const a = out[0], b = out[out.length - 1];
    if (a[0] !== b[0] || a[1] !== b[1]) out.push([a[0], a[1]]);
  }
  return out.length >= 4 ? out : [];
}

function ringsOf(geom: { type: string; coordinates: unknown }): Ring[] {
  const push = (poly: number[][][], out: Ring[]) => { for (const ring of poly ?? []) { const pts = simplify(ring, 0.01); if (pts.length) out.push({ pts }); } };
  const out: Ring[] = [];
  if (geom.type === 'Polygon') push(geom.coordinates as number[][][], out);
  else if (geom.type === 'MultiPolygon') for (const poly of geom.coordinates as number[][][][]) push(poly, out);
  return out;
}

const fetchJson = async (url: string) => (await fetch(url)).json();

mkdirSync(OUT, { recursive: true });

const countries = async (file: string, step: number) => {
  const data = await fetchJson(RAW + file);
  return {
    source: 'Natural Earth (public domain), 1e-4°',
    countries: data.features.map((f: { properties: Record<string, unknown>; geometry: unknown }) => ({
      name: String(f.properties.NAME ?? f.properties.name ?? ''),
      iso: String(f.properties.ISO_A2_EH ?? f.properties.ISO_A2 ?? ''),
      continent: String(f.properties.CONTINENT ?? ''),
      rings: ringsOf(f.geometry),
    })).filter((c: { name: string; rings: Ring[] }) => c.name && c.rings.length),
  };
};

const places = async () => {
  const data = await fetchJson(RAW + '10m/cultural/ne_10m_populated_places_simple.json');
  return {
    source: 'Natural Earth (public domain), populated places',
    places: data.features.map((f: { properties: Record<string, unknown>; geometry: { coordinates: number[] } }) => {
      const p = f.properties;
      const alt = String(p.namealt ?? '').split(/[|,]/).map((s: string) => s.trim()).filter(Boolean);
      return {
        name: String(p.name ?? ''),
        alt,
        country: String(p.adm0name ?? ''),
        lon: Math.round(f.geometry.coordinates[0] * Q) / Q,
        lat: Math.round(f.geometry.coordinates[1] * Q) / Q,
        pop: Number(p.pop_max ?? 0),
        capital: p.featurecla === 'Admin-0 capital',
      };
    }).filter((x: { name: string }) => x.name),
  };
};

writeFileSync(join(OUT, 'countries-110m.json'), JSON.stringify(await countries('110m/cultural/ne_110m_admin_0_countries.json', 0.02)));
writeFileSync(join(OUT, 'countries-50m.json'), JSON.stringify(await countries('50m/cultural/ne_50m_admin_0_countries.json', 0.005)));
const regions = await fetchJson(RAW + '50m/cultural/ne_50m_admin_1_states_provinces.json');writeFileSync(join(OUT, 'regions-50m.json'), JSON.stringify({
  source: 'Natural Earth (public domain), 1e-4°',
  regions: regions.features.map((f: { properties: Record<string, unknown>; geometry: unknown }) => ({
    name: String(f.properties.name ?? ''),
    country: String(f.properties.admin ?? ''),
    rings: ringsOf(f.geometry),
  })).filter((r: { name: string; rings: Ring[] }) => r.name && r.rings.length),
}));
writeFileSync(join(OUT, 'places.json'), JSON.stringify(await places()));
console.log('natural earth: countries 110m + 50m, regions 50m, places ->', OUT);
