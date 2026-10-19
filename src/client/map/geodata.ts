import { feature, mesh } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import countries110 from 'world-atlas/countries-110m.json';

export const W0 = 1024;
export const H0 = 512;

export const wx = (lon: number) => ((lon + 180) / 360) * W0;
export const wy = (lat: number) => ((90 - lat) / 180) * H0;

type Ring = number[][];

/** Unwrap a ring so consecutive points never jump across the antimeridian. */
function unwrap(ring: Ring): Ring {
  const out: Ring = [];
  let off = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x, y] = ring[i];
    if (i > 0) {
      const px = ring[i - 1][0];
      if (x - px > 180) off -= 360;
      else if (px - x > 180) off += 360;
    }
    out.push([x + off, y]);
  }
  return out;
}

function ringsToPath(rings: Ring[], close: boolean): Path2D {
  const p = new Path2D();
  for (const r of rings) {
    const u = unwrap(r);
    for (let i = 0; i < u.length; i++) {
      const x = wx(u[i][0]), y = wy(u[i][1]);
      if (i === 0) p.moveTo(x, y);
      else p.lineTo(x, y);
    }
    if (close) p.closePath();
  }
  return p;
}

function polygonsOf(geom: GeoJSON.Geometry): Ring[] {
  if (geom.type === 'Polygon') return geom.coordinates as Ring[];
  if (geom.type === 'MultiPolygon') return (geom.coordinates as Ring[][]).flat();
  return [];
}

export interface GeoLayer { land: Path2D; borders?: Path2D }

let low: GeoLayer | null = null;
export function lowRes(): GeoLayer {
  if (low) return low;
  const topo = countries110 as unknown as Topology;
  const landF = feature(topo, topo.objects.land as GeometryCollection) as unknown as GeoJSON.FeatureCollection;
  const rings = landF.features.flatMap((f) => polygonsOf(f.geometry));
  const b = mesh(topo, topo.objects.countries as GeometryCollection, (a, c) => a !== c);
  const borderLines = (b.type === 'MultiLineString' ? b.coordinates : [b.coordinates]) as Ring[];
  low = { land: ringsToPath(rings, true), borders: ringsToPath(borderLines, false) };
  return low;
}

let high: GeoLayer | null = null;
let loading = false;
/** 50m coastline, fetched lazily the first time the map is zoomed in. */
export function highRes(): GeoLayer | null {
  if (high || loading) return high;
  loading = true;
  fetch('/geo/land-50m.json')
    .then((r) => r.json())
    .then((topo: Topology) => {
      const f = feature(topo, topo.objects.land as GeometryCollection) as unknown as GeoJSON.FeatureCollection;
      const rings = f.features.flatMap((x) => polygonsOf(x.geometry));
      high = { land: ringsToPath(rings, true) };
    })
    .catch(() => {
      loading = false;
    });
  return null;
}
