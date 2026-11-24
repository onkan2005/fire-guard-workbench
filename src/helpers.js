// Small geometry/material helpers. Units are millimetres, Y is up, bench top is y = 0.
import * as THREE from 'three';

export const PCB_Y = 2;          // PCBs sit on 2 mm standoffs
export const TOP = PCB_Y + 1.6;  // top surface of a PCB
export const HDR_TIP = TOP + 2.5 + 6; // tip of a male header pin

const cache = new Map();
export function mat(color, opts = {}) {
  const key = color + '|' + JSON.stringify(opts);
  if (!cache.has(key)) cache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0, ...opts }));
  return cache.get(key);
}
export const GOLD = () => mat('#d8b25a', { metalness: 0.9, roughness: 0.28 });
export const METAL = () => mat('#c4c8cf', { metalness: 0.85, roughness: 0.3 });
export const BLACK = () => mat('#16171a', { roughness: 0.7 });

export function shadow(m) { m.castShadow = true; m.receiveShadow = true; return m; }

// box with its BOTTOM at y
export function box(parent, w, h, d, material, x = 0, y = 0, z = 0) {
  const m = shadow(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material));
  m.position.set(x, y + h / 2, z); parent.add(m); return m;
}
// vertical cylinder with its BOTTOM at y
export function cyl(parent, r, h, material, x = 0, y = 0, z = 0, seg = 28, rTop = r) {
  const m = shadow(new THREE.Mesh(new THREE.CylinderGeometry(rTop, r, h, seg), material));
  m.position.set(x, y + h / 2, z); parent.add(m); return m;
}

// Canvas texture drawn in millimetre coordinates centred on the face.
// Canvas top maps to -z (far edge) on a box top face, so text reads from the front.
export function canvasTex(w, d, draw, k = 12) {
  const c = document.createElement('canvas');
  c.width = Math.max(8, Math.round(w * k)); c.height = Math.max(8, Math.round(d * k));
  const g = c.getContext('2d');
  g.scale(c.width / w, c.height / d); g.translate(w / 2, d / 2);
  draw(g);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
export function txt(g, s, x, y, size, color = '#f4f4f4', align = 'center', weight = 600) {
  g.fillStyle = color; g.font = `${weight} ${size}px system-ui, "Segoe UI", sans-serif`;
  g.textAlign = align; g.textBaseline = 'middle'; g.fillText(s, x, y);
}

// PCB with silkscreen drawn by `draw(g)` (mm coords, origin at centre)
export function pcb(parent, w, d, color, draw, k = 12) {
  const tex = canvasTex(w, d, g => { g.fillStyle = color; g.fillRect(-w / 2, -d / 2, w, d); draw && draw(g); }, k);
  const side = mat(color, { roughness: 0.6 });
  const top = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 });
  const m = shadow(new THREE.Mesh(new THREE.BoxGeometry(w, 1.6, d), [side, side, top, side, side, side]));
  m.position.y = PCB_Y + 0.8; parent.add(m);
  // four standoffs
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(parent, 0.9, PCB_Y, BLACK(), sx * (w / 2 - 2), 0, sz * (d / 2 - 2), 8);
  m.userData.tex = tex; m.userData.pcb = true;
  return m;
}

// a textured plane lying flat (facing +y)
export function decal(parent, w, d, draw, x, y, z, k = 12) {
  const tex = canvasTex(w, d, draw, k);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.5 }));
  m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); parent.add(m); m.receiveShadow = true;
  return m;
}

// floating name tag that always faces the camera
export function tag(text, height = 6, color = '#ffffff', bg = 'rgba(15,20,25,.85)', border = '#36b7ff') {
  const W = Math.max(128, text.length * 24 + 32), c = document.createElement('canvas'); c.width = W; c.height = 64;
  const g = c.getContext('2d'); g.fillStyle = bg; g.beginPath(); g.roundRect(4, 6, W - 8, 52, 14); g.fill();
  g.strokeStyle = border; g.lineWidth = 4; g.stroke();
  g.fillStyle = color; g.font = 'bold 32px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, W / 2, 33);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, toneMapped: false }));
  s.scale.set(height * W / 64, height, 1); return s;
}
export function softSprite(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, inner); gr.addColorStop(1, outer); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
