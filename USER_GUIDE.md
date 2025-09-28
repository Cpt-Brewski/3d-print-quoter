# 📖 User Guide – Instant 3D Print Quoter

## 1. Opening the App
1. Serve the project with a local web server (see README).  
2. Open the app in your browser at `http://localhost:8000`.

---

## 2. Uploading a Model
- Click **Upload STL or 3MF** or drag-and-drop your file into the drop zone.  
- Supported formats:  
  - `.stl` (parsed in a Web Worker)  
  - `.3mf` (parsed in main thread)

---

## 3. Configuring Print Options
On the **left panel**, you can configure:

- **Technology**  
  - FDM (filament)  
  - SLA (resin)  
  - SLS (nylon)

- **Layer height**  
  - 0.30 mm (fast, less detail)  
  - 0.20 mm (default balance)  
  - 0.10 mm (high detail)

- **Infill %** *(FDM only)*  
  - 0–100%, controls material density  

- **Post-processing**  
  - None  
  - Sanding  
  - Priming  

- **Turnaround**  
  - Standard  
  - Express  
  - Rush  

- **Quantity**  
  - Number of copies to produce

---

## 4. Viewing Metrics & Price
Once a model is uploaded:
- **Geometry metrics** (volume, surface area, bounding box) are displayed.  
- **Price breakdown** is calculated:
  - Material  
  - Machine time  
  - Setup  
  - Finishing  
  - Turnaround multiplier  
  - Estimated hours  
  - Total (with per-unit breakdown)

---

## 5. 3D Preview
On the **right panel**:
- Interactive 3D viewer with orbit controls.  
- The model is centered and scaled to fit the viewport.  
- Grid + lighting helps assess scale and orientation.

---

## 6. Exporting Quotes
- Click **Download PDF Quote** to generate a printable client-ready document.  
- Includes:
  - Technology, estimated hours, part name  
  - Price table (per unit & total)  
  - Geometry metrics (volume, area, bounding box)  
  - Disclaimer: prices in GBP, VAT/shipping excluded  

---

## 7. Resetting
- Click **Reset** to clear model, metrics, and price breakdown.
