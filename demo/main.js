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
const GRID_HALF_EXTENT_M = GRID_EXTENT_M / 2;
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
  const thunderPlayerEl = document.getElementById("thunder-player");
  const thunderPlayButton = document.getElementById("thunder-play");
  const thunderTrackEl = document.getElementById("thunder-track");
  const thunderWaveformCanvas = document.getElementById("thunder-waveform");
  const thunderWaveformCtx = thunderWaveformCanvas.getContext("2d");
  const thunderTimeCurrentEl = document.getElementById("thunder-time-current");
  const thunderTimeDurationEl = document.getElementById("thunder-time-duration");
  const thunderStatusEl = document.getElementById("thunder-status");

  let thunderBuffer = null;
  let thunderSource = null;
  let playbackOffset = 0;
  let playbackStartedAt = 0;
  let playbackRafId = null;
  let isThunderPlaying = false;
  let waveformPeaks = null;
  const audioContext = new AudioContext();

  const WAVEFORM_COLORS = {
    unplayed: "#3a5068",
    played: "#60a5fa",
    playing: "#4ade80",
    playhead: "rgba(200, 208, 220, 0.9)",
    center: "rgba(26, 36, 48, 0.6)",
  };

  function buildWaveformPeaks(samples, bucketCount) {
    const peaks = new Float32Array(bucketCount);
    const blockSize = Math.max(1, Math.floor(samples.length / bucketCount));
    let maxPeak = 0;

    for (let i = 0; i < bucketCount; i++) {
      const start = i * blockSize;
      const end = Math.min(start + blockSize, samples.length);
      let peak = 0;
      for (let j = start; j < end; j++) {
        const abs = Math.abs(samples[j]);
        if (abs > peak) peak = abs;
      }
      peaks[i] = peak;
      if (peak > maxPeak) maxPeak = peak;
    }

    if (maxPeak > 0) {
      for (let i = 0; i < bucketCount; i++) {
        peaks[i] /= maxPeak;
      }
    }

    return peaks;
  }

  function waveformBucketCount() {
    const width = thunderTrackEl.clientWidth;
    return Math.max(32, Math.min(512, Math.floor(width * 2)));
  }

  function resizeWaveformCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = thunderTrackEl.clientWidth;
    const height = thunderTrackEl.clientHeight;
    if (width <= 0 || height <= 0) return;

    thunderWaveformCanvas.width = Math.floor(width * dpr);
    thunderWaveformCanvas.height = Math.floor(height * dpr);
    thunderWaveformCanvas.style.width = `${width}px`;
    thunderWaveformCanvas.style.height = `${height}px`;
    thunderWaveformCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function drawThunderWaveform(playRatio = 0) {
    resizeWaveformCanvas();
    const width = thunderTrackEl.clientWidth;
    const height = thunderTrackEl.clientHeight;
    if (width <= 0 || height <= 0) return;

    const ctx = thunderWaveformCtx;
    ctx.clearRect(0, 0, width, height);

    const midY = height / 2;
    ctx.strokeStyle = WAVEFORM_COLORS.center;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(width, midY);
    ctx.stroke();

    if (!waveformPeaks || waveformPeaks.length === 0) return;

    const peaks = waveformPeaks;
    const len = peaks.length;
    const barWidth = Math.max(1, width / len);
    const maxAmp = height / 2 - 2;
    const playX = playRatio * width;
    const activeColor = isThunderPlaying
      ? WAVEFORM_COLORS.playing
      : WAVEFORM_COLORS.played;

    for (let i = 0; i < len; i++) {
      const x = (i / len) * width;
      const amp = peaks[i] * maxAmp;
      if (amp < 0.5) continue;

      const barX = x + (barWidth - 1) / 2;
      const color = x < playX ? activeColor : WAVEFORM_COLORS.unplayed;
      ctx.fillStyle = color;
      ctx.fillRect(barX, midY - amp, 1, amp * 2);
    }

    if (isThunderPlaying || (playRatio > 0 && playRatio <= 1)) {
      ctx.strokeStyle = WAVEFORM_COLORS.playhead;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(playX + 0.5, 0);
      ctx.lineTo(playX + 0.5, height);
      ctx.stroke();
    }
  }

  function setThunderWaveform(samples) {
    waveformPeaks = buildWaveformPeaks(samples, waveformBucketCount());
    drawThunderWaveform(0);
  }

  function clearThunderWaveform() {
    waveformPeaks = null;
    drawThunderWaveform(0);
  }

  function formatPlaybackTime(seconds) {
    const clamped = Math.max(0, seconds);
    const m = Math.floor(clamped / 60);
    const s = clamped % 60;
    return `${m}:${s.toFixed(1).padStart(4, "0")}`;
  }

  function setPlayerDisabled(disabled) {
    thunderPlayerEl.dataset.disabled = disabled ? "true" : "false";
    thunderPlayButton.disabled = disabled;
    thunderTrackEl.tabIndex = disabled ? -1 : 0;
  }

  function setPlayerPlaying(playing) {
    isThunderPlaying = playing;
    thunderPlayerEl.dataset.playing = playing ? "true" : "false";
    thunderPlayButton.textContent = playing ? "❚❚" : "▶";
    thunderPlayButton.setAttribute(
      "aria-label",
      playing ? "Pause thunder" : "Play thunder",
    );
  }

  function setPlaybackPosition(seconds) {
    const duration = thunderBuffer?.duration ?? 0;
    const clamped = Math.min(Math.max(0, seconds), duration);
    const ratio = duration > 0 ? clamped / duration : 0;
    thunderTrackEl.setAttribute("aria-valuenow", String(Math.round(ratio * 100)));
    thunderTimeCurrentEl.textContent = formatPlaybackTime(clamped);
    thunderTimeDurationEl.textContent = formatPlaybackTime(duration);
    drawThunderWaveform(ratio);
  }

  function stopPlaybackRaf() {
    if (playbackRafId !== null) {
      cancelAnimationFrame(playbackRafId);
      playbackRafId = null;
    }
  }

  function currentPlaybackSeconds() {
    if (!thunderBuffer) return 0;
    if (isThunderPlaying) {
      return (
        playbackOffset + (audioContext.currentTime - playbackStartedAt)
      );
    }
    return playbackOffset;
  }

  function tickPlayback() {
    if (!isThunderPlaying || !thunderBuffer) return;
    const elapsed = currentPlaybackSeconds();
    const duration = thunderBuffer.duration;
    if (elapsed >= duration) {
      setPlaybackPosition(duration);
      return;
    }
    setPlaybackPosition(elapsed);
    playbackRafId = requestAnimationFrame(tickPlayback);
  }

  function stopThunderSource() {
    if (thunderSource) {
      thunderSource.onended = null;
      try {
        thunderSource.stop();
      } catch {
        /* already stopped */
      }
      thunderSource.disconnect();
      thunderSource = null;
    }
    stopPlaybackRaf();
  }

  function pauseThunder() {
    if (!isThunderPlaying) return;
    playbackOffset = currentPlaybackSeconds();
    stopThunderSource();
    setPlayerPlaying(false);
    setPlaybackPosition(playbackOffset);
  }

  function resetThunderPlayer() {
    stopThunderSource();
    playbackOffset = 0;
    setPlayerPlaying(false);
    clearThunderWaveform();
    thunderTimeCurrentEl.textContent = formatPlaybackTime(0);
    thunderTimeDurationEl.textContent = formatPlaybackTime(0);
  }

  function invalidateThunder() {
    thunderBuffer = null;
    waveformPeaks = null;
    setPlayerDisabled(true);
    resetThunderPlayer();
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
    pauseThunder();
    setPlayerDisabled(true);

    generateThunderButton.disabled = true;
    setThunderStatus("Generating…");

    const t0 = performance.now();
    const {
      samples,
      sampleRate,
      duration,
      peak,
      soundStart,
      renderSegmentCount,
      acousticSegmentCount,
    } = synthesizeThunder(segments, listenerPosition());
    const generateMs = performance.now() - t0;

    console.log(`Thunder generated in ${generateMs.toFixed(1)} ms`);

    thunderBuffer = audioContext.createBuffer(1, samples.length, sampleRate);
    thunderBuffer.getChannelData(0).set(samples);
    setThunderWaveform(samples);

    playbackOffset = 0;
    setPlayerDisabled(false);
    setPlayerPlaying(false);
    setPlaybackPosition(0);
    generateThunderButton.disabled = false;
    setThunderStatus(
      `Ready: ${duration.toFixed(2)} s, peak ${(peak * 100).toFixed(0)}%, thunder ~${soundStart.toFixed(1)} s in (${generateMs.toFixed(0)} ms, ${renderSegmentCount} → ${acousticSegmentCount} acoustic segments)`,
    );
  });

  function seekFromClientX(clientX) {
    if (!thunderBuffer) return;
    const rect = thunderTrackEl.getBoundingClientRect();
    const ratio = Math.min(
      1,
      Math.max(0, (clientX - rect.left) / rect.width),
    );
    playbackOffset = ratio * thunderBuffer.duration;
    setPlaybackPosition(playbackOffset);
    if (isThunderPlaying) {
      startThunderPlayback(playbackOffset);
    }
  }

  function startThunderPlayback(offset = playbackOffset) {
    if (!thunderBuffer) return;

    stopThunderSource();
    playbackOffset = Math.min(
      Math.max(0, offset),
      thunderBuffer.duration,
    );

    thunderSource = audioContext.createBufferSource();
    thunderSource.buffer = thunderBuffer;
    thunderSource.connect(audioContext.destination);
    playbackStartedAt = audioContext.currentTime;
    thunderSource.onended = () => {
      thunderSource = null;
      playbackOffset = 0;
      setPlayerPlaying(false);
      setPlaybackPosition(0);
      if (thunderBuffer) {
        setThunderStatus(
          `Ready: ${thunderBuffer.duration.toFixed(2)} s`,
        );
      }
    };
    thunderSource.start(0, playbackOffset);
    setPlayerPlaying(true);
    setPlaybackPosition(playbackOffset);
    setThunderStatus("Playing…");
    tickPlayback();
  }

  thunderPlayButton.addEventListener("click", async () => {
    if (!thunderBuffer) return;

    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    if (isThunderPlaying) {
      pauseThunder();
      setThunderStatus(
        `Paused at ${formatPlaybackTime(playbackOffset)} / ${formatPlaybackTime(thunderBuffer.duration)}`,
      );
      return;
    }

    startThunderPlayback(playbackOffset);
  });

  thunderTrackEl.addEventListener("click", (event) => {
    if (!thunderBuffer || thunderPlayerEl.dataset.disabled === "true") {
      return;
    }
    seekFromClientX(event.clientX);
  });

  thunderTrackEl.addEventListener("keydown", (event) => {
    if (!thunderBuffer || thunderPlayerEl.dataset.disabled === "true") {
      return;
    }
    const step = 0.05 * (thunderBuffer.duration || 1);
    if (event.key === "ArrowRight") {
      event.preventDefault();
      playbackOffset = Math.min(
        thunderBuffer.duration,
        playbackOffset + step,
      );
      setPlaybackPosition(playbackOffset);
      if (isThunderPlaying) startThunderPlayback(playbackOffset);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      playbackOffset = Math.max(0, playbackOffset - step);
      setPlaybackPosition(playbackOffset);
      if (isThunderPlaying) startThunderPlayback(playbackOffset);
    } else if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      thunderPlayButton.click();
    }
  });

  const waveformResizeObserver = new ResizeObserver(() => {
    if (!waveformPeaks || !thunderBuffer) {
      drawThunderWaveform(0);
      return;
    }
    waveformPeaks = buildWaveformPeaks(
      thunderBuffer.getChannelData(0),
      waveformBucketCount(),
    );
    setPlaybackPosition(currentPlaybackSeconds());
  });
  waveformResizeObserver.observe(thunderTrackEl);

  setPlayerDisabled(true);
  resetThunderPlayer();

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
    listener.position.x = Math.min(
      GRID_HALF_EXTENT_M,
      Math.max(-GRID_HALF_EXTENT_M, x),
    );
    listener.position.z = Math.min(
      GRID_HALF_EXTENT_M,
      Math.max(-GRID_HALF_EXTENT_M, z),
    );
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
