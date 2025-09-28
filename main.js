// main.js
import { initViewer, loadGeometryIntoScene, centerAndFrame, setSize } from './viewer.js';
import { price } from './pricing.js';
import { formatMetrics } from './metrics.js';
import { ThreeMFLoader } from 'https://esm.sh/three@0.160.0/examples/jsm/loaders/3MFLoader.js';

const el = sel => document.querySelector(sel);
const fmt = n => `£${Number(n).toFixed(2)}`;

let lastMetrics = null;
let lastQuote = null;

const state = {
  unitScale: 1,
  tech: 'fdm',
  layer: '0.2',
  post: 'none',
  turnaround: 'standard',
  qty: 1,
  infillPct: 20,
  customer: {
    name: '',
    company: '',
    email: '',
    address: '',
    city: '',
    postcode: '',
    country: 'UK'
  }
};

// ----- UI bindings
function bindUI(){
  ['techSel','layerSel','postSel','turnSel','qtyInput','infillInput'].forEach(id=>{
    el('#'+id).addEventListener('input', onUIChange);
  });
  el('#resetBtn').addEventListener('click', resetAll);
  el('#downloadQuoteBtn').addEventListener('click', downloadQuote);

  const dropZone = el('#dropZone');
  ['dragenter','dragover'].forEach(t=> dropZone.addEventListener(t, e=>{ e.preventDefault(); dropZone.classList.add('dragover'); }));
  ['dragleave','drop'].forEach(t=> dropZone.addEventListener(t, e=>{ e.preventDefault(); dropZone.classList.remove('dragover'); }));
  dropZone.addEventListener('drop', e=>{
    e.preventDefault();
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if(f) handleFile(f);
  });
  el('#fileInput').addEventListener('change', e=>{
    const f = e.target.files[0];
    if(f) handleFile(f);
  });

  injectCustomerForm();
}

// Inject a simple "Customer details" form into the left panel
function injectCustomerForm(){
  const leftPanel = document.querySelector('.panel.left');
  if(!leftPanel) return;

  const container = document.createElement('div');
  container.className = 'customer-block';
  container.style.marginTop = '14px';
  container.innerHTML = `
    <h3 style="margin:10px 0; font-size:14px; color:var(--muted);">Customer details</h3>
    <div class="field"><label>Customer name</label><input id="custName" type="text" placeholder="Jane Doe" style="width:100%;padding:10px 12px;border-radius:12px;border:1px solid var(--border);background:#0f141b;color:var(--text)"></div>
    <div class="grid-2">
      <div class="field"><label>Company (optional)</label><input id="custCompany" type="text" placeholder="Client Ltd" style="width:100%;padding:10px 12px;border-radius:12px;border:1px solid var(--border);background:#0f141b;color:var(--text)"></div>
      <div class="field"><label>Email</label><input id="custEmail" type="email" placeholder="jane@example.com" style="width:100%;padding:10px 12px;border-radius:12px;border:1px solid var(--border);background:#0f141b;color:var(--text)"></div>
    </div>
    <div class="field"><label>Address</label><input id="custAddress" type="text" placeholder="10 Sample Road" style="width:100%;padding:10px 12px;border-radius:12px;border:1px solid var(--border);background:#0f141b;color:var(--text)"></div>
    <div class="grid-2">
      <div class="field"><label>City</label><input id="custCity" type="text" placeholder="Bristol" style="width:100%;padding:10px 12px;border-radius:12px;border:1px solid var(--border);background:#0f141b;color:var(--text)"></div>
      <div class="field"><label>Postcode</label><input id="custPostcode" type="text" placeholder="BS1 1AA" style="width:100%;padding:10px 12px;border-radius:12px;border:1px solid var(--border);background:#0f141b;color:var(--text)"></div>
    </div>
    <div class="field"><label>Country</label><input id="custCountry" type="text" value="UK" style="width:100%;padding:10px 12px;border-radius:12px;border:1px solid var(--border);background:#0f141b;color:var(--text)"></div>
  `;
  // Insert before the metrics block for visibility
  const metricsBlock = leftPanel.querySelector('.metrics');
  leftPanel.insertBefore(container, metricsBlock || null);

  // Bind inputs
  const map = {
    '#custName': 'name',
    '#custCompany': 'company',
    '#custEmail': 'email',
    '#custAddress': 'address',
    '#custCity': 'city',
    '#custPostcode': 'postcode',
    '#custCountry': 'country'
  };
  Object.entries(map).forEach(([selector, key])=>{
    const input = container.querySelector(selector);
    if(input){
      input.addEventListener('input', ()=> {
        state.customer[key] = input.value.trim();
      });
    }
  });
}

function onUIChange(){
  state.tech = el('#techSel').value;
  state.layer = el('#layerSel').value;
  state.post = el('#postSel').value;
  state.turnaround = el('#turnSel').value;
  state.qty = Math.max(1, +el('#qtyInput').value || 1);
  state.infillPct = Math.min(100, Math.max(0, +el('#infillInput').value || 0));
  recompute();
}

function resetAll(){
  lastMetrics = null; lastQuote = null;
  el('#fileInput').value = '';
  el('#fileName').textContent = 'No file';
  el('#statusText').textContent = 'Upload a model to preview & quote.';
  ['#volOut','#areaOut','#bboxOut','#materialOut','#machineOut','#setupOut','#finishOut','#turnOut','#hoursOut','#totalOut']
    .forEach(sel=> el(sel).textContent = '—');

  // Reset customer details visually too
  const ids = ['#custName','#custCompany','#custEmail','#custAddress','#custCity','#custPostcode','#custCountry'];
  ids.forEach(id=>{ const i = el(id); if(i) i.value = (id==='#custCountry' ? 'UK' : ''); });
  state.customer = { name:'', company:'', email:'', address:'', city:'', postcode:'', country:'UK' };
}

function countdown(seconds=3){
  const cd = el('#countdown'); cd.style.display = 'flex'; cd.textContent = seconds;
  let rem = seconds;
  const timer = setInterval(()=>{
    rem--;
    cd.textContent = rem;
    if(rem<=0){
      clearInterval(timer);
      cd.style.display = 'none';
    }
  }, 1000);
}

function bboxFromGeomPayload(geomPayload){
  const min = {x: Infinity, y: Infinity, z: Infinity};
  const max = {x:-Infinity, y:-Infinity, z:-Infinity};
  for(const p of geomPayload.parts){
    const arr = p.positions;
    for(let i=0;i<arr.length;i+=3){
      const x = arr[i], y = arr[i+1], z = arr[i+2];
      if(x<min.x) min.x=x; if(y<min.y) min.y=y; if(z<min.z) min.z=z;
      if(x>max.x) max.x=x; if(y>max.y) max.y=y; if(z>max.z) max.z=z;
    }
  }
  return { min, max };
}

async function handleFile(file){
  const name = file.name || 'model';
  const ext = (name.split('.').pop() || '').toLowerCase();
  if(!['stl','3mf'].includes(ext)) { alert('Please upload an .stl or .3mf file'); return; }
  el('#fileName').textContent = name;
  countdown(3);

  const buf = await file.arrayBuffer();
  const worker = new Worker('./parsers.worker.js', { type: 'module' });

  if(ext === 'stl'){
    worker.postMessage({ type:'parse', format:'stl', buffer: buf }, [buf]);
    worker.onmessage = ({ data }) => {
      if (!data.ok){
        alert('Parse error: ' + data.error);
        el('#statusText').textContent = 'Error: ' + data.error;
        return;
      }
      const { bbox, metrics, geomPayload } = data.result;
      lastMetrics = { ...metrics, bbox };
      el('#statusText').textContent = 'Model loaded. Metrics computed.';

      loadGeometryIntoScene(geomPayload);
      centerAndFrame(bbox);
      updateMetricsUI();
      recompute();
    };
  } else {
    try{
      const group = new ThreeMFLoader().parse(buf);
      const parts = [];
      group.traverse(n=>{
        if(n.isMesh && n.geometry && n.geometry.attributes && n.geometry.attributes.position){
          const pos = n.geometry.attributes.position.array;
          const indices = n.geometry.index ? n.geometry.index.array : null;
          parts.push({ positions: Array.from(pos), indices: indices ? Array.from(indices) : null });
        }
      });
      const geomPayload = { format:'3mf', parts };
      const bbox = bboxFromGeomPayload(geomPayload);

      worker.postMessage({ type:'metricsFromPayload', geomPayload });
      worker.onmessage = ({ data }) => {
        if(!data.ok){
          alert('Metrics error: ' + data.error);
          el('#statusText').textContent = 'Error: ' + data.error;
          return;
        }
        lastMetrics = { ...data.result.metrics, bbox };
        el('#statusText').textContent = 'Model loaded. Metrics computed.';

        loadGeometryIntoScene(geomPayload);
        centerAndFrame(bbox);
        updateMetricsUI();
        recompute();
      };
    }catch(e){
      alert('Parse error (3MF): ' + (e.message || String(e)));
      el('#statusText').textContent = 'Error: ' + (e.message || String(e));
    }
  }
}

function updateMetricsUI(){
  const { volume_mm3, area_mm2, bbox } = lastMetrics || {};
  const f = formatMetrics({ volume_mm3, area_mm2, bbox });
  el('#volOut').textContent = f.volume || '—';
  el('#areaOut').textContent = f.area || '—';
  el('#bboxOut').textContent = f.bbox || '—';
}

function recompute(){
  if(!lastMetrics) return;
  lastQuote = price({ ...state, volume_mm3: lastMetrics.volume_mm3 });
  el('#materialOut').textContent = fmt(lastQuote.material);
  el('#machineOut').textContent = fmt(lastQuote.machine);
  el('#setupOut').textContent = fmt(lastQuote.setup);
  el('#finishOut').textContent = fmt(lastQuote.finishing);
  el('#turnOut').textContent = state.turnaround.toUpperCase();
  el('#hoursOut').textContent = lastQuote.hours.toFixed(2) + ' h';
  el('#totalOut').textContent = fmt(lastQuote.total) + `  ( ${state.qty} × ${fmt(lastQuote.perUnit)} )`;
}

// ----- Download Quote with company + customer details
function downloadQuote(){
  if(!lastMetrics || !lastQuote){ alert('Upload a model first.'); return; }

  // Basic nudge if name/email missing (non-blocking)
  if(!state.customer.name) { state.customer.name = prompt('Customer name (for the quote):', state.customer.name || '') || state.customer.name; }
  if(!state.customer.email) { state.customer.email = prompt('Customer email (optional):', state.customer.email || '') || state.customer.email; }

  const today = new Date().toISOString().slice(0,10);
  const fileName = el('#fileName').textContent || 'model';

  // Company details
  const company = {
    name: 'Weston Additive',
    vat: '0000000',
    address: '123 Example Street, Exampletown, EX1 2YZ, UK'
  };

  const vatRate = 0.20;
  const subtotal = lastQuote.total;
  const vat = subtotal * vatRate;
  const grandTotal = subtotal + vat;

  const geom = {
    volume: formatMetrics({ volume_mm3: lastMetrics.volume_mm3 }).volume,
    area: formatMetrics({ area_mm2: lastMetrics.area_mm2 }).area,
    bbox: formatMetrics({ bbox: lastMetrics.bbox }).bbox
  };
  const tech = (state.tech || '').toUpperCase();
  const hours = lastQuote.hours.toFixed(2);

  // Viewer snapshot
  let snap = '';
  const canvas = document.querySelector('#viewerRoot canvas');
  try { snap = canvas ? canvas.toDataURL('image/png') : ''; } catch(e){}

  // Compose customer address block
  const c = state.customer;
  const billToLines = [
    c.name || '',
    c.company || '',
    c.address || '',
    [c.city, c.postcode].filter(Boolean).join(' ') || '',
    c.country || ''
  ].filter(Boolean).join('<br>');

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Quote - ${fileName}</title>
<style>
  :root{ --ink:#0b1220; --muted:#64748b; --line:#e5e7eb; }
  @page { size: A4; margin: 18mm; }
  body{ font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; color: var(--ink); margin: 0; }
  .wrap{ max-width: 800px; margin: 0 auto; }
  header{ display:flex; justify-content:space-between; gap:16px; margin-bottom:18px; }
  .brand{ display:flex; flex-direction:column; gap:4px; }
  .logo{ width:32px; height:32px; border-radius:8px; background: radial-gradient(circle at 30% 30%, #4cc9f0, #b5179e); }
  h1{ font-size:22px; margin:0; }
  .muted{ color: var(--muted); }
  .meta{ text-align:right; font-size:13px; }
  .grid{ display:grid; grid-template-columns:1fr 1fr; gap:12px; margin:14px 0 6px; }
  .card{ border:1px solid var(--line); border-radius:12px; padding:12px; }
  .card h3{ margin:0 0 8px; font-size:14px; color:var(--muted); font-weight:600; }
  table{ width:100%; border-collapse:collapse; margin-top:10px; }
  th, td{ border:1px solid var(--line); padding:10px 8px; font-size:14px; }
  th{ background:#f8fafc; text-align:left; }
  td.qty, td.unit, td.total{ text-align:right; white-space:nowrap; }
  .totals{ width:340px; margin-left:auto; margin-top:12px; border:1px solid var(--line); border-radius:12px; overflow:hidden; }
  .totals td{ border:none; padding:8px 10px; }
  .totals tr+tr td{ border-top:1px solid var(--line); }
  .grand{ font-weight:700; }
  .snapshot img{ max-width:200px; border:1px solid var(--line); border-radius:8px; }
  footer{ margin-top:20px; font-size:12px; color:var(--muted); line-height:1.4; }
</style>
</head>
<body>
  <div class="wrap">
    <header>
      <div class="brand">
        <div class="logo"></div>
        <div><h1>${company.name}</h1></div>
        <div class="muted">${company.address}</div>
        <div class="muted">VAT Reg: ${company.vat}</div>
        <div class="muted">Generated ${today}</div>
      </div>
      <div class="meta">
        <div><strong>Quote #</strong> Q-${Math.floor(Math.random()*899999+100000)}</div>
        <div><strong>Technology</strong> ${tech}</div>
        <div><strong>Est. hours</strong> ${hours} h</div>
      </div>
    </header>

    <div class="grid">
      <div class="card">
        <h3>Bill To</h3>
        <div>${billToLines || '<span class="muted">No customer details provided</span>'}</div>
        ${c.email ? `<div class="muted" style="margin-top:6px">Email: ${c.email}</div>` : ''}
      </div>
      <div class="card snapshot">
        <h3>Preview</h3>
        ${snap ? `<img src="${snap}" alt="Model preview">` : `<div class="muted">No preview available</div>`}
      </div>
    </div>

    <div class="grid">
      <div class="card">
        <h3>Part</h3>
        <div><strong>${fileName}</strong></div>
        <div class="muted">Layer: ${state.layer} mm · Turnaround: ${state.turnaround.toUpperCase()} · Post: ${state.post}</div>
      </div>
      <div class="card">
        <h3>Geometry</h3>
        <div>Volume: <strong>${geom.volume}</strong></div>
        <div>Surface area: <strong>${geom.area}</strong></div>
        <div>Bounding box: <strong>${geom.bbox}</strong></div>
      </div>
    </div>

    <div class="card">
      <h3>Line items</h3>
      <table>
        <thead><tr><th>Description</th><th class="qty">Qty</th><th class="unit">Unit</th><th class="total">Total</th></tr></thead>
        <tbody>
          <tr>
            <td>3D print — ${fileName}</td>
            <td class="qty">${state.qty}</td>
            <td class="unit">${fmt(lastQuote.perUnit)}</td>
            <td class="total">${fmt(subtotal)}</td>
          </tr>
        </tbody>
      </table>
      <div class="totals">
        <table>
          <tr><td>Subtotal</td><td style="text-align:right">${fmt(subtotal)}</td></tr>
          <tr><td>VAT (${(vatRate*100).toFixed(0)}%)</td><td style="text-align:right">${fmt(vat)}</td></tr>
          <tr class="grand"><td>Grand total</td><td style="text-align:right">${fmt(grandTotal)}</td></tr>
        </table>
      </div>
    </div>

    <footer>
      ${company.name} · VAT Reg: ${company.vat} · ${company.address}<br>
      Prices in GBP. Estimates exclude shipping. Valid for 14 days unless otherwise stated.
    </footer>
  </div>
  <script>
    try { window.print(); } catch(e) {}
    window.addEventListener('afterprint', () => { try { window.close(); } catch(e){} });
  </script>
</body>
</html>`;

  const win = window.open('', '_blank');
  if(!win){ alert('Popup blocked. Please allow popups to print the quote.'); return; }
  win.document.open(); win.document.write(html); win.document.close(); win.focus();
}

// Viewer init + resize
initViewer(document.getElementById('viewerRoot'));
new ResizeObserver(()=> setSize()).observe(document.getElementById('viewerRoot'));

bindUI();
