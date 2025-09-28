// metrics.js
export function triArea(a,b,c){
  const ab = [b[0]-a[0], b[1]-a[1], b[2]-a[2]];
  const ac = [c[0]-a[0], c[1]-a[1], c[2]-a[2]];
  const cx = ab[1]*ac[2] - ab[2]*ac[1];
  const cy = ab[2]*ac[0] - ab[0]*ac[2];
  const cz = ab[0]*ac[1] - ab[1]*ac[0];
  return 0.5 * Math.sqrt(cx*cx + cy*cy + cz*cz);
}
export function triSignedVolume(a,b,c){
  return (a[0]*(b[1]*c[2]-b[2]*c[1]) - a[1]*(b[0]*c[2]-b[2]*c[0]) + a[2]*(b[0]*c[1]-b[1]*c[0]))/6;
}

export function formatMetrics({ volume_mm3, area_mm2, bbox }){
  const out = {};
  if(volume_mm3!=null) out.volume = `${(volume_mm3/1000).toFixed(2)} cm³`;
  if(area_mm2!=null) out.area = `${(area_mm2/100).toFixed(2)} cm²`;
  if(bbox){
    const s = (v)=> v!=null ? v.toFixed(1) : '—';
    out.bbox = `${s(bbox.max.x - bbox.min.x)} × ${s(bbox.max.y - bbox.min.y)} × ${s(bbox.max.z - bbox.min.z)} mm`;
  }
  return out;
}
