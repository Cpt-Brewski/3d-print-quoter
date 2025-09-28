# Instant 3D Print Quoter — README

This project is a **single‑file webpage** that lets customers upload a 3D model (`.stl` or `.3mf`), preview it in a sandboxed iframe, and get an **instant price estimate** based on geometry (volume, surface area, bounding box) and your pricing rules.

---

## Features

* **No server required** — all parsing and quoting happens in the browser.
* **Sandboxed 3D viewer** (Three.js) inside an iframe.
* **Geometry metrics**: volume, surface area, bounding box (assumes model units are **millimetres**).
* **Instant pricing** based on technology, layer height, infill, post‑processing, turnaround, and quantity.
* **Countdown during parsing** (configurable).
* **One‑click PDF quote** (client‑side print dialog).

---

## File structure

* **`index.html`** — the entire app in one file (UI + viewer inside an iframe via `srcdoc`).

  * You can also split the viewer into a separate `viewer.html` if you prefer, but the default is single‑file for simplicity.

---

## Quick start

### Local test

1. Save the code as `index.html`.
2. Open it in your browser by double‑clicking, or run a tiny local server:

   ```bash
   python3 -m http.server 8000
   # then visit http://localhost:8000
   ```
3. Upload a small `.stl`/`.3mf` and confirm the preview + quote appear.

### GitHub Pages hosting

1. Create a public repository (e.g., `3d-print-quoter`).
2. Add `index.html` to the repo (root folder).
3. In **Settings → Pages**, select **Deploy from a branch** → `main` → `/ (root)`.
4. Visit the published URL shown by GitHub Pages (e.g., `https://<username>.github.io/3d-print-quoter/`).

### Embed in Wix

* In the Wix Editor, go to **Add → Embed → Embed a Site** and use your GitHub Pages URL.
* Resize the embed to fit the tool (suggest ~1200×1200 min on desktop, or full‑width).

---

## How it works (high‑level)

* The right‑hand panel contains an **iframe** with a self‑contained Three.js viewer.
* When a user selects a file, the parent page reads it to an **ArrayBuffer** and sends it to the iframe via `postMessage`.
* The viewer parses STL/3MF, renders it, computes metrics, and posts them back to the parent.
* The parent computes the quote using the `PRICING` rules and updates the UI.

> **Units**: the metrics assume the model’s units are **millimetres**. Volume is reported in **mm³**, area in **mm²**. The UI converts to cm³/cm² for display. If your models are in different units, see **Changing units** below.

---

## Adjusting quotation values

All pricing logic lives in the `PRICING` object inside `index.html` (look for `// Pricing parameters (tweak to your business logic)`).

```js
const PRICING = {
  baseSetup: 3.5, // £ per job
  tech: {
    fdm: { material: 0.08, timePerCm3: 0.12, hourly: 6.0 },
    sla: { material: 0.22, timePerCm3: 0.08, hourly: 10.0 },
    sls: { material: 0.18, timePerCm3: 0.10, hourly: 9.0 }
  },
  layerFactor: { '0.3': 0.9, '0.2': 1.0, '0.1': 1.3 },
  infillFactor(infillPct) { return Math.max(0.3, (infillPct/100) * 0.6 + 0.4); },
  postProcess: { none: 0, sanding: 2.5, priming: 5.0 },
  turnaround: { standard: 1.0, express: 1.15, rush: 1.35 },
  minPerUnit: 6.0
};
```

### What each field means

* **`baseSetup`**: A fixed fee per job (setup/handling). Applied **per unit price** before quantity multiplication.
* **`tech`** (per technology):

  * `material` — £ per **cm³** of model volume (scaled by infill for FDM).
  * `timePerCm3` — rough **hours per cm³**. Used to estimate print time.
  * `hourly` — machine hourly rate in £/hour.
* **`layerFactor`**: Multiplier for estimated time based on chosen layer height (e.g., fine layers take longer).
* **`infillFactor(infillPct)`**: Scales **material and time** for FDM. You can replace this function with your own curve.
* **`postProcess`**: Additional £ per unit for finishing steps.
* **`turnaround`**: Multiplier applied at the end for rush/express.
* **`minPerUnit`**: Minimum charge per unit (pre‑quantity).

### The price formula (simplified)

1. Convert volume to cm³: `vol_cm3 = volume_mm3 / 1000`.
2. Estimate hours: `estHours = max(0.3, vol_cm3 * timePerCm3 * layerFactor * infillFactor)`.
3. Material cost: `baseMaterial = vol_cm3 * material * infillFactor`.
4. Machine time: `machine = estHours * hourly`.
5. Pre‑extras per unit: `perUnit = max(baseSetup + baseMaterial + machine, minPerUnit)`.
6. Add finishing: `perUnit += postProcess[selection]`.
7. Apply turnaround multiplier: `perUnit *= turnaround[selection]`.
8. Multiply by quantity for total.

### Common tweaks

* **Change currency**: Replace the `£` symbol used in the `fmt` function and UI labels.
* **Adjust minimums**: Increase `minPerUnit` to protect margins on tiny parts.
* **Change rush multipliers**: Tweak `turnaround` to reflect demand/capacity.
* **Custom infill curve**: Replace `infillFactor` with a table or piecewise function.
* **Material‑specific setup**: Add `setup` inside each `tech` and include it in the formula.

**Example** — set higher resin material cost and a stronger rush premium:

```js
PRICING.tech.sla.material = 0.30; // £/cm³
PRICING.turnaround = { standard: 1.0, express: 1.25, rush: 1.6 };
```

**Example** — raise the minimum and add a new technology (MJF):

```js
PRICING.minPerUnit = 9.0;
PRICING.tech.mjf = { material: 0.20, timePerCm3: 0.09, hourly: 11.0 };
```

---

## Changing units (if your models aren’t in mm)

If your customers design in **inches** or **cm**, adjust the numbers **as soon as metrics arrive**:

* Currently the viewer measures geometry directly in the model’s native units and **assumes they are mm**. If your inputs are in **cm**, multiply volume by `1000` and area by `100` before display and pricing; if they’re in **inches**, convert using `1 inch = 25.4 mm`.
* You can do this in the `message` handler where `volume_mm3` and `area_mm2` are read. For inches:

```js
const INCH = 25.4; // mm per inch
const scale = INCH; // model units to mm
const volume_mm3 = msg.volume_mm3 * Math.pow(scale, 3);
const area_mm2   = msg.area_mm2   * Math.pow(scale, 2);
```

> It’s best to **standardise on mm** and ask users to export models in mm, which is the default for many slicers.

---

## Customising the UI

* **Branding**: Change the header title, add your logo in the header area.
* **Fields**: Add colours/materials by inserting `<select>` options and mapping them into pricing (e.g., different `material` rates per colour).
* **PDF**: Edit the HTML in the `downloadQuoteBtn` click handler to include your business details, logo, and terms.
* **Countdown**: In `startCountdown(12)`, change the `12` to your preferred duration.

---

## Security & privacy notes

* Files are parsed **in the browser only**; nothing is uploaded to a server unless you add one.
* The 3D viewer runs inside an **iframe** to isolate WebGL context and loaders.
* If you split into separate pages (parent + `viewer.html`) across different domains, set and verify the **message origin** in `postMessage` handlers.

---

## Troubleshooting

* **Viewer doesn’t render**: Some browsers restrict features for `file://` URLs. Serve locally with a small HTTP server (see *Local test*).
* **Large files load slowly**: Increase the countdown duration, and consider adding a file size hint in the UI.
* **Units look wrong** (e.g., 1000× too large/small): Confirm the design export unit. Apply a scale factor (see *Changing units*).
* **Wix embed shows scrollbars**: Increase the iframe height in Wix, or make the tool full‑width.

---

## Roadmap ideas (optional)

* Material libraries with colour and supplier cost tables.
* Multiple‑part uploads with per‑part quantities.
* Auto‑orientation and support estimation (for FDM/SLA time modelling).
* Stripe checkout or email quote submission.
* Persistent quote IDs with URL parameters.

---

## License & attribution

* Three.js and example loaders are loaded from a CDN under their respective licenses.
* You’re free to adapt this page for your business needs.

---

## Support

If you want, I can tailor the pricing model to your machines (nozzles, speeds, resin types), add a backend for orders/CRM, and wire it to Stripe or Wix forms.
