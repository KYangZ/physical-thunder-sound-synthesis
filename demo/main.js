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
import { synthesizeThunder } from "./thunder.js";

/** Lightning stroke width in meters (visible at km-scale views). */
const LIGHTNING_LINE_WIDTH = 10;

/** Ground strike point (meters). */
const STRIKE_POINT = [0, 0, 0];
const METERS_PER_MILE = 1609.344;

/** Ground grid extent and cell size in meters. */
const GRID_EXTENT_M = 6000;
const GRID_CELL_M = 100;

/**
 * On-screen listener glyph scale. Base shapes below are ~human-sized (m);
 * multiply by this for visibility at km-scale views. Acoustics use the group
 * origin on the ground — change this without affecting thunder synthesis.
 */
const LISTENER_MARKER_SCALE = 150;

/** Human-scale listener glyph (meters), before LISTENER_MARKER_SCALE. */
const LISTENER_BASE = {
  footprintInner: 0.35,
  footprintOuter: 0.5,
  torsoRadius: 0.34,
  torsoHeight: 0.75,
  headRadius: 0.2,
  hitRadius: 0.65,
};

function listenerSize(key) {
  return LISTENER_BASE[key] * LISTENER_MARKER_SCALE;
}

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
  scene.fog = new THREE.Fog(0x0a0e14, 4500, 12000);

  const camera = new THREE.PerspectiveCamera(
    50,
    container.clientWidth / container.clientHeight,
    1,
    25000,
  );
  camera.position.set(2000, 1500, 3000);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, 1500, 0);
  controls.minDistance = 750;
  controls.maxDistance = 10000;
  controls.update();

  const grid = new THREE.GridHelper(
    GRID_EXTENT_M,
    GRID_EXTENT_M / GRID_CELL_M,
    0x2a3848,
    0x141c28,
  );
  grid.position.y = 0;
  scene.add(grid);

  const axes = new THREE.AxesHelper(500);
  scene.add(axes);

  let segments = generateLightningSegments(
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
    segments = generateLightningSegments(
      DEFAULT_LIGHTNING_START,
      DEFAULT_LIGHTNING_END,
      {
        ...DEFAULT_LIGHTNING_PARAMS,
        seed: Math.floor(Math.random() * 0x7fffffff),
      },
    );
    updateLightningLines(lightning, segments);
    invalidateThunder();
  });

  const generateThunderButton = document.getElementById("generate-thunder");
  const playThunderButton = document.getElementById("play-thunder");
  const thunderStatusEl = document.getElementById("thunder-status");

  let thunderBuffer = null;
  let thunderSource = null;
  const audioContext = new AudioContext();

  function invalidateThunder() {
    thunderBuffer = null;
    playThunderButton.disabled = true;
    thunderStatusEl.textContent = "Lightning changed — generate thunder again.";
  }

  function setThunderStatus(message) {
    thunderStatusEl.textContent = message;
  }

  function listenerPosition() {
    const { x, y, z } = listener.position;
    return [x, y, z];
  }

  generateThunderButton.addEventListener("click", async () => {
    if (thunderSource) {
      thunderSource.stop();
      thunderSource.disconnect();
      thunderSource = null;
    }

    generateThunderButton.disabled = true;
    setThunderStatus("Generating…");

    const t0 = performance.now();
    const { samples, sampleRate, duration, peak, soundStart } = synthesizeThunder(
      segments,
      listenerPosition(),
    );
    const generateMs = performance.now() - t0;

    console.log(`Thunder generated in ${generateMs.toFixed(1)} ms`);

    thunderBuffer = audioContext.createBuffer(1, samples.length, sampleRate);
    thunderBuffer.getChannelData(0).set(samples);

    playThunderButton.disabled = false;
    generateThunderButton.disabled = false;
    setThunderStatus(
      `Ready: ${duration.toFixed(2)} s, peak ${(peak * 100).toFixed(0)}%, thunder ~${soundStart.toFixed(1)} s in (${generateMs.toFixed(0)} ms)`,
    );
  });

  playThunderButton.addEventListener("click", async () => {
    if (!thunderBuffer) return;

    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    if (thunderSource) {
      thunderSource.stop();
      thunderSource.disconnect();
    }

    thunderSource = audioContext.createBufferSource();
    thunderSource.buffer = thunderBuffer;
    thunderSource.connect(audioContext.destination);
    thunderSource.onended = () => {
      thunderSource = null;
      if (thunderBuffer) {
        setThunderStatus(
          `Ready: ${segments.length} segments, ${thunderBuffer.duration.toFixed(2)} s`,
        );
      }
    };
    thunderSource.start();
    setThunderStatus("Playing…");
  });

  const listener = new THREE.Group();
  listener.position.set(-1250, 0, -500);

  const listenerMaterial = new THREE.MeshBasicMaterial({ color: 0x86efac });

  const torsoHeight = listenerSize("torsoHeight");
  const headRadius = listenerSize("headRadius");

  const listenerFootprint = new THREE.Mesh(
    new THREE.RingGeometry(
      listenerSize("footprintInner"),
      listenerSize("footprintOuter"),
      32,
    ),
    new THREE.MeshBasicMaterial({
      color: 0x4ade80,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
    }),
  );
  listenerFootprint.rotation.x = -Math.PI / 2;
  listenerFootprint.position.y = 0.5;
  listener.add(listenerFootprint);

  const listenerTorso = new THREE.Mesh(
    new THREE.ConeGeometry(listenerSize("torsoRadius"), torsoHeight, 4),
    listenerMaterial,
  );
  listenerTorso.rotation.x = Math.PI;
  listenerTorso.position.y = torsoHeight / 2;
  listener.add(listenerTorso);

  const listenerHead = new THREE.Mesh(
    new THREE.SphereGeometry(headRadius, 16, 12),
    listenerMaterial,
  );
  listenerHead.position.y = torsoHeight + headRadius;
  listener.add(listenerHead);

  const listenerHit = new THREE.Mesh(
    new THREE.SphereGeometry(listenerSize("hitRadius"), 12, 8),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  listenerHit.position.y = (torsoHeight + headRadius) / 2;
  listener.add(listenerHit);

  scene.add(listener);

  const listenerCoordsEl = document.getElementById("listener-coords");

  function updateListenerCoordsDisplay() {
    const { x, y, z } = listener.position;
    const [sx, sy, sz] = STRIKE_POINT;
    const distM = Math.hypot(x - sx, y - sy, z - sz);
    const distKm = distM / 1000;
    const distMi = distM / METERS_PER_MILE;
    listenerCoordsEl.textContent =
      `Listener (m): x ${x.toFixed(0)}, y ${y.toFixed(0)}, z ${z.toFixed(0)} · ` +
      `${distKm.toFixed(2)} km (${distMi.toFixed(2)} mi) from strike`;
  }

  function setListenerGroundPosition(x, z) {
    listener.position.x = x;
    listener.position.z = z;
    updateListenerCoordsDisplay();
    invalidateThunder();
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
