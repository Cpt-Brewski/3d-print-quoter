// parsers.worker.js
// Worker still used when available; computes metrics & parses STL.
// In sandboxed embeds where workers are blocked, main thread will fallback.

import * as THREE from 'https://esm.sh/three@0.160.0';
import { STLLoader } from 'https://esm.sh/three@0.160.0/examples/jsm/loaders/STLLoader.js';

function triArea(a,b,c){
  const ab = new THREE.Vector3().subVectors(b,a);
  const ac = new THREE.Vector3().subVectors(c,a);
  const cross = new THREE.Vector3().crossVectors(ab, ac);
  return 0.5 * cross.length();
}
function triSignedVolume(a,b,c){
  return a.dot(new THREE.Vector3().crossVectors(b,c)) / 6;
}
function metricsFromGeometry(geometry){
  const pos = geometry.attributes.position;
  const idx = geometry.index ? geometry.index.array : null;
  const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3();
  let area = 0, volume = 0;

  if(idx){
    for(let i=0; i<idx.length; i+=3){
      vA.fromBufferAttribute(pos, idx[i]);
      vB.fromBufferAttribute(pos, idx[i+1]);
      vC.fromBufferAttribute(pos, idx[i+2]);
      area += triArea(vA,vB,vC);
      volume += triSignedVolume(vA,vB,vC);
    }
  } else {
    for(let i=0; i<pos.count; i+=3){
      vA.fromBufferAttribute(pos, i);
      vB.fromBufferAttribute(pos, i+1);
      vC.fromBufferAttribute(pos, i+2);
      area += triArea(vA,vB,vC);
      volume += triSignedVolume(vA,vB,vC);
    }
  }
  return { area_mm2: Math.abs(area), volume_mm3: Math.abs(volume) };
}

function metricsFromPayload(geomPayload){
  let area = 0, volume = 0;
  const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3();
  for(const part of geomPayload.parts){
    const pos = part.positions;
    const idx = part.indices;
    if(idx){
      for(let i=0;i<idx.length;i+=3){
        const i0 = idx[i]*3, i1 = idx[i+1]*3, i2 = idx[i+2]*3;
        vA.set(pos[i0], pos[i0+1], pos[i0+2]);
        vB.set(pos[i1], pos[i1+1], pos[i1+2]);
        vC.set(pos[i2], pos[i2+1], pos[i2+2]);
        area += triArea(vA,vB,vC);
        volume += triSignedVolume(vA,vB,vC);
      }
    } else {
      for(let i=0;i<pos.length;i+=9){
        vA.set(pos[i], pos[i+1], pos[i+2]);
        vB.set(pos[i+3], pos[i+4], pos[i+5]);
        vC.set(pos[i+6], pos[i+7], pos[i+8]);
        area += triArea(vA,vB,vC);
        volume += triSignedVolume(vA,vB,vC);
      }
    }
  }
  return { area_mm2: Math.abs(area), volume_mm3: Math.abs(volume) };
}

self.onmessage = async ({ data }) => {
  try{
    if(data.type === 'parseSTL'){
      const geom = new STLLoader().parse(data.buffer);
      const metrics = metricsFromGeometry(geom);
      const box = new THREE.Box3().setFromObject(new THREE.Mesh(geom));
      const bbox = { min:{x:box.min.x,y:box.min.y,z:box.min.z}, max:{x:box.max.x,y:box.max.y,z:box.max.z} };
      const geomPayload = { format:'stl', parts:[{ positions: Array.from(geom.attributes.position.array), indices: geom.index? Array.from(geom.index.array) : null }] };
      self.postMessage({ ok:true, result: { metrics, bbox, geomPayload } });
    } else if(data.type === 'metricsFromPayload'){
      const metrics = metricsFromPayload(data.geomPayload);
      self.postMessage({ ok:true, result: { metrics } });
    } else {
      throw new Error('Unknown worker message type');
    }
  }catch(e){
    self.postMessage({ ok:false, error: e.message || String(e) });
  }
};
