/**
 * Ribner & Roy quasilinear thunder model (WM-waves per segment).
 * Each lightning segment radiates an N-wave; the observer receives the
 * superposition of Wright–Medendorp (WM) waveforms.
 *
 * References: Ribner & Roy, JASA 72(6) 1982; Reiss et al., AES e-Brief 640.
 */

const DEFAULT_SOUND_SPEED = 343;
const DEFAULT_N_WAVE_DURATION = 0.005;
const DEFAULT_SAMPLE_RATE = 44100;

/**
 * Scene units → meters. The viewport uses arbitrary units (bolt height ≈ 12);
 * Ribner–Roy timing needs real distances. 100 m/unit maps the default layout to
 * ~1.2 km channel height and ~0.5–1.3 km listener range.
 */
export const DEFAULT_METERS_PER_UNIT = 100;

/**
 * Fixed gain from model pressure to Web Audio levels. Unlike peak normalization,
 * this preserves relative loudness vs. listener distance (B ∝ 1/r).
 */
export const DEFAULT_OUTPUT_GAIN = 40;

function scalePoint(p, metersPerUnit) {
  return [p[0] * metersPerUnit, p[1] * metersPerUnit, p[2] * metersPerUnit];
}

function subtract(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(v, s) {
  return [v[0] * s, v[1] * s, v[2] * s];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function length(v) {
  return Math.hypot(v[0], v[1], v[2]);
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function midpoint(a, b) {
  return scale(add(a, b), 0.5);
}

/** Unit normal to the segment, in the plane spanned by the segment and the observer. */
function segmentNormalTowardObserver(start, end, observer) {
  const dir = subtract(end, start);
  const segLen = length(dir);
  if (segLen < 1e-9) return [0, 1, 0];

  const d = scale(dir, 1 / segLen);
  const mid = midpoint(start, end);
  const obs = subtract(observer, mid);
  let n = cross(d, cross(d, obs));
  let nLen = length(n);

  if (nLen < 1e-9) {
    const up = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    n = cross(d, up);
    nLen = length(n);
    if (nLen < 1e-9) return [0, 1, 0];
  }

  return scale(n, 1 / nLen);
}

/** sin(phi) for phi = angle between segment normal and line to observer. */
function sinObserverAngle(normal, observer, mid) {
  const obs = subtract(observer, mid);
  const nLen = length(normal);
  const obsLen = length(obs);
  if (nLen < 1e-9 || obsLen < 1e-9) return 1;
  return length(cross(normal, obs)) / (nLen * obsLen);
}

/**
 * WM-wave pressure at normalized time tau (Eq. 2, Roy 1981 / AES e-Brief 640).
 * @param {number} tau - (c*t - r) / l
 * @param {number} psi - c*T/l
 * @param {number} B - l^2 / (2*r*c*T)
 */
export function wmWavePressure(tau, psi, B) {
  if (psi <= 0 || psi > 1 || !Number.isFinite(tau)) return 0;

  const alpha = Math.asin(psi);
  const psi2 = psi * psi;

  if (tau < psi - alpha) {
    if (tau > -psi - alpha && tau < -psi + alpha) {
      return B * (psi2 - (tau + psi) ** 2);
    }
    if (tau > -psi + alpha && tau < psi - alpha) {
      return 0;
    }
    if (tau > psi - alpha && tau < psi + alpha) {
      return -B * (psi2 - (tau - psi) ** 2);
    }
  } else {
    if (tau > -psi - alpha && tau < -psi) {
      return B * (psi2 - (tau + psi) ** 2);
    }
    if (tau > -psi && tau < -psi + alpha) {
      return 0;
    }
    if (tau > -psi + alpha && tau < psi + alpha) {
      return -B * (psi2 - (tau - psi) ** 2);
    }
  }

  return 0;
}

/**
 * @param {[[number,number,number],[number,number,number]]} segment
 * @param {[number,number,number]} listener
 * @param {{ soundSpeed?: number, nWaveDuration?: number }} params
 */
export function segmentWmParams(segment, listener, params = {}) {
  const c = params.soundSpeed ?? DEFAULT_SOUND_SPEED;
  const T = params.nWaveDuration ?? DEFAULT_N_WAVE_DURATION;

  const [start, end] = segment;
  const l = length(subtract(end, start));
  if (l < 1e-6) return null;

  const mid = midpoint(start, end);
  const normal = segmentNormalTowardObserver(start, end, listener);
  const sinPhi = sinObserverAngle(normal, listener, mid);
  const r = length(subtract(listener, mid));
  if (r < 1e-6) return null;

  // ψ = cT/l must be ≤ 1 for the WM-wave arcsin terms (Ribner & Roy ~3 m segments).
  const psi = Math.min((c * T) / l, 1 - 1e-6);
  if (psi <= 0) return null;

  const B = (l * l) / (2 * r * c * T);
  const spread = (l * sinPhi) / c;
  const tStart = r / c - T - spread;
  const tEnd = r / c + T + spread;

  return { l, r, psi, B, tStart, tEnd };
}

/**
 * Synthesize monaural thunder pressure waveform by summing per-segment WM-waves.
 *
 * @param {Array<[[number,number,number],[number,number,number]]>} segments
 * @param {[number,number,number]} listener
 * @param {object} [options]
 * @param {number} [options.soundSpeed]
 * @param {number} [options.nWaveDuration]
 * @param {number} [options.sampleRate]
 * @param {number} [options.tailPadding]
 * @param {number} [options.metersPerUnit] scene units → meters
 * @param {number} [options.outputGain] fixed playback gain (not peak-normalized)
 * @returns {{ samples: Float32Array, sampleRate: number, duration: number, metersPerUnit: number, outputGain: number, peak: number, soundStart: number }}
 */
export function synthesizeThunder(segments, listener, options = {}) {
  const c = options.soundSpeed ?? DEFAULT_SOUND_SPEED;
  const T = options.nWaveDuration ?? DEFAULT_N_WAVE_DURATION;
  const sampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const tailPadding = options.tailPadding ?? 0.05;
  const metersPerUnit = options.metersPerUnit ?? DEFAULT_METERS_PER_UNIT;
  const outputGain = options.outputGain ?? DEFAULT_OUTPUT_GAIN;

  const listenerM = scalePoint(listener, metersPerUnit);
  const params = { soundSpeed: c, nWaveDuration: T };

  let maxEnd = 0;
  let soundStart = Infinity;
  const contributions = [];

  for (const segment of segments) {
    const [start, end] = segment;
    const segmentM = [scalePoint(start, metersPerUnit), scalePoint(end, metersPerUnit)];
    const wm = segmentWmParams(segmentM, listenerM, params);
    if (!wm) continue;
    maxEnd = Math.max(maxEnd, wm.tEnd);
    soundStart = Math.min(soundStart, wm.tStart);
    contributions.push(wm);
  }

  if (!Number.isFinite(soundStart)) soundStart = 0;

  const duration = maxEnd + tailPadding;
  const numSamples = Math.max(1, Math.ceil(duration * sampleRate));
  const samples = new Float32Array(numSamples);

  for (const { l, r, psi, B, tStart, tEnd } of contributions) {
    const i0 = Math.max(0, Math.floor(tStart * sampleRate));
    const i1 = Math.min(numSamples - 1, Math.ceil(tEnd * sampleRate));

    for (let i = i0; i <= i1; i++) {
      const t = i / sampleRate;
      const tau = (c * t - r) / l;
      samples[i] += wmWavePressure(tau, psi, B);
    }
  }

  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    samples[i] *= outputGain;
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
  }

  return {
    samples,
    sampleRate,
    duration,
    metersPerUnit,
    outputGain,
    peak,
    soundStart,
  };
}
