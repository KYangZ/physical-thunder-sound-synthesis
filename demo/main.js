import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

/** Placeholder lightning: main trunk + one branch (line segments in 3D). */
const SAMPLE_LIGHTNING_SEGMENTS = [
  // main trunk (top to ground)
  [[0, 12, 0], [0.4, 10, 0.1]],
  [[0.4, 10, 0.1], [-0.3, 8, -0.2]],
  [[-0.3, 8, -0.2], [0.5, 6, 0.15]],
  [[0.5, 6, 0.15], [-0.2, 4, -0.1]],
  [[-0.2, 4, -0.1], [0.3, 2, 0.05]],
  [[0.3, 2, 0.05], [0, 0, 0]],
  // branch from mid-trunk
  [[0.5, 6, 0.15], [1.8, 5.2, 0.6]],
  [[1.8, 5.2, 0.6], [2.4, 3.8, 0.9]],
];

function buildLightningGroup(segments) {
  const group = new THREE.Group();
  const points = [];

  for (const [[x0, y0, z0], [x1, y1, z1]] of segments) {
    points.push(x0, y0, z0, x1, y1, z1);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(points, 3),
  );

  const core = new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({
      color: 0xe8f4ff,
      linewidth: 1, // ignored on most platforms; use glow mesh if thicker lines are needed
    }),
  );
  group.add(core);

  // Soft outer glow (duplicate geometry, additive blend)
  const glow = new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({
      color: 0x6eb8ff,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  glow.scale.setScalar(1.02);
  group.add(glow);

  return group;
}

function init() {
  const container = document.getElementById("viewport");

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0e14);
  scene.fog = new THREE.Fog(0x0a0e14, 18, 45);

  const camera = new THREE.PerspectiveCamera(
    50,
    container.clientWidth / container.clientHeight,
    0.1,
    200,
  );
  camera.position.set(8, 6, 12);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, 5, 0);
  controls.minDistance = 3;
  controls.maxDistance = 40;
  controls.update();

  const grid = new THREE.GridHelper(20, 20, 0x1e2836, 0x141c28);
  grid.position.y = 0;
  scene.add(grid);

  const axes = new THREE.AxesHelper(2);
  scene.add(axes);

  const lightning = buildLightningGroup(SAMPLE_LIGHTNING_SEGMENTS);
  scene.add(lightning);

  const groundMarker = new THREE.Mesh(
    new THREE.RingGeometry(0.35, 0.5, 32),
    new THREE.MeshBasicMaterial({
      color: 0x3a5068,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
    }),
  );
  groundMarker.rotation.x = -Math.PI / 2;
  groundMarker.position.y = 0.01;
  scene.add(groundMarker);

  function onResize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }

  window.addEventListener("resize", onResize);

  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }

  animate();
}

init();
