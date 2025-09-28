Instant 3D Print Quoter

A browser-based tool that allows users to upload 3D models (STL or 3MF), preview them in 3D, compute part geometry, and instantly generate a price quote for 3D printing.

The tool supports multiple printing technologies, configurable options like layer height, infill, and post-processing, and provides a downloadable quote in PDF format.

✨ Features

📂 Upload 3D files: Drag & drop or select .stl or .3mf files.

📐 Geometry metrics: Automatically calculates volume, surface area, and bounding box.

💸 Instant pricing: Supports FDM, SLA, SLS technologies with configurable:

Layer height

Infill %

Post-processing options

Turnaround speed

Quantity

🖼️ 3D viewer: Interactive WebGL preview with orbit controls.

📑 PDF export: Generate and download professional-looking quotes.

📂 Project Structure
.
├── index.html          # Main UI and layout
├── main.js             # App logic, UI handling, and quoting workflow
├── viewer.js           # 3D preview powered by Three.js
├── parsers.worker.js   # Web Worker for parsing STL / computing metrics
├── metrics.js          # Geometry utility functions (area, volume, formatting)
├── pricing.js          # Pricing model & quote computation

🚀 Getting Started
1. Clone or download
git clone https://github.com/yourusername/instant-3d-quoter.git
cd instant-3d-quoter

2. Run locally

Since the project uses ES modules and web workers, you must serve it via a local web server.

Option A: Python
python3 -m http.server 8000


Visit: http://localhost:8000

Option B: Node (http-server)
npm install -g http-server
http-server -p 8000


Visit: http://localhost:8000

⚙️ Usage

Open the app in your browser.

Upload a .stl or .3mf file.

Adjust printing options (technology, layer height, infill, post-processing, turnaround, quantity).

View geometry metrics and the price breakdown.

Click Download PDF Quote to generate a client-ready quote.

🛠️ Tech Stack

Frontend: Vanilla JavaScript, HTML, CSS

3D Rendering: Three.js
 (via esm.sh CDN)

Workers: Web Workers for parsing STL and computing metrics

No backend: 100% client-side

📊 Pricing Model

Defined in pricing.js
:

Setup fee

Material cost per cm³

Machine hourly rate

Layer height factor

Infill adjustment

Post-processing fees

Turnaround multipliers

Minimum charge per unit

📸 Screenshots

(Add screenshots of UI here if desired)

📄 License

MIT License – free to use, modify, and distribute.
