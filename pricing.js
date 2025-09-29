export function price({ tech, layer, post, turnaround, qty, volume_mm3, infillPct }) {
  const PRICING = {
    baseSetup: 3.5,
    tech: {
      fdm: { material: 0.08, timePerCm3: 0.20, hourly: 1.0 },
      sla: { material: 0.18, timePerCm3: 0.23, hourly: 1.5 },
      sls: { material: 0.30, timePerCm3: 0.15, hourly: 15.0 }
    },
    // Adjusted layer factors for technology and layer height
    layerFactor: {
      fdm: { '0.3': 0.9, '0.2': 1.0, '0.1': 1.3 },
      sla: { '0.1': 1.1, '0.05': 1.0, '0.025': 1.4 },
      sls: { '0.15': 1.0, '0.1': 1.0, '0.08': 1.2 }
    },
    infillFactor(p) { return Math.max(0.3, (p / 100) * 0.6 + 0.4); },
     // New post-processing options added here
    postProcess: {
      none: 0,
      sanding: 5.0,
      priming: 2.5,
      painting: 7.0,    // New option
      assembly: 10.0,   // New option
      texturing: 6.0    // New option
    },
    turnaround: { standard: 1.0, express: 1.15, rush: 1.35 },
    minPerUnit: 4.0
  };

  const vol_cm3 = volume_mm3 / 1000;
  const cfg = PRICING.tech[tech];

  // Retrieve the correct layer factor based on technology and layer height
  const layerK = (PRICING.layerFactor[tech] && PRICING.layerFactor[tech][layer]) || 1.0;
  const infillK = tech === 'fdm' ? PRICING.infillFactor(infillPct) : 1.0;

  // Calculate the printing hours, material cost, and machine usage
  const hours = Math.max(0.3, vol_cm3 * cfg.timePerCm3 * layerK * infillK);
  const material = vol_cm3 * cfg.material * infillK;
  const machine = hours * cfg.hourly;

  // Calculate per unit price, including post-processing and turnaround adjustment
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
