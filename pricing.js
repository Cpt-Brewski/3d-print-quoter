// pricing.js
export function price({ tech, layer, post, turnaround, qty, volume_mm3, infillPct }){
  const PRICING = {
    baseSetup: 3.5,
    tech: {
      fdm: { material: 0.07, timePerCm3: 0.20, hourly: 1.0 },
      sla: { material: 0.18, timePerCm3: 0.30, hourly: 4.0 },
      sls: { material: 0.30, timePerCm3: 0.35, hourly: 10.0 }
    },
    layerFactor: { '0.3': 0.9, '0.2': 1.0, '0.1': 1.3 },
    infillFactor(p) { return Math.max(0.3, (p/100) * 0.6 + 0.4); },
    postProcess: { none: 0, sanding: 5.0, priming: 2.5 },
    turnaround: { standard: 1.0, express: 1.15, rush: 1.35 },
    minPerUnit: 4.0
  };
  const vol_cm3 = volume_mm3 / 1000;
  const cfg = PRICING.tech[tech];
  const layerK = PRICING.layerFactor[layer] || 1.0;
  const infillK = tech === 'fdm' ? PRICING.infillFactor(infillPct) : 1.0;
  const hours = Math.max(0.3, vol_cm3 * cfg.timePerCm3 * layerK * infillK);
  const material = vol_cm3 * cfg.material * infillK;
  const machine = hours * cfg.hourly;
  let perUnit = Math.max(PRICING.baseSetup + material + machine, PRICING.minPerUnit);
  perUnit += PRICING.postProcess[post] || 0;
  perUnit *= PRICING.turnaround[turnaround] || 1.0;
  return {
    hours, material, machine,
    setup: PRICING.baseSetup,
    finishing: PRICING.postProcess[post] || 0,
    perUnit, total: perUnit * qty
  };
}
