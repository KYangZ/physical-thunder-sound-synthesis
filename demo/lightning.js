/**
 * Procedural lightning via midpoint displacement.
 * Returns segment pairs: [[[x0,y0,z0], [x1,y1,z1]], ...]
 */

function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(v, s) {
  return [v[0] * s, v[1] * s, v[2] * s];
}

function midpoint(a, b) {
  return scale(add(a, b), 0.5);
}

function subtract(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function length(v) {
  return Math.hypot(v[0], v[1], v[2]);
}

function normalize(v) {
  const len = length(v);
  if (len < 1e-9) return [0, 1, 0];
  return scale(v, 1 / len);
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/** Unit vector perpendicular to segment direction (stable fallback if nearly vertical). */
function perpendicularBasis(direction) {
  const up = Math.abs(direction[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = normalize(cross(direction, up));
  const v = normalize(cross(direction, u));
  return [u, v];
}

function subdivideSegment(start, end, depth, displacement, options, segments) {
  if (depth === 0) {
    segments.push([start, end]);
    return;
  }

  const m = midpoint(start, end);
  const direction = normalize(subtract(end, start));
  const [u, v] = perpendicularBasis(direction);
  const offset = add(
    scale(u, displacement * (2 * Math.random() - 1)),
    scale(v, displacement * (2 * Math.random() - 1)),
  );
  const displacedMidpoint = add(m, offset);

  subdivideSegment(start, displacedMidpoint, depth - 1, displacement * options.displacementDecay, options, segments);
  subdivideSegment(displacedMidpoint, end, depth - 1, displacement * options.displacementDecay, options, segments);
}

/**
 * @param {[number, number, number]} start
 * @param {[number, number, number]} end
 * @param {object} [params]
 * @returns {Array<[[number,number,number],[number,number,number]]>}
 */
export function generateLightningSegments(start, end, params = {}) {
  const options = {
    depth: params.depth ?? 5,
    displacement: params.displacement ?? 2,
    displacementDecay: params.displacementDecay ?? 0.5,
    branchProbability: params.branchProbability ?? 0.5,
  };

  const segments = [];
  subdivideSegment(start, end, options.depth, options.displacement, options, segments);
  return segments;
}

export const DEFAULT_LIGHTNING_START = [0, 12, 0];
export const DEFAULT_LIGHTNING_END = [0, 0, 0];
export const DEFAULT_LIGHTNING_PARAMS = {
  depth: 10,
  displacement: 2,
  displacementDecay: 0.5,
  branchProbability: 0.5,
};
