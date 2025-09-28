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
  unitScale: 1, // mm multiplier
  tech: 'fdm',
  layer: '0.2',
  post: 'none',
  turnaround: 'standard',
  qty: 1,
  infillPct: 20
};

// UI bindings
function bindUI(){
  ['techSel','layerSel','postSel','turnSel','qtyInput','infillInput'].forEach(id=>{
    el('#'+id).addEventListener('input', onUIChange);
  });
  el('#resetBtn').addEventListener('click', resetAll);
  el('#downloadQuoteBtn').addEventListener('click', downloadQuote);
  el('#fitBtn').addEventListener('click', fitToView);

  const dropZone = el('#dropZone');
  ['dragenter','dragover'].forEach(t=> dropZone.addEventListener(t, e=>{ e.preventDefault(); dropZone.classList.add('dragover'); }));
  ['dragleave','drop'].forEach(t=> dropZone.addEventListener(t, e=>{ e.preventDefault(); dropZone.classList.remove('dragover'); }));
  dropZone.addEventListener('drop', e=>{ const f = e.dataTransfer.files && e.dataTransfer.files[0]; if(f) handleFile(f); });
  el('#fileInput').addEventListener('change', e=>{ const f = e.target.files[0]; if(f) handleFile(f); });
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
}

function countdown(seconds=3){
  const cd = el('#countdown'); cd.style.display = 'flex'; cd.textContent = seconds;
  let rem = seconds;
  const timer = setInterval(()=>{ rem--; cd.textContent = rem; if(rem<=0){ clearInterval(timer); cd.style.display = 'none'; } }, 1000);
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
    // Parse STL fully in worker
    worker.postMessage({ type:'parse', format:'stl', buffer: buf }, [buf]);
    worker.onmessage = ({ data }) => {
      if (!data.ok){ alert('Parse error: ' + data.error); el('#statusText').textContent = 'Error: ' + data.error; return; }
      const { bbox, metrics, geomPayload } = data.result;
      lastMetrics = metrics;
      el('#statusText').textContent = 'Model loaded. Metrics computed.';

      loadGeometryIntoScene(geomPayload);
      centerAndFrame(bbox);
      updateMetricsUI();
      recompute();
    };
  } else {
    // 3MF must be parsed on main thread (DOMParser unavailable in workers)
    try{
      const group = new ThreeMFLoader().parse(buf);
      // Collect parts as simple arrays
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

      // Ask worker to compute metrics from the flattened payload (no DOMParser needed)
      worker.postMessage({ type:'metricsFromPayload', geomPayload });
      worker.onmessage = ({ data }) => {
        if(!data.ok){ alert('Metrics error: ' + data.error); el('#statusText').textContent = 'Error: ' + data.error; return; }
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
  el('#volOut').textContent = f.volume;
  el('#areaOut').textContent = f.area;
  el('#bboxOut').textContent = f.bbox;
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

function downloadQuote(){
  if(!lastMetrics || !lastQuote){ alert('Upload a model first.'); return; }
  const today = new Date().toISOString().slice(0,10);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Quote</title>
  <style>body{font-family:system-ui;padding:24px;color:#0b1220} h1{font-size:20px;margin:0 0 8px}
  table{width:100%;border-collapse:collapse;margin-top:12px} td,th{border:1px solid #e5e7eb;padding:8px;text-align:right}
  th{text-align:left;background:#f8fafc} .muted{color:#64748b}</style></head><body>
  <h1>Instant Quote</h1>
  <div class="muted">Date: ${today}</div>
  <p><strong>Technology:</strong> ${state.tech.toUpperCase()} &nbsp; | &nbsp; <strong>Est. hours:</strong> ${lastQuote.hours.toFixed(2)} h</p>
  <table><tr><th>Description</th><th>Qty</th><th>Unit</th><th>Total</th></tr>
  <tr><td>3D print — ${document.querySelector('#fileName').textContent}</td><td style="text-align:center">${state.qty}</td><td>${fmt(lastQuote.perUnit)}</td><td>${fmt(lastQuote.total)}</td></tr>
  </table>
  <p class="muted">Volume: ${formatMetrics({volume_mm3:lastMetrics.volume_mm3}).volume} &nbsp; | &nbsp; Area: ${formatMetrics({area_mm2:lastMetrics.area_mm2}).area} &nbsp; | &nbsp; BBox: ${formatMetrics({bbox:lastMetrics.bbox}).bbox}</p>
  <p class="muted">Prices in GBP, indicative only. Shipping & VAT not included unless specified.</p></body></html>`;
  const win = window.open('', '_blank');
  win.document.open(); win.document.write(html); win.document.close(); win.focus(); try{ win.print(); } catch(e){}
}

// Viewer init + resize
initViewer(document.getElementById('viewerRoot'));
new ResizeObserver(()=> setSize()).observe(document.getElementById('viewerRoot'));

bindUI();
