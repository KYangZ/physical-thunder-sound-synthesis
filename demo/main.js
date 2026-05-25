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

  const listener = new THREE.Group();
  listener.position.set(-5, 0, -2);

  const listenerMaterial = new THREE.MeshBasicMaterial({ color: 0x86efac });

  const listenerFootprint = new THREE.Mesh(
    new THREE.RingGeometry(0.35, 0.5, 32),
    new THREE.MeshBasicMaterial({
      color: 0x4ade80,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
    }),
  );
  listenerFootprint.rotation.x = -Math.PI / 2;
  listenerFootprint.position.y = 0.01;
  listener.add(listenerFootprint);

  const torsoHeight = 0.75;
  const listenerTorso = new THREE.Mesh(
    new THREE.ConeGeometry(0.34, torsoHeight, 4),
    listenerMaterial,
  );
  listenerTorso.rotation.x = Math.PI;
  listenerTorso.position.y = torsoHeight / 2;
  listener.add(listenerTorso);

  const headRadius = 0.2;
  const listenerHead = new THREE.Mesh(
    new THREE.SphereGeometry(headRadius, 16, 12),
    listenerMaterial,
  );
  listenerHead.position.y = torsoHeight + headRadius;
  listener.add(listenerHead);

  const listenerHit = new THREE.Mesh(
    new THREE.SphereGeometry(0.65, 12, 8),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  listenerHit.position.y = (torsoHeight + headRadius) / 2;
  listener.add(listenerHit);

  scene.add(listener);

  const listenerCoordsEl = document.getElementById("listener-coords");

  function updateListenerCoordsDisplay() {
    const { x, y, z } = listener.position;
    listenerCoordsEl.textContent = `x: ${x.toFixed(2)}, y: ${y.toFixed(2)}, z: ${z.toFixed(2)}`;
  }

  function setListenerGroundPosition(x, z) {
    listener.position.x = x;
    listener.position.z = z;
    updateListenerCoordsDisplay();
  }

  updateListenerCoordsDisplay();

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const groundHit = new THREE.Vector3();
  let draggingListener = false;

  function setPointerFromEvent(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  function projectPointerOntoGround() {
    raycaster.setFromCamera(pointer, camera);
    return raycaster.ray.intersectPlane(groundPlane, groundHit);
  }

  function onPointerDown(event) {
    if (event.button !== 0) return;
    setPointerFromEvent(event);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(listenerHit, false);
    if (hits.length === 0) return;

    draggingListener = true;
    controls.enabled = false;
    renderer.domElement.setPointerCapture(event.pointerId);
    renderer.domElement.style.cursor = "grabbing";
    projectPointerOntoGround();
    setListenerGroundPosition(groundHit.x, groundHit.z);
  }

  function onPointerMove(event) {
    setPointerFromEvent(event);
    if (draggingListener) {
      if (projectPointerOntoGround()) {
        setListenerGroundPosition(groundHit.x, groundHit.z);
      }
      return;
    }

    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(listenerHit, false);
    renderer.domElement.style.cursor = hits.length > 0 ? "grab" : "";
  }

  function onPointerUp(event) {
    if (!draggingListener) return;
    draggingListener = false;
    controls.enabled = true;
    renderer.domElement.releasePointerCapture(event.pointerId);
    renderer.domElement.style.cursor = "";
  }

  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  renderer.domElement.addEventListener("pointermove", onPointerMove);
  renderer.domElement.addEventListener("pointerup", onPointerUp);
  renderer.domElement.addEventListener("pointercancel", onPointerUp);

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
