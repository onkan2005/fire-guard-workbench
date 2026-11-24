// Dupont jumper wires drawn as 3D tubes between pin anchors.
// Visual state (hover, selected, traced, focused, live signal glow) is applied every frame in update().
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const housingGeo = new THREE.BoxGeometry(2.6, 14, 2.6);
const ferruleGeo = new THREE.CylinderGeometry(1.1, 1.1, 4, 10);
const BLACK = new THREE.Color('#000000');
const FERRULE = new THREE.MeshStandardMaterial({ color: '#c4c8cf', metalness: 0.85, roughness: 0.3 });

// Straight runs joined by small rounded corners: how a tidy, hand-routed wire looks.
export function filletPath(pts, r = 3.5) {
  const P = []; for (const p of pts) if (!P.length || P[P.length - 1].distanceTo(p) > 0.05) P.push(p.clone());
  const path = new THREE.CurvePath();
  if (P.length < 2) { path.add(new THREE.LineCurve3(pts[0], pts[0].clone().add(new THREE.Vector3(0, 0.1, 0)))); return path; }
  let prev = P[0];
  for (let i = 1; i < P.length - 1; i++) {
    const a = P[i - 1], p = P[i], b = P[i + 1];
    const din = p.clone().sub(a), dout = b.clone().sub(p), li = din.length(), lo = dout.length();
    const rr = Math.min(r, li / 2, lo / 2);
    const pin = p.clone().addScaledVector(din.normalize(), -rr), pout = p.clone().addScaledVector(dout.normalize(), rr);
    if (prev.distanceTo(pin) > 0.01) path.add(new THREE.LineCurve3(prev, pin));
    if (rr > 0.01) path.add(new THREE.QuadraticBezierCurve3(pin, p, pout));
    prev = rr > 0.01 ? pout : p;
  }
  if (prev.distanceTo(P[P.length - 1]) > 0.01) path.add(new THREE.LineCurve3(prev, P[P.length - 1]));
  return path;
}

export class WireLayer {
  constructor(scene, pinLookup) {
    this.group = new THREE.Group(); scene.add(this.group);
    this.pin = pinLookup; this.items = new Map();
    this.selected = null; this.hover = null; this.traced = null; this.focused = null;
    this.band = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: '#36e2ff', transparent: true, opacity: 0.85 }));
    this.band.visible = false; scene.add(this.band);
    this.n = 0;
  }
  end(pinId) {
    const p = this.pin(pinId), pos = new THREE.Vector3(), up = UP.clone();
    p.anchor.getWorldPosition(pos);
    const q = new THREE.Quaternion(); p.anchor.getWorldQuaternion(q); up.applyQuaternion(q);
    const screw = p.kind === 'screw' || p.kind === 'lead';
    return { tip: pos, up, start: pos.clone().addScaledVector(up, screw ? 1.5 : 8), screw, q };
  }
  // A jumper rises out of its connector, then sags gently towards the other end.
  // Short hops stay low; each wire gets a small height/side offset so parallel wires don't sit on top of each other.
  curve(a, b, seed = 0) {
    const d = a.start.distanceTo(b.start);
    const h = Math.min(45, 6 + d * 0.16) + (seed % 5) * 1.6;
    const side = new THREE.Vector3().subVectors(b.start, a.start).setY(0);
    const lat = side.lengthSq() > 1 ? new THREE.Vector3(-side.z, 0, side.x).normalize().multiplyScalar(((seed % 7) - 3) * 0.9) : new THREE.Vector3();
    const p1 = a.start.clone().addScaledVector(a.up, h * 0.9), p2 = b.start.clone().addScaledVector(b.up, h * 0.9);
    const mid = p1.clone().lerp(p2, 0.5).add(lat); mid.y = Math.max(p1.y, p2.y) + h * 0.15;
    return new THREE.CatmullRomCurve3([a.start, a.start.clone().addScaledVector(a.up, 3), p1.lerp(mid, 0.35), mid, p2.lerp(mid, 0.35), b.start.clone().addScaledVector(b.up, 3), b.start], false, 'centripetal');
  }
  add(w) {
    const g = new THREE.Group(); g.userData.wire = w.id;
    const material = new THREE.MeshStandardMaterial({ color: w.color, roughness: 0.38, metalness: 0.05, emissive: '#000000' });
    const tube = new THREE.Mesh(new THREE.BufferGeometry(), material); tube.castShadow = true; tube.userData.wire = w.id; g.add(tube);
    const hmat = new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.6 });
    const ends = [0, 1].map(() => { const m = new THREE.Mesh(housingGeo, hmat); m.castShadow = true; m.userData.wire = w.id; g.add(m); return m; });
    this.group.add(g);
    const it = { w, g, tube, ends, material, hmat, seed: this.n++, color: new THREE.Color(w.color) };
    this.items.set(w.id, it); this.refresh(it);
    return it;
  }
  refresh(it) {
    const a = this.end(it.w.a), b = this.end(it.w.b);
    it.tube.geometry.dispose();
    // a router (set in Assembled layout) can send long wires along a cable harness instead of a free arc
    const pts = this.router ? this.router(it.w, a, b, it.seed) : null;
    if (pts) { const c = filletPath(pts, 3.5); it.tube.geometry = new THREE.TubeGeometry(c, Math.min(600, Math.ceil(c.getLength() / 2.5)), 0.85, 8); }
    else it.tube.geometry = new THREE.TubeGeometry(this.curve(a, b, it.seed), 64, 0.85, 8);
    it.curve = it.tube.geometry.parameters.path;
    [a, b].forEach((e, i) => {
      const m = it.ends[i];
      m.geometry = e.screw ? ferruleGeo : housingGeo;
      m.material = e.screw ? FERRULE : it.hmat;
      m.quaternion.copy(e.q); m.position.copy(e.tip).addScaledVector(e.up, 1);
    });
  }
  recolor(id, color) { const it = this.items.get(id); if (!it) return; it.w.color = color; it.material.color.set(color); it.color.set(color); }
  refreshAll() { for (const it of this.items.values()) this.refresh(it); }
  refreshPart(partId) { for (const it of this.items.values()) if (it.w.a.startsWith(partId + '.') || it.w.b.startsWith(partId + '.')) this.refresh(it); }
  remove(id) { const it = this.items.get(id); if (!it) return; this.group.remove(it.g); it.tube.geometry.dispose(); it.material.dispose(); this.items.delete(id); if (this.selected === id) this.selected = null; }
  clear() { for (const id of [...this.items.keys()]) this.remove(id); }
  select(id) { this.selected = id; }
  focus(partId) { this.focused = partId; }
  trace(ids) { this.traced = ids && ids.size ? ids : null; }
  meshes() { const out = []; for (const it of this.items.values()) if (it.g.visible !== false) out.push(it.tube, ...it.ends); return out; }
  midpoint(id) { const it = this.items.get(id); return it && it.curve ? it.curve.getPointAt(0.5) : null; }
  // liveHigh(wire) -> true when the wire carries a HIGH logic signal (used for the optional glow)
  update(t, liveHigh) {
    const pulse = 0.5 + 0.5 * Math.sin(t * 5);
    for (const [id, it] of this.items) {
      const { w, material: m } = it;
      const inFocus = !this.focused || w.a.startsWith(this.focused + '.') || w.b.startsWith(this.focused + '.');
      const inTrace = !this.traced || this.traced.has(id);
      const shown = inFocus && inTrace;
      if (m.transparent !== !shown) { m.transparent = !shown; m.depthWrite = shown; m.needsUpdate = true; } // switching transparency needs a material update
      m.opacity = shown ? 1 : (this.traced ? 0.07 : 0.08);
      it.ends.forEach(e => { e.visible = shown; });
      let k = 0;
      if (this.traced && this.traced.has(id)) k = 0.35 + 0.35 * pulse;
      else if (id === this.selected) k = 0.45;
      else if (id === this.hover) k = 0.35;
      else if (liveHigh && liveHigh(w)) k = 0.55;
      if (k) m.emissive.copy(it.color).multiplyScalar(k); else m.emissive.copy(BLACK);
    }
  }
  showBand(fromPin, to) {
    if (!fromPin) { this.band.visible = false; return; }
    const a = this.end(fromPin), b = { start: to, up: UP };
    this.band.geometry.dispose(); this.band.geometry = new THREE.TubeGeometry(this.curve(a, b), 40, 0.75, 6); this.band.visible = true;
  }
}
