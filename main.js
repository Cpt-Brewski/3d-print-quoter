// main.js
import { initViewer, loadGeometryIntoScene, centerAndFrame, setSize, getSnapshot } from './viewer.js';
import { price } from './pricing.js';
import { formatMetrics } from './metrics.js';
import { ThreeMFLoader } from 'https://esm.sh/three@0.160.0/examples/jsm/loaders/3MFLoader.js';

const el = sel => document.querySelector(sel);
const fmt = n => `£${Number(n).toFixed(2)}`;
const STORAGE_KEY = 'wa_customer_v1';

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
  saveCustomer: true,
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

/* ------------------------ UI BINDINGS ------------------------ */
function bindUI(){
  ['techSel','layerSel','postSel','turnSel','qtyInput','infillInput'].forEach(id=>{
    el('#'+id).addEventListener('input', onUIChange);
  });
  el('#resetBtn').addEventListener('click', resetAll);

  // On click, open modal first (do not immediately print)
  el('#downloadQuoteBtn').addEventListener('click', async ()=>{
    if(!lastMetrics || !lastQuote){
      alert('Upload a model first.');
      return;
    }
    await showCustomerModal(); // opens modal; proceeds to PDF on "Continue"
  });

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

  // Load saved customer (if any) at startup
  loadCustomerFromStorage();
}

/* ------------------------ STATE HANDLERS ------------------------ */
function onUIChange(){
  state.tech = el('#techSel').value;
  state.layer = el('#layerSel').value; // Capture the selected layer height
  state.post = el('#postSel').value;
  state.turnaround = el('#turnSel').value;
  state.qty = Math.max(1, +el('#qtyInput').value || 1);
  state.infillPct = Math.min(100, Math.max(0, +el('#infillInput').value || 0));
  
  // Update the layer options if the technology is changed
  updateLayerOptions();

  // Recompute the pricing
  recompute();
}

/* ------------------------ DYNAMIC LAYER HEIGHT OPTIONS ------------------------ */
function updateLayerOptions() {
  const layerSel = el('#layerSel');
  layerSel.innerHTML = ''; // Clear the current options
  
  // Define the layer height options for each technology
  const layerOptions = {
    fdm: [
      { value: '0.3', label: '0.3 mm' },
      { value: '0.2', label: '0.2 mm' },
      { value: '0.1', label: '0.1 mm' }
    ],
    sla: [
      { value: '0.1', label: '0.1 mm' },
      { value: '0.05', label: '0.05 mm' },
      { value: '0.025', label: '0.025 mm' }
    ],
    sls: [
      { value: '0.15', label: '0.15 mm' },
      { value: '0.1', label: '0.1 mm' },
      { value: '0.08', label: '0.08 mm' }
    ]
  };

  // Get the technology selected by the user
  const selectedTech = state.tech || 'fdm'; // Default to 'fdm' if nothing is selected

  // Add the appropriate layer height options based on selected technology
  layerOptions[selectedTech].forEach(option => {
    const opt = document.createElement('option');
    opt.value = option.value;
    opt.textContent = option.label;
    layerSel.appendChild(opt);
  });

  // Re-select the currently selected layer height, if possible
  if (!layerSel.querySelector(`[value="${state.layer}"]`)) {
    state.layer = layerOptions[selectedTech][0].value; // Default to the first option if the previous value is not available
  }
  layerSel.value = state.layer; // Update the selected value in the dropdown
}


function resetAll(){
  lastMetrics = null; lastQuote = null;
  el('#fileInput').value = '';
  el('#fileName').textContent = 'No file';
  el('#statusText').textContent = 'Upload a model to preview & quote.';
  ['#volOut','#areaOut','#bboxOut','#materialOut','#machineOut','#setupOut','#finishOut','#turnOut','#hoursOut','#totalOut']
    .forEach(sel=> el(sel).textContent = '—');
}

function countdown(seconds=3){
  const cd = el('#countdown'); cd.style.display = 'flex'; cd.textContent = seconds;
  let rem = seconds;
  const timer = setInterval(()=>{
    rem--;
    cd.textContent = rem;
    if(rem<=0){ clearInterval(timer); cd.style.display = 'none'; }
  }, 1000);
}

/* ------------------------ FILE HANDLING ------------------------ */
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

/* ------------------------ UI METRICS/PRICING ------------------------ */
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

/* ------------------------ CUSTOMER STORAGE ------------------------ */
function loadCustomerFromStorage(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return;
    const saved = JSON.parse(raw);
    if(saved && typeof saved === 'object'){
      state.customer = { ...state.customer, ...(saved.customer || {}) };
      state.saveCustomer = saved.saveCustomer !== false; // default true
    }
  }catch{}
}
function saveCustomerToStorage(){
  try{
    const payload = { saveCustomer: state.saveCustomer, customer: state.customer };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }catch{}
}

/* ------------------------ CUSTOMER MODAL ------------------------ */
/**
 * Opens a modal to collect/update customer details.
 * Returns a Promise that resolves when the user clicks Continue (and triggers PDF),
 * or resolves early if the modal is cancelled.
 */
function showCustomerModal(){
  // overlay + dialog
  const overlay = document.createElement('div');
  overlay.className = 'wa-overlay';
  overlay.innerHTML = `
    <div class="wa-dialog" role="dialog" aria-modal="true" aria-labelledby="waTitle">
      <div class="wa-header">
        <h2 id="waTitle">Customer details</h2>
        <button class="wa-close" aria-label="Close">&times;</button>
      </div>
      <div class="wa-body">
        <div class="wa-grid2">
          <div class="wa-field">
            <label>Name</label>
            <input id="waName" type="text" placeholder="Jane Doe">
          </div>
          <div class="wa-field">
            <label>Company (optional)</label>
            <input id="waCompany" type="text" placeholder="Client Ltd">
          </div>
        </div>
        <div class="wa-field">
          <label>Email</label>
          <input id="waEmail" type="email" placeholder="jane@example.com">
        </div>
        <div class="wa-field">
          <label>Address</label>
          <input id="waAddress" type="text" placeholder="10 Sample Road">
        </div>
        <div class="wa-grid2">
          <div class="wa-field">
            <label>City</label>
            <input id="waCity" type="text" placeholder="Bristol">
          </div>
          <div class="wa-field">
            <label>Postcode</label>
            <input id="waPostcode" type="text" placeholder="BS1 1AA">
          </div>
        </div>
        <div class="wa-field">
          <label>Country</label>
          <input id="waCountry" type="text" value="UK">
        </div>

        <div class="wa-row">
          <label class="wa-check">
            <input id="waSave" type="checkbox">
            <span>Save customer on this device</span>
          </label>
          <button id="waClear" type="button" class="wa-link">Clear saved</button>
        </div>
      </div>
      <div class="wa-footer">
        <button class="wa-btn wa-secondary" id="waCancel">Cancel</button>
        <button class="wa-btn wa-primary" id="waContinue">Continue to PDF</button>
      </div>
    </div>
  `;

  injectModalStyles();
  document.body.appendChild(overlay);

  // Prefill
  const q = s => overlay.querySelector(s);
  q('#waName').value = state.customer.name || '';
  q('#waCompany').value = state.customer.company || '';
  q('#waEmail').value = state.customer.email || '';
  q('#waAddress').value = state.customer.address || '';
  q('#waCity').value = state.customer.city || '';
  q('#waPostcode').value = state.customer.postcode || '';
  q('#waCountry').value = state.customer.country || 'UK';
  q('#waSave').checked = !!state.saveCustomer;

  // Wire up
  const close = () => overlay.remove();
  q('.wa-close').addEventListener('click', close);
  q('#waCancel').addEventListener('click', close);
  overlay.addEventListener('click', (e)=>{ if(e.target === overlay) close(); });
  q('#waClear').addEventListener('click', ()=>{
    localStorage.removeItem('wa_customer_v1');
    alert('Saved customer details cleared from this device.');
  });

  // live-update state + optional save
  [
    ['#waName','name'],
    ['#waCompany','company'],
    ['#waEmail','email'],
    ['#waAddress','address'],
    ['#waCity','city'],
    ['#waPostcode','postcode'],
    ['#waCountry','country']
  ].forEach(([sel, key])=>{
    q(sel).addEventListener('input', e=>{
      state.customer[key] = e.target.value.trim();
      if(state.saveCustomer) saveCustomerToStorage();
    });
  });
  q('#waSave').addEventListener('change', e=>{
    state.saveCustomer = !!e.target.checked;
    if(state.saveCustomer) saveCustomerToStorage(); else localStorage.removeItem('wa_customer_v1');
  });

  // Continue to PDF
  q('#waContinue').addEventListener('click', ()=>{
    if(!state.customer.name){
      if(!confirm('Customer name is empty. Continue anyway?')) return;
    }
    if(state.saveCustomer) saveCustomerToStorage();
    close();
    openQuotePdf();
  });

  // focus first input
  setTimeout(()=> q('#waName').focus(), 0);
}


/* Modal styles (scoped) */
function injectModalStyles(){
  if(document.getElementById('wa-modal-style')) return;
  const style = document.createElement('style');
  style.id = 'wa-modal-style';
  style.textContent = `
  .wa-overlay{
    position:fixed; inset:0;
    background:rgba(10,13,18,.55);
    backdrop-filter:blur(2px);
    z-index:9999;
    display:flex; align-items:center; justify-content:center;
  }
  .wa-dialog{
    width:min(700px, calc(100% - 32px));
    background:#0e151d;
    color:#e8eef4;
    border:1px solid #232a34;
    border-radius:16px;
    box-shadow:0 10px 30px rgba(0,0,0,.5);
    display:flex; flex-direction:column;
  }
  .wa-header{
    display:flex; align-items:center; justify-content:space-between; gap:8px;
    padding:14px 16px; border-bottom:1px solid #232a34;
  }
  .wa-header h2{ margin:0; font-size:16px; font-weight:600; color:#9aa5b1; }
  .wa-close{
    background:transparent; border:none; color:#9aa5b1; font-size:22px; line-height:1; cursor:pointer;
  }
  .wa-body{ padding:14px 16px; }
  .wa-grid2{ display:grid; grid-template-columns:1fr 1fr; gap:10px; }
  .wa-field label{ display:block; font-size:12px; color:#9aa5b1; margin-bottom:6px; }
  .wa-field input{
    width:100%; padding:10px 12px; border-radius:12px;
    border:1px solid #232a34; background:#0f141b; color:#e8eef4;
  }
  .wa-row{ display:flex; align-items:center; justify-content:space-between; margin-top:8px; }
  .wa-check{ display:flex; align-items:center; gap:8px; font-size:14px; color:#e8eef4; }
  .wa-link{ background:transparent; border:none; color:#4cc9f0; cursor:pointer; padding:4px 0; }
  .wa-footer{
    padding:14px 16px; border-top:1px solid #232a34; display:flex; gap:8px; justify-content:flex-end;
  }
  .wa-btn{
    border:1px solid #232a34; border-radius:12px; padding:10px 14px; cursor:pointer; font-weight:600;
  }
  .wa-secondary{ background:#121820; color:#e8eef4; }
  .wa-primary{ background:#1b2735; color:#e8eef4; }
  @media (max-width:600px){ .wa-grid2{ grid-template-columns:1fr; } }
  `;
  document.head.appendChild(style);
}


/* ------------------------ PDF BUILDER ------------------------ */
async function openQuotePdf(){
  const today = new Date().toISOString().slice(0,10);
  const fileName = document.querySelector('#fileName').textContent || 'model';

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

  const snap = await getSnapshot();

  const c = state.customer || {};
  const billToLines = [
    c.name || '',
    c.company || '',
    c.address || '',
    [c.city, c.postcode].filter(Boolean).join(' ') || '',
    c.country || ''
  ].filter(Boolean).join('<br>');

  // NOTE: No auto window.print() in here.
  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Quote - ${fileName}</title>
<style>
  :root{ --ink:#0b1220; --muted:#64748b; --line:#e5e7eb; }
  @page { size: A4; margin: 18mm; }
  body{ font-family: system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial; color:var(--ink); margin:0; }
  .wrap{ max-width:800px; margin:0 auto; }
  header{ display:flex; justify-content:space-between; gap:16px; margin-bottom:18px; }
  .brand{ display:flex; flex-direction:column; gap:4px; }
  .logo{ width:32px; height:32px; border-radius:8px; background: radial-gradient(circle at 30% 30%, #4cc9f0, #b5179e); }
  h1{ font-size:22px; margin:0; }
  .muted{ color:var(--muted); }
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
</body>
</html>`;

  showPrintOverlay(html);
}

function showPrintOverlay(html){
  // Create Blob URL for the printable HTML
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);

  // Build overlay with iframe + buttons
  const overlay = document.createElement('div');
  overlay.id = 'wa-print-overlay';
  overlay.innerHTML = `
    <div class="wa-print-backdrop"></div>
    <div class="wa-print-panel">
      <div class="wa-print-header">
        <h3>Printable quote preview</h3>
        <button class="wa-x" aria-label="Close">&times;</button>
      </div>
      <div class="wa-print-body">
        <iframe id="wa-print-frame" src="${url}" title="Quote preview"></iframe>
      </div>
      <div class="wa-print-footer">
        <button id="wa-print-btn" class="wa-btn">Print</button>
        <a id="wa-open-tab" class="wa-link" href="${url}" target="_blank" rel="noopener">Open in new tab</a>
      </div>
    </div>
  `;
  injectPrintStyles();
  document.body.appendChild(overlay);

  const frame = overlay.querySelector('#wa-print-frame');
  const close = () => {
    URL.revokeObjectURL(url);
    overlay.remove();
  };

  overlay.querySelector('.wa-x').addEventListener('click', close);
  overlay.querySelector('.wa-print-backdrop').addEventListener('click', close);

  // User-gesture Print button (most reliable)
  overlay.querySelector('#wa-print-btn').addEventListener('click', ()=>{
    try{
      frame.contentWindow.focus();
      frame.contentWindow.print();
    }catch(e){
      alert('Print dialog could not be opened automatically. Use "Open in new tab" and print there.');
    }
  });
}

function injectPrintStyles(){
  if(document.getElementById('wa-print-style')) return;
  const style = document.createElement('style');
  style.id = 'wa-print-style';
  style.textContent = `
  .wa-print-backdrop{
    position:fixed; inset:0; background:rgba(10,13,18,.55); backdrop-filter:blur(2px); z-index:9998;
  }
  .wa-print-panel{
    position:fixed; inset:5vh 5vw auto 5vw; bottom:auto; z-index:9999;
    background:#0e151d; color:#e8eef4; border:1px solid #232a34; border-radius:16px;
    box-shadow:0 10px 30px rgba(0,0,0,.5); display:flex; flex-direction:column; max-height:90vh;
  }
  .wa-print-header{ display:flex; justify-content:space-between; align-items:center; padding:12px 14px; border-bottom:1px solid #232a34; }
  .wa-print-header h3{ margin:0; font-size:16px; color:#9aa5b1; }
  .wa-x{ background:transparent; border:none; color:#9aa5b1; font-size:22px; cursor:pointer; }
  .wa-print-body{ padding:10px; }
  #wa-print-frame{
    width: min(900px, calc(100vw - 12vw));
    height: min(70vh, 1200px);
    background:#fff; border:1px solid #232a34; border-radius:12px;
  }
  .wa-print-footer{ display:flex; gap:12px; justify-content:flex-end; padding:12px 14px; border-top:1px solid #232a34; }
  .wa-btn{ border:1px solid #232a34; border-radius:12px; padding:10px 14px; cursor:pointer; font-weight:600; background:#1b2735; color:#e8eef4; }
  .wa-link{ color:#4cc9f0; text-decoration:none; align-self:center; }
  @media (max-width: 700px){
    .wa-print-panel{ inset:2vh 2vw; }
    #wa-print-frame{ width: calc(100vw - 8vw); height: 60vh; }
  }
  `;
  document.head.appendChild(style);
}


/* ------------------------ INIT ------------------------ */
initViewer(document.getElementById('viewerRoot'));
new ResizeObserver(()=> setSize()).observe(document.getElementById('viewerRoot'));
bindUI();
