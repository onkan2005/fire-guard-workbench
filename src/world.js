// The physical world around the electronics: fire, heat, gas, water.
export const AMB = 28;
export const TANK_LITRES = 10; // a 10 L tank: 1% = 0.1 L
// Tank geometry shared with the 3D scene (mm): water is TANK_FULL_MM deep when full; the HC-SR04 face is
// TANK_FACE_MM above the tank floor, so it is 2 cm above the water when full (its minimum range).
export const TANK_FULL_MM = 73.4, TANK_FACE_MM = 93.4;
export class World {
  constructor() { this.reset(); }
  reset() {
    Object.assign(this, {
      temp: AMB, hum: 62, fire: false, hp: 0, intensity: 70, gasLeak: 50, smoke: 0, tank: 70, sprPump: false, refPump: false, pumpPower: true,
      overflow: 0, dry: 0, t: 0, phase: 'before', sprayL: 0, lastSprayL: 0, totalSprayL: 0, refilledL: 0,
    });
  }
  get flameVisible() { return this.fire && this.hp > 0; }
  get gasPpm() { return Math.round(this.gasLeak + this.smoke); }
  usDistanceMm() { return TANK_FACE_MM - TANK_FULL_MM * this.tank / 100 + (Math.random() - 0.5) * 0.6; }
  get spraying() { return this.sprPump && this.pumpPower && this.tank > 0.3; } // pumpPower: the battery’s red lead is plugged in
  ignite() { this.fire = true; this.hp = 100; this.phase = 'during'; }
  extinguish() { this.fire = false; this.hp = 0; }
  step(dt) {
    if (dt <= 0) return;
    this.t += dt;
    const fl = this.flameVisible, spray = this.spraying;
    if (fl) this.temp += (AMB + (this.intensity - AMB) * this.hp / 100 - this.temp) * 0.5 * dt;
    else this.temp += (AMB - this.temp) * (spray ? 0.35 : 0.12) * dt;
    if (spray) {
      const used = Math.min(this.tank, 0.8 * dt);
      this.tank -= used; this.sprayL += used * TANK_LITRES / 100; this.totalSprayL += used * TANK_LITRES / 100;
      if (this.fire) { this.hp -= 6 * dt; if (this.hp <= 0) this.extinguish(); }
    } else if (this.sprayL > 0) { this.lastSprayL = this.sprayL; this.sprayL = 0; }
    this.dry = this.sprPump && this.pumpPower && !spray ? this.dry + dt : 0;
    if (this.refPump && this.pumpPower) { const before = this.tank; this.tank += 3.5 * dt; if (this.tank > 100) { this.overflow += (this.tank - 100); this.tank = 100; } this.refilledL += (this.tank - before) * TANK_LITRES / 100; }
    this.overflow = Math.max(0, this.overflow - 2 * dt);
    const smokeTarget = fl ? 260 * this.hp / 100 : 0;
    this.smoke += (smokeTarget - this.smoke) * Math.min(1, 0.35 * dt);
    this.hum = Math.max(15, Math.min(99, 62 - (this.temp - AMB) * 0.8 + (spray ? 8 : 0)));
    if (fl) this.phase = 'during';
    else if (this.phase === 'during') this.phase = 'after';
  }
}
