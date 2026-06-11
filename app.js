import * as THREE from "three";
import { OrbitControls } from "./vendor/OrbitControls.js";
import { GIFEncoder, applyPalette, quantize } from "./vendor/gifenc.esm.js";

const MAX_LAYERS = 20;
const DEFAULTS = {
  width: 90,
  height: 135,
  thickness: 3,
  gap: 0,
  explode: 0,
  acrylicOpacity: 0.35,
  background: "#eef0f2",
  cutline: 2,
  longSide: 135,
  autoSize: true,
};

const state = {
  layers: [],
  width: DEFAULTS.width,
  height: DEFAULTS.height,
  thickness: DEFAULTS.thickness,
  gap: DEFAULTS.gap,
  explode: DEFAULTS.explode,
  acrylicOpacity: DEFAULTS.acrylicOpacity,
  background: DEFAULTS.background,
  cutline: DEFAULTS.cutline,
  longSide: DEFAULTS.longSide,
  autoSize: DEFAULTS.autoSize,
  sourceAspect: null,
  sourceCrop: null,
  autoSizeSourceId: null,
  paletteApplied: false,
  nextId: 1,
  draggedId: null,
};

const elements = {
  canvas: document.querySelector("#stageCanvas"),
  stageWrap: document.querySelector("#stageWrap"),
  stageEmpty: document.querySelector("#stageEmpty"),
  layerList: document.querySelector("#layerList"),
  layerTemplate: document.querySelector("#layerTemplate"),
  multiImageInput: document.querySelector("#multiImageInput"),
  addImagesButton: document.querySelector("#addImagesButton"),
  addLayerButton: document.querySelector("#addLayerButton"),
  layerCount: document.querySelector("#layerCount"),
  previewTitle: document.querySelector("#previewTitle"),
  visibleStatus: document.querySelector("#visibleStatus"),
  totalDepth: document.querySelector("#totalDepth"),
  exportButton: document.querySelector("#exportButton"),
  exportGifButton: document.querySelector("#exportGifButton"),
  gifMotionSelect: document.querySelector("#gifMotionSelect"),
  autoSizeToggle: document.querySelector("#autoSizeToggle"),
  longSideInput: document.querySelector("#longSideInput"),
  cutlineSelect: document.querySelector("#cutlineSelect"),
  manualSizeGroup: document.querySelector(".manual-size-group"),
  presetSelect: document.querySelector("#presetSelect"),
  widthInput: document.querySelector("#widthInput"),
  heightInput: document.querySelector("#heightInput"),
  thicknessRange: document.querySelector("#thicknessRange"),
  thicknessOutput: document.querySelector("#thicknessOutput"),
  gapRange: document.querySelector("#gapRange"),
  gapOutput: document.querySelector("#gapOutput"),
  explodeRange: document.querySelector("#explodeRange"),
  explodeOutput: document.querySelector("#explodeOutput"),
  acrylicRange: document.querySelector("#acrylicRange"),
  acrylicOutput: document.querySelector("#acrylicOutput"),
  backgroundColor: document.querySelector("#backgroundColor"),
  backgroundValue: document.querySelector("#backgroundValue"),
  resetProjectButton: document.querySelector("#resetProjectButton"),
  viewButtons: [...document.querySelectorAll("[data-view]")],
};

const scene = new THREE.Scene();
scene.background = new THREE.Color(state.background);

const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 3000);
camera.position.set(145, 95, 260);

const renderer = new THREE.WebGLRenderer({
  canvas: elements.canvas,
  antialias: true,
  alpha: false,
  preserveDrawingBuffer: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.minDistance = 100;
controls.maxDistance = 700;
controls.target.set(0, 0, 0);

scene.add(new THREE.HemisphereLight(0xffffff, 0x8f98a2, 1.25));

const keyLight = new THREE.DirectionalLight(0xffffff, 0.85);
keyLight.position.set(100, 160, 220);
keyLight.castShadow = true;
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xbfd8ff, 0.4);
fillLight.position.set(-180, 60, 80);
scene.add(fillLight);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(1000, 1000),
  new THREE.ShadowMaterial({ color: 0x3b4148, opacity: 0.12 }),
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -state.height * 0.63;
floor.receiveShadow = true;
scene.add(floor);

const layerRoot = new THREE.Group();
scene.add(layerRoot);

// ── 그림 드래그 이동 ──────────────────────────────────────────
const dragRaycaster = new THREE.Raycaster();
const dragPointer = new THREE.Vector2();
let dragSession = null;

function setRayFromEvent(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  dragPointer.set(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  );
  dragRaycaster.setFromCamera(dragPointer, camera);
}

function maskAlphaAt(layer, uv) {
  if (!layer.alphaMask || !uv) return 255;
  const { data, width, height } = layer.alphaMask;
  const x = Math.min(width - 1, Math.max(0, Math.floor(uv.x * width)));
  const y = Math.min(height - 1, Math.max(0, Math.floor((1 - uv.y) * height)));
  return data[y * width + x];
}

function rayPointAtZ(z) {
  const { origin, direction } = dragRaycaster.ray;
  if (Math.abs(direction.z) < 1e-6) return null;
  const t = (z - origin.z) / direction.z;
  if (t < 0) return null;
  return origin.clone().addScaledVector(direction, t);
}

renderer.domElement.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  setRayFromEvent(event);
  const hits = dragRaycaster.intersectObjects(artMeshes, false);
  // 투명 픽셀 위는 통과시키고, 실제 그림이 그려진 첫 레이어를 잡는다
  const hit = hits.find((item) => {
    const layer = state.layers.find((l) => l.id === item.object.userData.layerId);
    return layer && maskAlphaAt(layer, item.uv) > 16;
  });
  if (!hit) return;
  const layer = state.layers.find((l) => l.id === hit.object.userData.layerId);
  dragSession = {
    layer,
    mesh: hit.object,
    planeZ: hit.point.z,
    startPoint: hit.point.clone(),
    startOffsetX: layer.offsetX,
    startOffsetY: layer.offsetY,
    baseX: hit.object.position.x - layer.offsetX,
    baseY: hit.object.position.y - layer.offsetY,
  };
  controls.enabled = false;
  renderer.domElement.setPointerCapture(event.pointerId);
  renderer.domElement.style.cursor = "grabbing";
});

renderer.domElement.addEventListener("pointermove", (event) => {
  if (!dragSession) return;
  setRayFromEvent(event);
  const point = rayPointAtZ(dragSession.planeZ);
  if (!point) return;
  dragSession.layer.offsetX = dragSession.startOffsetX + point.x - dragSession.startPoint.x;
  dragSession.layer.offsetY = dragSession.startOffsetY + point.y - dragSession.startPoint.y;
  dragSession.mesh.position.x = dragSession.baseX + dragSession.layer.offsetX;
  dragSession.mesh.position.y = dragSession.baseY + dragSession.layer.offsetY;
});

function endDrag() {
  if (!dragSession) return;
  dragSession = null;
  controls.enabled = true;
  renderer.domElement.style.cursor = "";
}
renderer.domElement.addEventListener("pointerup", endDrag);
renderer.domElement.addEventListener("pointercancel", endDrag);

// 더블클릭으로 해당 레이어 위치 초기화
renderer.domElement.addEventListener("dblclick", (event) => {
  setRayFromEvent(event);
  const hits = dragRaycaster.intersectObjects(artMeshes, false);
  const hit = hits.find((item) => {
    const layer = state.layers.find((l) => l.id === item.object.userData.layerId);
    return layer && maskAlphaAt(layer, item.uv) > 16;
  });
  if (!hit) return;
  const layer = state.layers.find((l) => l.id === hit.object.userData.layerId);
  layer.offsetX = 0;
  layer.offsetY = 0;
  rebuildScene();
});

function createLayerData() {
  return {
    id: state.nextId++,
    visible: true,
    fileName: "",
    imageUrl: "",
    texture: null,
    contentAspect: null,
    canvasAspect: null,
    crop: null,
    alphaMask: null,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  };
}

function roundedRectShape(width, height, radius) {
  const x = -width / 2;
  const y = -height / 2;
  const shape = new THREE.Shape();
  shape.moveTo(x + radius, y);
  shape.lineTo(x + width - radius, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + radius);
  shape.lineTo(x + width, y + height - radius);
  shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  shape.lineTo(x + radius, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - radius);
  shape.lineTo(x, y + radius);
  shape.quadraticCurveTo(x, y, x + radius, y);
  return shape;
}

function disposeObject(object) {
  object.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => material.dispose());
    }
  });
}

const artMeshes = [];

function clearLayerRoot() {
  artMeshes.length = 0;
  while (layerRoot.children.length) {
    const child = layerRoot.children.pop();
    disposeObject(child);
  }
}

function createAcrylicObject(layer, index) {
  const shape = roundedRectShape(state.width, state.height, Math.min(5, state.width * 0.05));
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: state.thickness,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: Math.min(0.55, state.thickness * 0.18),
    bevelThickness: Math.min(0.55, state.thickness * 0.18),
    curveSegments: 18,
  });
  geometry.translate(0, 0, -state.thickness / 2);

  const material = new THREE.MeshPhongMaterial({
    color: 0xf8fcff,
    transparent: true,
    opacity: state.acrylicOpacity,
    shininess: 100,
    specular: 0xffffff,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const acrylic = new THREE.Mesh(geometry, material);
  acrylic.castShadow = true;
  acrylic.receiveShadow = true;

  const edgeGeometry = new THREE.EdgesGeometry(geometry, 20);
  const edgeMaterial = new THREE.LineBasicMaterial({
    color: 0x59636d,
    transparent: true,
    opacity: 0.28 + state.acrylicOpacity * 0.35,
  });
  const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);

  const group = new THREE.Group();
  group.add(acrylic, edges);
  group.visible = layer.visible;

  if (layer.texture) {
    const printableWidth = Math.max(1, state.width - state.cutline * 2);
    const printableHeight = Math.max(1, state.height - state.cutline * 2);
    let imageWidth;
    let imageHeight;
    let offsetX = 0;
    let offsetY = 0;

    if (state.sourceCrop) {
      // 공유 캔버스 좌표계: 기준(1번) 레이어의 그림 영역이 인쇄 영역에 맞도록
      // 전체 캔버스를 환산하고, 모든 레이어를 같은 캔버스 크기/위치로 배치한다.
      const crop = state.sourceCrop;
      // 업로드 타이밍에 따라 텍스처에 crop이 남아있을 수 있으므로 항상 초기화
      layer.texture.offset.set(0, 0);
      layer.texture.repeat.set(1, 1);
      imageWidth = printableWidth / crop.width;
      imageHeight = printableHeight / crop.height;
      offsetX = -(crop.x + crop.width / 2 - 0.5) * imageWidth;
      offsetY = -(crop.y + crop.height / 2 - 0.5) * imageHeight;
    } else {
      const imageAspect = layer.contentAspect || layer.texture.image.width / layer.texture.image.height;
      const plateAspect = printableWidth / printableHeight;
      imageWidth = printableWidth;
      imageHeight = printableHeight;
      if (imageAspect > plateAspect) {
        imageHeight = printableWidth / imageAspect;
      } else {
        imageWidth = printableHeight * imageAspect;
      }
    }

    imageWidth *= layer.scale;
    imageHeight *= layer.scale;

    const artMaterial = new THREE.MeshBasicMaterial({
      map: layer.texture,
      transparent: true,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
      depthWrite: true,
      toneMapped: false,
    });
    const art = new THREE.Mesh(new THREE.PlaneGeometry(imageWidth, imageHeight), artMaterial);
    art.position.x = offsetX + layer.offsetX;
    art.position.y = offsetY + layer.offsetY;
    art.position.z = state.thickness / 2 + 0.08;
    art.userData.layerId = layer.id;
    artMeshes.push(art);
    group.add(art);
  }

  const centeredIndex = (state.layers.length - 1) / 2 - index;
  const spacing = state.thickness + state.gap + state.explode * 0.5;
  group.position.z = centeredIndex * spacing;
  return group;
}

function rebuildScene() {
  clearLayerRoot();
  state.layers.forEach((layer, index) => layerRoot.add(createAcrylicObject(layer, index)));
  floor.position.y = -state.height * 0.63;
  updateStatus();
}

function renderLayerList() {
  elements.layerList.innerHTML = "";

  state.layers.forEach((layer, index) => {
    const fragment = elements.layerTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".layer-card");
    const fileInput = fragment.querySelector(".file-input");
    const uploadButton = fragment.querySelector(".upload-button");
    const preview = fragment.querySelector(".upload-preview");
    const visibilityInput = fragment.querySelector(".visibility-input");
    const scaleInput = fragment.querySelector(".scale-input");
    const removeButton = fragment.querySelector(".remove-button");
    const fitButton = fragment.querySelector(".fit-button");

    card.dataset.id = String(layer.id);
    fragment.querySelector(".layer-number").textContent = String(index + 1).padStart(2, "0");
    fragment.querySelector(".layer-title").textContent = `${index + 1}면`;
    fragment.querySelector(".layer-file").textContent = layer.fileName || "이미지 없음";
    visibilityInput.checked = layer.visible;
    scaleInput.value = String(Math.round(layer.scale * 100));

    if (layer.imageUrl) {
      card.classList.add("has-image");
      preview.classList.add("has-image");
      preview.style.backgroundImage = `url("${layer.imageUrl}")`;
      uploadButton.querySelector("b").textContent = "이미지 교체";
    }

    fileInput.addEventListener("change", () => {
      const [file] = fileInput.files;
      if (file) loadImageForLayer(layer.id, file);
    });

    visibilityInput.addEventListener("change", () => {
      layer.visible = visibilityInput.checked;
      rebuildScene();
    });

    scaleInput.addEventListener("input", () => {
      layer.scale = Number(scaleInput.value) / 100;
      rebuildScene();
    });

    fitButton.addEventListener("click", () => {
      layer.scale = 1;
      renderLayerList();
      rebuildScene();
    });

    removeButton.addEventListener("click", () => removeLayer(layer.id));

    card.addEventListener("dragstart", () => {
      state.draggedId = layer.id;
      card.classList.add("is-dragging");
    });
    card.addEventListener("dragend", () => {
      state.draggedId = null;
      card.classList.remove("is-dragging");
      document.querySelectorAll(".drag-over").forEach((item) => item.classList.remove("drag-over"));
    });
    card.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (state.draggedId !== layer.id) card.classList.add("drag-over");
    });
    card.addEventListener("dragleave", () => card.classList.remove("drag-over"));
    card.addEventListener("drop", (event) => {
      event.preventDefault();
      card.classList.remove("drag-over");
      if (event.dataTransfer.files.length) {
        loadImageForLayer(layer.id, event.dataTransfer.files[0]);
        return;
      }
      reorderLayer(state.draggedId, layer.id);
    });

    card.addEventListener("dragenter", (event) => {
      if (event.dataTransfer?.types?.includes("Files")) card.classList.add("file-over");
    });
    card.addEventListener("dragleave", (event) => {
      if (!card.contains(event.relatedTarget)) card.classList.remove("file-over");
    });

    elements.layerList.append(fragment);
  });

  elements.addLayerButton.disabled = state.layers.length >= MAX_LAYERS;
}

function loadImageForLayer(id, file) {
  if (!file.type.startsWith("image/")) return;
  const layer = state.layers.find((item) => item.id === id);
  if (!layer) return;

  if (layer.imageUrl) URL.revokeObjectURL(layer.imageUrl);
  layer.imageUrl = URL.createObjectURL(file);
  layer.fileName = file.name;

  if (!state.sourceAspect && !state.autoSizeSourceId) state.autoSizeSourceId = layer.id;

  analyzeImageFile(file)
    .then((analysis) => {
      layer.contentAspect = analysis.aspect;
      layer.canvasAspect = analysis.canvasAspect;
      layer.crop = analysis.crop;
      layer.alphaMask = analysis.mask;
      recomputeAutoSize();
      if (!state.paletteApplied && analysis.color && state.autoSizeSourceId === layer.id) {
        state.paletteApplied = true;
        applyPastelBackground(analysis.color);
      }
    })
    .catch(() => {
      layer.contentAspect = null;
      layer.crop = null;
    })
    .finally(() => {
    const loader = new THREE.TextureLoader();
    loader.load(layer.imageUrl, (texture) => {
      if (layer.texture) layer.texture.dispose();
      texture.encoding = THREE.sRGBEncoding;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      if (layer.crop && !state.sourceCrop) {
        texture.offset.set(layer.crop.x, layer.crop.y);
        texture.repeat.set(layer.crop.width, layer.crop.height);
      } else {
        texture.offset.set(0, 0);
        texture.repeat.set(1, 1);
      }
      texture.needsUpdate = true;
      layer.texture = texture;
      renderLayerList();
      rebuildScene();
    });
    });
}

async function analyzeImageFile(file) {
  let source;
  let fallbackUrl;
  if (typeof createImageBitmap === "function") {
    source = await createImageBitmap(file);
  } else {
    fallbackUrl = URL.createObjectURL(file);
    source = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = fallbackUrl;
    });
  }
  const maxSample = 320;
  const ratio = Math.min(1, maxSample / Math.max(source.width, source.height));
  const width = Math.max(1, Math.round(source.width * ratio));
  const height = Math.max(1, Math.round(source.height * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(source, 0, 0, width, height);
  source.close?.();
  if (fallbackUrl) URL.revokeObjectURL(fallbackUrl);

  const pixels = context.getImageData(0, 0, width, height).data;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let red = 0;
  let green = 0;
  let blue = 0;
  let colorCount = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const alpha = pixels[index + 3];
      if (alpha <= 16) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      if (alpha > 96) {
        const r = pixels[index];
        const g = pixels[index + 1];
        const b = pixels[index + 2];
        const brightness = (r + g + b) / 3;
        if (brightness > 28 && brightness < 242) {
          red += r;
          green += g;
          blue += b;
          colorCount += 1;
        }
      }
    }
  }

  const contentWidth = maxX >= minX ? maxX - minX + 1 : width;
  const contentHeight = maxY >= minY ? maxY - minY + 1 : height;
  const hasTransparentBounds = maxX >= minX && maxY >= minY;
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i += 1) mask[i] = pixels[i * 4 + 3];

  return {
    aspect: contentWidth / contentHeight,
    canvasAspect: width / height,
    mask: { data: mask, width, height },
    crop: hasTransparentBounds
      ? {
          x: minX / width,
          y: 1 - (maxY + 1) / height,
          width: contentWidth / width,
          height: contentHeight / height,
        }
      : null,
    color: colorCount
      ? [Math.round(red / colorCount), Math.round(green / colorCount), Math.round(blue / colorCount)]
      : null,
  };
}

function applyPastelBackground([red, green, blue]) {
  const mix = 0.82;
  const pastel = [
    Math.round(red * (1 - mix) + 255 * mix),
    Math.round(green * (1 - mix) + 255 * mix),
    Math.round(blue * (1 - mix) + 255 * mix),
  ];
  const hex = `#${pastel.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
  state.background = hex;
  elements.backgroundColor.value = hex;
  scene.background.set(hex);
  elements.stageWrap.style.backgroundColor = hex;
}

function recomputeAutoSize() {
  // 이미지가 있는 모든 레이어의 그림 영역(투명 제외)을 합친 박스 기준으로 판 크기 산출
  const layersWithImage = state.layers.filter((item) => item.imageUrl || item.texture);
  if (!layersWithImage.length) {
    state.sourceCrop = null;
    state.sourceAspect = null;
    rebuildScene();
    return;
  }
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  layersWithImage.forEach((item) => {
    const crop = item.crop || { x: 0, y: 0, width: 1, height: 1 };
    minX = Math.min(minX, crop.x);
    minY = Math.min(minY, crop.y);
    maxX = Math.max(maxX, crop.x + crop.width);
    maxY = Math.max(maxY, crop.y + crop.height);
  });
  const union = {
    x: minX,
    y: minY,
    width: Math.max(0.001, maxX - minX),
    height: Math.max(0.001, maxY - minY),
  };
  const canvasAspect = layersWithImage.find((item) => item.canvasAspect)?.canvasAspect || 1;
  const aspect = (union.width / union.height) * canvasAspect;
  const changed =
    !state.sourceCrop ||
    Math.abs(aspect - state.sourceAspect) > 0.0001 ||
    Math.abs(union.x - state.sourceCrop.x) > 0.0001 ||
    Math.abs(union.y - state.sourceCrop.y) > 0.0001 ||
    Math.abs(union.width - state.sourceCrop.width) > 0.0001 ||
    Math.abs(union.height - state.sourceCrop.height) > 0.0001;
  state.sourceCrop = union;
  state.sourceAspect = aspect;
  if (changed && state.autoSize) {
    applyAutomaticDimensions();
  } else {
    rebuildScene();
  }
}

function applyAutomaticDimensions() {
  if (!state.sourceAspect) return;
  const longSide = Math.max(20, Math.min(300, Number(state.longSide) || DEFAULTS.longSide));
  let contentWidth;
  let contentHeight;
  if (state.sourceAspect >= 1) {
    contentWidth = longSide;
    contentHeight = longSide / state.sourceAspect;
  } else {
    contentHeight = longSide;
    contentWidth = longSide * state.sourceAspect;
  }
  state.width = Number((contentWidth + state.cutline * 2).toFixed(1));
  state.height = Number((contentHeight + state.cutline * 2).toFixed(1));
  elements.widthInput.value = String(state.width);
  elements.heightInput.value = String(state.height);
  elements.presetSelect.value = "custom";
  rebuildScene();
  setCameraView("front", false);
}

function addImageFiles(files) {
  const imageFiles = [...files].filter((file) => file.type.startsWith("image/"));
  if (!imageFiles.length) return;

  const availableLayers = state.layers.filter((layer) => !layer.imageUrl && !layer.texture);
  imageFiles.forEach((file, index) => {
    let layer = availableLayers[index];
    if (!layer) {
      if (state.layers.length >= MAX_LAYERS) return;
      layer = createLayerData();
      state.layers.push(layer);
    }
    if (!state.sourceAspect && !state.autoSizeSourceId) state.autoSizeSourceId = layer.id;
    loadImageForLayer(layer.id, file);
  });

  renderLayerList();
  rebuildScene();
}

function addLayer() {
  if (state.layers.length >= MAX_LAYERS) return;
  state.layers.push(createLayerData());
  renderLayerList();
  rebuildScene();
  requestAnimationFrame(() => {
    const lastCard = elements.layerList.lastElementChild;
    lastCard?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
}

function removeLayer(id) {
  if (state.layers.length === 1) {
    const layer = state.layers[0];
    if (layer.imageUrl) URL.revokeObjectURL(layer.imageUrl);
    if (layer.texture) layer.texture.dispose();
    state.layers[0] = createLayerData();
  } else {
    const index = state.layers.findIndex((item) => item.id === id);
    const [removed] = state.layers.splice(index, 1);
    if (removed?.imageUrl) URL.revokeObjectURL(removed.imageUrl);
    if (removed?.texture) removed.texture.dispose();
  }
  renderLayerList();
  recomputeAutoSize();
}

function reorderLayer(sourceId, targetId) {
  if (!sourceId || sourceId === targetId) return;
  const sourceIndex = state.layers.findIndex((item) => item.id === sourceId);
  const targetIndex = state.layers.findIndex((item) => item.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) return;
  const [moved] = state.layers.splice(sourceIndex, 1);
  state.layers.splice(targetIndex, 0, moved);
  renderLayerList();
  rebuildScene();
}

function updateStatus() {
  const visibleLayers = state.layers.filter((layer) => layer.visible).length;
  const totalDepth = state.layers.length * state.thickness
    + Math.max(0, state.layers.length - 1) * state.gap;
  const hasImages = state.layers.some((layer) => layer.texture);

  elements.layerCount.textContent = `${state.layers.length}면`;
  elements.previewTitle.textContent = `${state.layers.length} LAYER COMPOSITION`;
  elements.visibleStatus.textContent = String(visibleLayers);
  elements.totalDepth.textContent = String(Number(totalDepth.toFixed(1)));
  elements.stageEmpty.classList.toggle("is-hidden", hasImages);
}

function setDimensions(width, height) {
  state.width = Math.max(30, Math.min(300, Number(width) || DEFAULTS.width));
  state.height = Math.max(30, Math.min(300, Number(height) || DEFAULTS.height));
  elements.widthInput.value = String(state.width);
  elements.heightInput.value = String(state.height);
  rebuildScene();
  setCameraView("front", false);
}

function updateSettingsFromInputs() {
  state.thickness = Number(elements.thicknessRange.value);
  state.gap = Number(elements.gapRange.value);
  state.explode = Number(elements.explodeRange.value);
  state.acrylicOpacity = Number(elements.acrylicRange.value) / 100;
  state.background = elements.backgroundColor.value || state.background;

  elements.thicknessOutput.textContent = `${state.thickness} mm`;
  elements.gapOutput.textContent = `${state.gap} mm`;
  elements.explodeOutput.textContent = `${state.explode}%`;
  elements.acrylicOutput.textContent = `${Math.round(state.acrylicOpacity * 100)}%`;
  if (elements.backgroundValue) elements.backgroundValue.textContent = state.background.toUpperCase();

  scene.background.set(state.background);
  elements.stageWrap.style.backgroundColor = state.background;
  rebuildScene();
}

function setCameraView(view, animate = true) {
  const largest = Math.max(state.width, state.height);
  const depth = state.layers.length * (state.thickness + state.gap + state.explode * 0.5);
  const distance = Math.max(largest * 2.15, 220) + depth * 0.4;
  const positions = {
    front: new THREE.Vector3(0, 0, distance),
    angle: new THREE.Vector3(distance * 0.58, distance * 0.34, distance * 0.88),
    side: new THREE.Vector3(distance, 0, 2),
  };
  const target = positions[view] || positions.angle;

  elements.viewButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === view);
  });

  if (!animate) {
    camera.position.copy(target);
    controls.target.set(0, 0, 0);
    controls.update();
    return;
  }

  const start = camera.position.clone();
  const startedAt = performance.now();
  const duration = 380;
  const step = (now) => {
    const progress = Math.min(1, (now - startedAt) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    camera.position.lerpVectors(start, target, eased);
    controls.update();
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function resetProject() {
  state.layers.forEach((layer) => {
    if (layer.imageUrl) URL.revokeObjectURL(layer.imageUrl);
    if (layer.texture) layer.texture.dispose();
  });
  state.layers = [createLayerData()];
  Object.assign(state, {
    width: DEFAULTS.width,
    height: DEFAULTS.height,
    thickness: DEFAULTS.thickness,
    gap: DEFAULTS.gap,
    explode: DEFAULTS.explode,
    acrylicOpacity: DEFAULTS.acrylicOpacity,
    background: DEFAULTS.background,
    cutline: DEFAULTS.cutline,
    longSide: DEFAULTS.longSide,
    autoSize: DEFAULTS.autoSize,
    sourceAspect: null,
    sourceCrop: null,
    autoSizeSourceId: null,
    paletteApplied: false,
  });
  elements.presetSelect.value = "90x135";
  elements.widthInput.value = String(DEFAULTS.width);
  elements.heightInput.value = String(DEFAULTS.height);
  elements.thicknessRange.value = String(DEFAULTS.thickness);
  elements.gapRange.value = String(DEFAULTS.gap);
  elements.explodeRange.value = String(DEFAULTS.explode);
  elements.acrylicRange.value = String(DEFAULTS.acrylicOpacity * 100);
  elements.backgroundColor.value = DEFAULTS.background;
  elements.autoSizeToggle.checked = DEFAULTS.autoSize;
  elements.longSideInput.value = String(DEFAULTS.longSide);
  elements.cutlineSelect.value = String(DEFAULTS.cutline);
  updateAutoSizeControls();
  renderLayerList();
  updateSettingsFromInputs();
  setCameraView("front");
}

function exportImage() {
  renderer.render(scene, camera);
  const link = document.createElement("a");
  link.download = `acrylic-layer-${new Date().toISOString().slice(0, 10)}.png`;
  link.href = renderer.domElement.toDataURL("image/png");
  link.click();
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.download = fileName;
  link.href = url;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function nextFrame() {
  return new Prom