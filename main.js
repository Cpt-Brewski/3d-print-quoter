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
function bindUI() {
  ['techSel','layerSel','postSel','turnSel','qtyInput','infillInput'].forEach(id => {
    el('#' + id).addEventListener('input', onUIChange);
  });
  el('#resetBtn').addEventListener('click', resetAll);

  // On click, open modal first (do not immediately print)
  el('#emailQuoteBtn').addEventListener('click', async () => {
    if (!lastMetrics || !lastQuote) {
      alert('Upload a model first.');
      return;
    }
    await showCustomerModal(); // opens modal; proceeds to EMAIL on "Send"
  });

  const dropZone = el('#dropZone');
  ['dragenter','dragover'].forEach(t => dropZone.addEventListener(t, e => { e.preventDefault(); dropZone.classList.add('dragover'); }));
  ['dragleave','drop'].forEach(t => dropZone.addEventListener(t, e => { e.preventDefault(); dropZone.classList.remove('dragover'); }));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) handleFile(f);
  });
  el('#fileInput').addEventListener('change', e => {
    const f = e.target.files[0];
    if (f) handleFile(f);
  });

  // Load saved customer (if any) at startup
  loadCustomerFromStorage();
}

/* ------------------------ STATE HANDLERS ------------------------ */
function onUIChange() {
  state.tech = el('#techSel').value;
  state.layer = el('#layerSel').value;
  state.post = el('#postSel').value;
  state.turnaround = el('#turnSel').value;
  state.qty = Math.max(1, +el('#qtyInput').value || 1);
  state.infillPct = Math.min(100, Math.max(0, +el('#infillInput').value || 0));
  recompute();
}

function resetAll() {
  lastMetrics = null; lastQuote = null;
  el('#fileInput').value = '';
  el('#fileName').textContent = 'No file';
  el('#statusText').textContent = 'Upload a model to preview & quote.';
  ['#volOut','#areaOut','#bboxOut','#materialOut','#machineOut','#setupOut','#finishOut','#turnOut','#hoursOut','#totalOut']
    .forEach(sel => el(sel).textContent = '—');
}

function countdown(seconds=3) {
  const cd = el('#countdown'); cd.style.display = 'flex'; cd.textContent = seconds;
  let rem = seconds;
  const timer = setInterval(() => {
    rem--;
    cd.textContent = rem;
    if (rem <= 0) { clearInterval(timer); cd.style.display = 'none'; }
  }, 1000);
}

/* ------------------------ FILE HANDLING ------------------------ */
function bboxFromGeomPayload(geomPayload) {
  const min = {x: Infinity, y: Infinity, z: Infinity};
  const max = {x:-Infinity, y:-Infinity, z:-Infinity};
  for (const p of geomPayload.parts) {
    const arr = p.positions;
    for (let i = 0; i < arr.length; i += 3) {
      const x = arr[i], y = arr[i+1], z = arr[i+2];
      if (x < min.x) min.x = x; if (y < min.y) min.y = y; if (z < min.z) min.z = z;
      if (x > max.x) max.x = x; if (y > max.y) max.y = y; if (z > max.z) max.z = z;
    }
  }
  return { min, max };
}

async function handleFile(file) {
  const name = file.name || 'model';
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (!['stl','3mf'].includes(ext)) { alert('Please upload an .stl or .3mf file'); return; }
  el('#fileName').textContent = name;
  countdown(3);

  const buf = await file.arrayBuffer();
  const worker = new Worker('./parsers.worker.js', { type: 'module' });

  if (ext === 'stl') {
    worker.postMessage({ type: 'parse', format: 'stl', buffer: buf }, [buf]);
    worker.onmessage = ({ data }) => {
      if (!data.ok) {
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
    try {
      const group = new ThreeMFLoader().parse(buf);
      const parts = [];
      group.traverse(n => {
        if (n.isMesh && n.geometry && n.geometry.attributes && n.geometry.attributes.position) {
          const pos = n.geometry.attributes.position.array;
          const indices = n.geometry.index ? n.geometry.index.array : null;
          parts.push({ positions: Array.from(pos), indices: indices ? Array.from(indices) : null });
        }
      });
      const geomPayload = { format: '3mf', parts };
      const bbox = bboxFromGeomPayload(geomPayload);

      worker.postMessage({ type: 'metricsFromPayload', geomPayload });
      worker.onmessage = ({ data }) => {
        if (!data.ok) {
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
    } catch (e) {
      alert('Parse error (3MF): ' + (e.message || String(e)));
      el('#statusText').textContent = 'Error: ' + (e.message || String(e));
    }
  }
}

/* ------------------------ UI METRICS/PRICING ------------------------ */
function updateMetricsUI() {
  const { volume_mm3, area_mm2, bbox } = lastMetrics || {};
  const f = formatMetrics({ volume_mm3, area_mm2, bbox });
  el('#volOut').textContent = f.volume || '—';
  el('#areaOut').textContent = f.area || '—';
  el('#bboxOut').textContent = f.bbox || '—';
}

function recompute() {
  if (!lastMetrics) return;
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
function loadCustomerFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (saved && typeof saved === 'object') {
      state.customer = { ...state.customer, ...(saved.customer || {}) };
      state.saveCustomer = saved.saveCustomer !== false; // default true
    }
  } catch { }
}

function saveCustomerToStorage() {
  try {
    const payload = { saveCustomer: state.saveCustomer, customer: state.customer };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch { }
}

/* ------------------------ CUSTOMER MODAL ------------------------ */
function showCustomerModal() {
  const overlay = document.createElement('div');
  overlay.className = 'wa-overlay';
  overlay.innerHTML = `...`; // Modal content as it is

  injectModalStyles();
  document.body.appendChild(overlay);

  // Prefill customer data
  const q = s => overlay.querySelector(s);
  q('#waName').value = state.customer.name || '';
  q('#waCompany').value = state.customer.company || '';
  q('#waEmail').value = state.customer.email || '';
  q('#waAddress').value = state.customer.address || '';
  q('#waCity').value = state.customer.city || '';
  q('#waPostcode').value = state.customer.postcode || '';
  q('#waCountry').value = state.customer.country || 'UK';
  q('#waSave').checked = !!state.saveCustomer;

  const close = () => overlay.remove();
  q('.wa-close').addEventListener('click', close);
  q('#waCancel').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  // live-update state + optional save
  [
    ['#waName','name'],
    ['#waCompany','company'],
    ['#waEmail','email'],
    ['#waAddress','address'],
    ['#waCity','city'],
    ['#waPostcode','postcode'],
    ['#waCountry','country']
  ].forEach(([sel, key]) => {
    q(sel).addEventListener('input', e => {
      state.customer[key] = e.target.value.trim();
      if (state.saveCustomer) saveCustomerToStorage();
    });
  });

  q('#waSave').addEventListener('change', e => {
    state.saveCustomer = !!e.target.checked;
    if (state.saveCustomer) saveCustomerToStorage(); else localStorage.removeItem('wa_customer_v1');
  });

  // Continue to email
  q('#waContinue').addEventListener('click', async () => {
    if (!state.customer.email) {
      alert('Please enter the customer’s email so we can CC them.');
      return;
    }
    if (state.saveCustomer) saveCustomerToStorage();
    close();
    await sendQuoteEmail();
  });

  setTimeout(() => q('#waName').focus(), 0);
}

/* ------------------------ SEND EMAIL ------------------------ */
async function sendQuoteEmail() {
  const businessEmail = 'quotes@yourdomain.co.uk'; // Your business email
  const customer = state.customer || {};
  const fileName = document.querySelector('#fileName').textContent || 'model';
  const today = new Date().toISOString().slice(0,10);

  const subject = `Quote request – ${fileName} – ${today}`;
  const lines = [
    `Hello,`,
    ``,
    `Please see the details for this 3D printing quote:`,
    ``,
    `• Part: ${fileName}`,
    `• Technology: ${String(state.tech || '').toUpperCase()}`,
    `• Layer height: ${state.layer} mm`,
    `• Infill: ${state.tech==='fdm' ? state.infillPct + '%' : 'N/A'}`,
    `• Post-processing: ${state.post}`,
    `• Turnaround: ${state.turnaround.toUpperCase()}`,
    `• Quantity: ${state.qty}`,
    ``,
    `Geometry:`,
    `• Volume: ${formatMetrics({ volume_mm3: lastMetrics.volume_mm3 }).volume}`,
    `• Surface area: ${formatMetrics({ area_mm2: lastMetrics.area_mm2 }).area}`,
    `• Bounding box: ${formatMetrics({ bbox: lastMetrics.bbox }).bbox}`,
    ``,
    `Pricing:`,
    `• Per unit: £${lastQuote.perUnit.toFixed(2)}`,
    `• Total (ex VAT): £${lastQuote.total.toFixed(2)}`,
    `• Est. hours: ${lastQuote.hours.toFixed(2)} h`,
    ``,
    `Customer details:`,
    `• Name: ${customer.name || '-'}`,
    `• Company: ${customer.company || '-'}`,
    `• Email: ${customer.email || '-'}`,
    `• Address: ${[customer.address, [customer.city, customer.postcode].filter(Boolean).join(' '), customer.country].filter(Boolean).join(', ') || '-'}`,
    ``,
    `Please reply with confirmation or any questions.`,
    ``,
    `Thanks!`
  ];

  const mailto = new URL('mailto:' + businessEmail);
  mailto.searchParams.set('cc', customer.email || '');
  mailto.searchParams.set('subject', encodeURIComponent(subject));
  mailto.searchParams.set('body', encodeURIComponent(lines.join('\n')));

  const link = document.createElement('a');
  link.href = mailto.toString();
  link.target = '_blank'; // Open in a new tab
  link.click();
}

/* ------------------------ INIT ------------------------ */
initViewer(document.getElementById('viewerRoot'));
new ResizeObserver(() => setSize()).observe(document.getElementById('viewerRoot'));
bindUI();
