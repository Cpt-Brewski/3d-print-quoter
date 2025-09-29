// viewer.js
import * as THREE from 'https://esm.sh/three@0.160.0';
import { OrbitControls } from 'https://esm.sh/three@0.160.0/examples/jsm/controls/OrbitControls.js';

let scene, camera, renderer, controls, modelGroup, rootEl;

export function initViewer(root){
  rootEl = root;
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0f14);
  camera = new THREE.PerspectiveCamera(50, root.clientWidth/root.clientHeight, 0.1, 10000);
  camera.position.set(120,100,140);

  // ⬇️ keep the drawn frame so toDataURL() returns pixels
  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(root.clientWidth, root.clientHeight);
  renderer.setClearColor(0xffffff, 1); // white background
  root.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  const grid = new THREE.GridHelper(500, 50, 0x2a3340, 0x1c2430);
  grid.material.opacity = 0.3; grid.material.transparent = true;
  scene.add(grid);

  const light1 = new THREE.DirectionalLight(0xffffff, 1.0); light1.position.set(1,1,1);
  const light2 = new THREE.DirectionalLight(0xffffff, 0.6); light2.position.set(-1,2,-1);
  const amb = new THREE.AmbientLight(0xffffff, 0.4);
  scene.add(light1, light2, amb);

  modelGroup = new THREE.Group(); scene.add(modelGroup);

  function animate(){ requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera); }
  animate();
  return { scene, camera, renderer };
}

export function setSize(){
  if(!renderer) return;
  const w = rootEl.clientWidth, h = rootEl.clientHeight;
  camera.aspect = w / h; camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

export function clearModel(){ while(modelGroup.children.length) modelGroup.remove(modelGroup.children[0]); }

export function loadGeometryIntoScene(geomPayload){
  clearModel();
  for(const part of geomPayload.parts){
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(part.positions, 3));
    if(part.indices) geo.setIndex(part.indices);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({color:0x58a6ff, metalness:0.1, roughness:0.7}));
    modelGroup.add(mesh);
  }
}

// Keep your existing centerAndFrame(...)
export function centerAndFrame(bbox){
  const box = new THREE.Box3(new THREE.Vector3(bbox.min.x,bbox.min.y,bbox.min.z), new THREE.Vector3(bbox.max.x,bbox.max.y,bbox.max.z));
  const size = new THREE.Vector3(); box.getSize(size);
  const center = new THREE.Vector3(); box.getCenter(center);
  modelGroup.position.sub(center);

  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = camera.fov * (Math.PI/180);
  const dist = (maxDim/2) / Math.tan(fov/2) * 1.8;
  camera.position.set(dist, dist*0.75, dist);
  controls.target.set(0,0,0);
  controls.update();
}

// ⬇️ New: safe snapshot helper (waits 1 frame to ensure pixels are drawn)
export async function getSnapshot(){
  if(!renderer) return '';
  await new Promise(r => requestAnimationFrame(r));
  try {
    return renderer.domElement.toDataURL('image/png');
  } catch {
    return '';
  }
}
