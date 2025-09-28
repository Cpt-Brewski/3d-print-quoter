// main.js (embed-friendly with worker fallback)
import { initViewer, loadGeometryIntoScene, centerAndFrame, setSize } from './viewer.js';
import { price } from './pricing.js';
import { formatMetrics } from './metrics.js';
import { ThreeMFLoader } from 'https://esm.sh/three@0.160.0/examples/jsm/loaders/3MFLoader.js';
import { STLLoader } from 'https://esm.sh/three@0.160.0/examples/jsm/loaders/STLLoader.js';

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
  infillPct: 20
};

function bindUI(){
  ['techSel','layerSel','postSel','turnSel','qtyInput','infillInput'].forEach(id=>{
    el('#'+id).addEventListener('input', onUIChange);
  });
  el('#resetBtn').addEventListener('click', resetAll);
  el('#downloadQuoteBtn').addEventListener('click', downloadQuote);

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

// Worker capability check
const params = new URLSearchParams(location.search);
const FORCE_NO_WORKER = params.get('noworker') === '1';
let workerAvailable = false;
let worker = null;
try{
  if(!FORCE_NO_WORKER){
    worker = new Worker('./parsers.worker.js', { type: 'module' });
    // quick ping test
    worker.postMessage({ type: 'noop' });
    workerAvailable = true;
  }
}catch(e){
  workerAvailable = false;
}

async function handleFile(file){
  const name = file.name || 'model';
  const ext = (name.split('.').pop() || '').toLowerCase();
  if(!['stl','3mf'].includes(ext)) { alert('Please upload an .stl or .3mf file'); return; }
  el('#fileName').textContent = name;
  countdown(3);

  const buf = await file.arrayBuffer();

  if(ext === 'stl'){
    if(workerAvailable){
      const w = worker;
      const onmsg = ({ data }) => {
        if (data.ok && data.result && (data.result.geomPayload || data.result.metrics)) {
          w.removeEventListener('message', onmsg);
          const { bbox, metrics, geomPayload } = data.result;
          lastMetrics = metrics;
          el('#statusText').textContent = 'Model loaded. Metrics computed.';
          loadGeometryIntoScene(geomPayload);
          centerAndFrame(bbox);
          updateMetricsUI();
          recompute();
        } else if(data.ok === false){
          w.removeEventListener('message', onmsg);
          // fallback to main thread parse
          parseSTLMain(buf);
        }
      };
      w.addEventListener('message', onmsg);
      w.postMessage({ type:'parseSTL', buffer: buf }, [buf]);
    } else {
      await parseSTLMain(buf);
    }
  } else {
    // 3MF always on main thread
    await parse3MFMain(buf);
  }
}

async function parseSTLMain(buffer){
  try{
    const geom = new STLLoader().parse(buffer);
    const positions = Array.from(geom.attributes.position.array);
    const indices = geom.index ? Array.from(geom.index.array) : null;
    const geomPayload = { format:'stl', parts:[{ positions, indices }] };
    const bbox = bboxFromGeomPayload(geomPayload);
    // compute metrics on main thread (lightweight for most models)
    const metrics = await metricsFromPayload(geomPayload);
    lastMetrics = { ...metrics, bbox };
    el('#statusText').textContent = 'Model loaded. Metrics computed.';
    loadGeometryIntoScene(geomPayload);
    centerAndFrame(bbox);
    updateMetricsUI();
    recompute();
  }catch(e){
    alert('STL parse error: ' + (e.message || String(e)));
  }
}

async function parse3MFMain(buffer){
  try{
    const group = new ThreeMFLoader().parse(buffer);
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
    const metrics = await metricsFromPayload(geomPayload);
    lastMetrics = { ...metrics, bbox };
    el('#statusText').textContent = 'Model loaded. Metrics computed.';
    loadGeometryIntoScene(geomPayload);
    centerAndFrame(bbox);
    updateMetricsUI();
    recompute();
  }catch(e){
    alert('3MF parse error: ' + (e.message || String(e)));
  }
}

function metricsFromPayload(geomPayload){
  return new Promise((resolve)=>{
    if(workerAvailable){
      const onmsg = ({ data }) => {
        if(data.ok){ worker.removeEventListener('message', onmsg); resolve(data.result.metrics); }
      };
      worker.addEventListener('message', onmsg);
      worker.postMessage({ type:'metricsFromPayload', geomPayload });
    } else {
      // inline compute (very small, fine for embeds)
      let area = 0, volume = 0;
      const vA = [0,0,0], vB=[0,0,0], vC=[0,0,0];
      const triArea = (a,b,c)=>{
        const ab=[b[0]-a[0],b[1]-a[1],b[2]-a[2]];
        const ac=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];
        const cx=ab[1]*ac[2]-ab[2]*ac[1];
        const cy=ab[2]*ac[0]-ab[0]*ac[2];
        const cz=ab[0]*ac[1]-ab[1]*ac[0];
        return 0.5*Math.hypot(cx,cy,cz);
      };
      const triVol=(a,b,c)=> (a[0]*(b[1]*c[2]-b[2]*c[1]) - a[1]*(b[0]*c[2]-b[2]*c[0]) + a[2]*(b[0]*c[1]-b[1]*c[0]))/6;
      for(const part of geomPayload.parts){
        const pos=part.positions, idx=part.indices;
        if(idx){
          for(let i=0;i<idx.length;i+=3){
            const i0=idx[i]*3,i1=idx[i+1]*3,i2=idx[i+2]*3;
            vA[0]=pos[i0];vA[1]=pos[i0+1];vA[2]=pos[i0+2];
            vB[0]=pos[i1];vB[1]=pos[i1+1];vB[2]=pos[i1+2];
            vC[0]=pos[i2];vC[1]=pos[i2+1];vC[2]=pos[i2+2];
            area += triArea(vA,vB,vC);
            volume += triVol(vA,vB,vC);
          }
        } else {
          for(let i=0;i<pos.length;i+=9){
            vA[0]=pos[i];vA[1]=pos[i+1];vA[2]=pos[i+2];
            vB[0]=pos[i+3];vB[1]=pos[i+4];vB[2]=pos[i+5];
            vC[0]=pos[i+6];vC[1]=pos[i+7];vC[2]=pos[i+8];
            area += triArea(vA,vB,vC);
            volume += triVol(vA,vB,vC);
          }
        }
      }
      resolve({ area_mm2: Math.abs(area), volume_mm3: Math.abs(volume) });
    }
  });
}

function updateMetricsUI(){
  const { volume_mm3, area_mm2, bbox } = lastMetrics || {};
  const f = (await import('./metrics.js')).formatMetrics({ volume_mm3, area_mm2, bbox });
  el('#volOut').textContent = f.volume;
  el('#areaOut').textContent = f.area;
  el('#bboxOut').textContent = f.bbox;
}

function recompute(){
  if(!lastMetrics) return;
  const { price } = window.PRICE_MODULE || {};
}

// Inline small helpers to avoid circular imports during dynamic import above
import { formatMetrics } from './metrics.js';
import { price as priceFn } from './pricing.js';

function updateMetricsUI(){
  const { volume_mm3, area_mm2, bbox } = lastMetrics || {};
  const f = formatMetrics({ volume_mm3, area_mm2, bbox });
  el('#volOut').textContent = f.volume;
  el('#areaOut').textContent = f.area;
  el('#bboxOut').textContent = f.bbox;
}

function recompute(){
  if(!lastMetrics) return;
  lastQuote = priceFn({ ...state, volume_mm3: lastMetrics.volume_mm3 });
  el('#materialOut').textContent = fmt(lastQuote.material);
  el('#machineOut').textContent = fmt(lastQuote.machine);
  el('#setupOut').textContent = fmt(lastQuote.setup);
  el('#finishOut').textContent = fmt(lastQuote.finishing);
  el('#turnOut').textContent = state.turnaround.toUpperCase();
  el('#hoursOut').textContent = lastQuote.hours.toFixed(2) + ' h';
  el('#totalOut').textContent = fmt(lastQuote.total) + `  ( ${state.qty} × ${fmt(lastQuote.perUnit)} )`;
}

el('#downloadQuoteBtn').addEventListener('click', ()=>{
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
  <p class="muted">Volume: ${(lastMetrics.volume_mm3/1000).toFixed(2)} cm³ &nbsp; | &nbsp; Area: ${(lastMetrics.area_mm2/100).toFixed(2)} cm² &nbsp; | &nbsp; BBox: ${(lastMetrics.bbox.max.x-lastMetrics.bbox.min.x).toFixed(1)} × ${(lastMetrics.bbox.max.y-lastMetrics.bbox.min.y).toFixed(1)} × ${(lastMetrics.bbox.max.z-lastMetrics.bbox.min.z).toFixed(1)} mm</p>
  <p class="muted">Prices in GBP, indicative only. Shipping & VAT not included unless specified.</p></body></html>`;
  const win = window.open('', '_blank');
  win.document.open(); win.document.write(html); win.document.close(); win.focus(); try{ win.print(); } catch(e){}
});

// Viewer init + resize
initViewer(document.getElementById('viewerRoot'));
new ResizeObserver(()=> setSize()).observe(document.getElementById('viewerRoot'));

bindUI();
