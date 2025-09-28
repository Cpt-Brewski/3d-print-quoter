# 🛠️ Price Change Guide – Instant 3D Print Quoter

All pricing logic is in **[`pricing.js`](./pricing.js)**.

```js
export function price({ tech, layer, post, turnaround, qty, volume_mm3, infillPct }){
  const PRICING = {
    baseSetup: 3.5,
    tech: {
      fdm: { material: 0.08, timePerCm3: 0.12, hourly: 6.0 },
      sla: { material: 0.22, timePerCm3: 0.08, hourly: 10.0 },
      sls: { material: 0.18, timePerCm3: 0.10, hourly: 9.0 }
    },
    layerFactor: { '0.3': 0.9, '0.2': 1.0, '0.1': 1.3 },
    infillFactor(p) { return Math.max(0.3, (p/100) * 0.6 + 0.4); },
    postProcess: { none: 0, sanding: 2.5, priming: 5.0 },
    turnaround: { standard: 1.0, express: 1.15, rush: 1.35 },
    minPerUnit: 6.0
  };
  ...
}
```

---

## 🔑 Keys to Update

1. **Setup fee**
```js
baseSetup: 3.5,
```

2. **Technology-specific costs**
```js
tech: {
  fdm: { material: 0.08, timePerCm3: 0.12, hourly: 6.0 },
  sla: { material: 0.22, timePerCm3: 0.08, hourly: 10.0 },
  sls: { material: 0.18, timePerCm3: 0.10, hourly: 9.0 }
}
```
- `material`: £ per cm³  
- `timePerCm3`: estimated hours per cm³  
- `hourly`: £ per hour machine time  

3. **Layer height factor**
```js
layerFactor: { '0.3': 0.9, '0.2': 1.0, '0.1': 1.3 },
```
- Adjust multipliers for slower/finer layer heights.

4. **Infill formula (FDM only)**
```js
infillFactor(p) { return Math.max(0.3, (p/100) * 0.6 + 0.4); }
```
- Defines how infill % scales cost.

5. **Post-processing**
```js
postProcess: { none: 0, sanding: 2.5, priming: 5.0 },
```
- Add new finishing types or adjust costs here.

6. **Turnaround multipliers**
```js
turnaround: { standard: 1.0, express: 1.15, rush: 1.35 },
```

7. **Minimum per unit charge**
```js
minPerUnit: 6.0
```

---

## ✅ Examples

### Raise SLA hourly rate to £12
```js
sla: { material: 0.22, timePerCm3: 0.08, hourly: 12.0 }
```

### Add "Polishing" post-process
```js
postProcess: { none: 0, sanding: 2.5, priming: 5.0, polishing: 8.0 }
```
