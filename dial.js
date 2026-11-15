/*
  Medidor radial: arco de ±50 cents con aguja animada.
  El SVG base está en index.html; aquí se dibujan las marcas y se mueve la aguja.
*/
const SVG_NS = 'http://www.w3.org/2000/svg';
const PIVOT_X = 160;
const PIVOT_Y = 190;
const ANGLE_MAX = 78; // grados a ±50 cents
const R_RIM = 150;
const R_TICK_MINOR = 139;
const R_TICK_MAJOR = 128;
const R_LABEL = 114;
const NEEDLE_EASE = 0.22;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// Punto sobre el arco para un valor en cents y un radio dado.
function polar(cents, radius) {
  const rad = (clamp(cents, -50, 50) / 50) * ANGLE_MAX * (Math.PI / 180);
  return { x: PIVOT_X + radius * Math.sin(rad), y: PIVOT_Y - radius * Math.cos(rad) };
}

function arcPath(centsFrom, centsTo, radius) {
  const a = polar(centsFrom, radius);
  const b = polar(centsTo, radius);
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${radius} ${radius} 0 0 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
}

function svgEl(name, attrs) {
  const el = document.createElementNS(SVG_NS, name);
  Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
  return el;
}

export class Dial {
  constructor(root) {
    this.rim = root.querySelector('#dialRim');
    this.zone = root.querySelector('#dialZone');
    this.ticks = root.querySelector('#dialTicks');
    this.needle = root.querySelector('#needle');
    this.current = 0;
    this.target = 0;
    this.locked = false;

    this.rim.setAttribute('d', arcPath(-50, 50, R_RIM));
    this.buildTicks();
    this.setTolerance(5);
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  buildTicks() {
    this.ticks.innerHTML = '';
    for (let c = -50; c <= 50; c += 5) {
      const major = c % 25 === 0;
      const inner = polar(c, major ? R_TICK_MAJOR : R_TICK_MINOR);
      const outer = polar(c, R_RIM);
      this.ticks.appendChild(svgEl('line', {
        x1: inner.x.toFixed(2), y1: inner.y.toFixed(2),
        x2: outer.x.toFixed(2), y2: outer.y.toFixed(2),
        class: major ? 'tick major' : 'tick',
      }));
      if (major && c !== 0) {
        const pos = polar(c, R_LABEL);
        const label = svgEl('text', { x: pos.x.toFixed(2), y: (pos.y + 4).toFixed(2), class: 'tick-label' });
        label.textContent = c > 0 ? `+${c}` : `${c}`;
        this.ticks.appendChild(label);
      }
    }
  }

  // La banda verde muestra la tolerancia elegida.
  setTolerance(cents) {
    this.zone.setAttribute('d', arcPath(-cents, cents, R_RIM));
  }

  set(cents) {
    this.target = clamp(cents, -50, 50);
  }

  setLocked(locked) {
    if (this.locked === locked) return;
    this.locked = locked;
    this.needle.classList.toggle('is-locked', locked);
  }

  // Interpola la aguja hacia el objetivo en cada cuadro de pantalla.
  loop() {
    this.current += (this.target - this.current) * NEEDLE_EASE;
    if (Math.abs(this.target - this.current) < 0.01) this.current = this.target;
    const angle = (this.current / 50) * ANGLE_MAX;
    this.needle.setAttribute('transform', `rotate(${angle.toFixed(2)} ${PIVOT_X} ${PIVOT_Y})`);
    requestAnimationFrame(this.loop);
  }
}
