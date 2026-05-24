import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";

import {
  DEFAULT_LIGHTNING_END,
  DEFAULT_LIGHTNING_PARAMS,
  DEFAULT_LIGHTNING_START,
  generateLightningSegments,
} from "./lightning.js";

/** World-space stroke width for lightning segments (same units as geometry). */
const LIGHTNING_LINE_WIDTH = 0.05;

function buildLightningLines(segments, resolution) {
  const positions = [];

  for (const [[x0, y0, z0], [x1, y1, z1]] of segments) {
    positions.push(x0, y0, z0, x1, y1, z1);
  }

  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(positions);

  const material = new LineMaterial({
    color: 0xe8f4ff,
    linewidth: LIGHTNING_LINE_WIDTH,
    worldUnits: true,
    resolution,
  });

  return new LineSegments2(geometry, material);
}

function updateLightningLines(lines, segments) {
  const positions = [];
  for (const [[x0, y0, z0], [x1, y1, z1]] of segments) {
    positions.push(x0, y0, z0, x1, y1, z1);
  }

  lines.geometry.dispose();
  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(positions);
  lines.geometry = geometry;
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

  const segments = generateLightningSegments(
    DEFAULT_LIGHTNING_START,
    DEFAULT_LIGHTNING_END,
    DEFAULT_LIGHTNING_PARAMS,
  );
  const resolution = new THREE.Vector2(
    container.clientWidth,
    container.clientHeight,
  );
  const lightning = buildLightningLines(segments, resolution);
  scene.add(lightning);

  const regenerateButton = document.getElementById("regenerate");
  regenerateButton.addEventListener("click", () => {
    const nextSegments = generateLightningSegments(
      DEFAULT_LIGHTNING_START,
      DEFAULT_LIGHTNING_END,
      {
        ...DEFAULT_LIGHTNING_PARAMS,
        seed: Math.floor(Math.random() * 0x7fffffff),
      },
    );
    updateLightningLines(lightning, nextSegments);
  });

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
    resolution.set(w, h);
    lightning.material.resolution.copy(resolution);
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
