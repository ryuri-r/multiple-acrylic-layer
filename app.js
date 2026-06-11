import * as THREE from "three";
import { OrbitControls } from "./vendor/OrbitControls.js";
import { GIFEncoder, applyPalette, quantize } from "./vendor/gifenc.esm.js";

const MAX_LAYERS = 20;
const DEFAULTS = {
  width: 90,
  height: 135,
  thickness: 3,
  gap: 6,
  explode: 0,
  acrylicOpacity: 0.35,
  background: "#eef0f2",
};

const state = {
  layers: [],
  sides: [],
  width: DEFAULTS.width,
  height: DEFAULTS.height,
  thickness: DEFAULTS.thickness,
  gap: DEFAULTS.gap,
  explode: DEFAULTS.explode,
  acrylicOpacity: DEFAULTS.acrylicOpacity,
  background: DEFAULTS.background,
  nextId: 1,
  draggedId: null,
};

const elements = {
  canvas: document.querySelector("#stageCanvas"),
  stageWrap: document.querySelector("#stageWrap"),
  stageEmpty: document.querySelector("#stageEmpty"),
  layerList: document.querySelector("#layerList"),
  layerTemplate: document.querySelector("#layerTemplate"),
  sideTemplate: document.querySelector("#sideTemplate"),
  sideList: document.querySelector("#sideList"),
  multiImageInput: document.querySelector("#multiImageInput"),
  addImagesButton: document.querySelector("#addImagesButton"),
  addLayerButton: document.querySelector("#addLayerButton"),
  addSideButton: document.querySelector("#addSideButton"),
  sideMenu: document.querySelector("#sideMenu"),
  layerCount: document.querySelector("#layerCount"),
  previewTitle: document.querySelector("#previewTitle"),
  visibleStatus: document.querySelector("#visibleStatus"),
  totalDepth: document.querySelector("#totalDepth"),
  exportButton: document.querySelector("#exportButton"),
  exportGifButton: document.querySelector("#exportGifButton"),
  gifMotionSelect: document.querySelector("#gifMotionSelect"),
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
  resetViewButton: document.querySelector("#resetViewButton"),
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

const sideRoot = new THREE.Group();
scene.add(sideRoot);

function createLayerData() {
  return {
    id: state.nextId++,
    visible: true,
    fileName: "",
    imageUrl: "",
    texture: null,
    scale: 1,
  };
}

function createSideData(type) {
  return {
    id: `side-${type}`,
    type,
    visible: true,
    fileName: "",
    imageUrl: "",
    texture: null,
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

function clearLayerRoot() {
  while (layerRoot.children.length) {
    const child = layerRoot.children.pop();
    disposeObject(child);
  }
}

function clearSideRoot() {
  while (sideRoot.children.length) {
    const child = sideRoot.children.pop();
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
  acrylic.renderOrder = index * 10;

  const edgeGeometry = new THREE.EdgesGeometry(geometry, 20);
  const edgeMaterial = new THREE.LineBasicMaterial({
    color: 0x59636d,
    transparent: true,
    opacity: 0.28 + state.acrylicOpacity * 0.35,
  });
  const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
  edges.renderOrder = index * 10 + 1;

  const group = new THREE.Group();
  group.add(acrylic, edges);
  group.visible = layer.visible;

  if (layer.texture) {
    const imageAspect = layer.texture.image.width / layer.texture.image.height;
    const plateAspect = state.width / state.height;
    let imageWidth = state.width;
    let imageHeight = state.height;

    if (imageAspect > plateAspect) {
      imageHeight = state.width / imageAspect;
    } else {
      imageWidth = state.height * imageAspect;
    }

    imageWidth *= layer.scale;
    imageHeight *= layer.scale;

    const artMaterial = new THREE.MeshBasicMaterial({
      map: layer.texture,
      transparent: true,
      alphaTest: 0.01,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false,
    });
    const art = new THREE.Mesh(new THREE.PlaneGeometry(imageWidth, imageHeight), artMaterial);
    art.position.z = state.thickness / 2 + 0.08;
    art.renderOrder = index * 10 + 4;
    group.add(art);
  }

  const centeredIndex = (state.layers.length - 1) / 2 - index;
  const spacing = state.thickness + state.gap + state.explode * 0.5;
  group.position.z = centeredIndex * spacing;
  return group;
}

function fitTextureSize(texture, maxWidth, maxHeight) {
  if (!texture) return [maxWidth, maxHeight];
  const aspect = texture.image.width / texture.image.height;
  const slotAspect = maxWidth / maxHeight;
  if (aspect > slotAspect) return [maxWidth, maxWidth / aspect];
  return [maxHeight * aspect, maxHeight];
}

function createSideObject(side) {
  const fullDepth = Math.max(
    state.thickness,
    state.layers.length * state.thickness
      + Math.max(0, state.layers.length - 1) * (state.gap + state.explode * 0.5),
  );
  const panelThickness = state.thickness;
  const group = new THREE.Group();
  const material = new THREE.MeshPhongMaterial({
    color: 0xf8fcff,
    transparent: true,
    opacity: state.acrylicOpacity,
    shininess: 100,
    specular: 0xffffff,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  let geometry;
  let artGeometry;
  let artPosition = new THREE.Vector3();
  let artRotation = new THREE.Euler();
  let artMaxWidth;
  let artMaxHeight;

  if (side.type === "left" || side.type === "right") {
    geometry = new THREE.BoxGeometry(panelThickness, state.height * 0.82, fullDepth);
    group.position.x = (side.type === "left" ? -1 : 1) * (state.width / 2 + panelThickness / 2);
    artMaxWidth = fullDepth;
    artMaxHeight = state.height * 0.82;
    const [artWidth, artHeight] = fitTextureSize(side.texture, artMaxWidth, artMaxHeight);
    artGeometry = new THREE.PlaneGeometry(artWidth, artHeight);
    artPosition.x = (side.type === "left" ? -1 : 1) * (panelThickness / 2 + 0.06);
    artRotation.y = side.type === "left" ? -Math.PI / 2 : Math.PI / 2;
  } else {
    geometry = new THREE.BoxGeometry(state.width * 0.82, panelThickness, fullDepth);
    group.position.y = (side.type === "bottom" ? -1 : 1) * (state.height / 2 + panelThickness / 2);
    artMaxWidth = state.width * 0.82;
    artMaxHeight = fullDepth;
    const [artWidth, artHeight] = fitTextureSize(side.texture, artMaxWidth, artMaxHeight);
    artGeometry = new THREE.PlaneGeometry(artWidth, artHeight);
    artPosition.y = (side.type === "bottom" ? -1 : 1) * (panelThickness / 2 + 0.06);
    artRotation.x = side.type === "bottom" ? Math.PI / 2 : -Math.PI / 2;
  }

  const panel = new THREE.Mesh(geometry, material);
  panel.castShadow = true;
  panel.receiveShadow = true;
  group.add(panel);

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({ color: 0x59636d, transparent: true, opacity: 0.34 }),
  );
  group.add(edges);

  if (side.texture) {
    const art = new THREE.Mesh(
      artGeometry,
      new THREE.MeshBasicMaterial({
        map: side.texture,
        transparent: true,
        alphaTest: 0.01,
        side: THREE.DoubleSide,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    art.position.copy(artPosition);
    art.rotation.copy(artRotation);
    art.renderOrder = 500;
    group.add(art);
  }

  group.visible = side.visible;
  return group;
}

function rebuildScene() {
  clearLayerRoot();
  clearSideRoot();
  state.layers.forEach((layer, index) => layerRoot.add(createAcrylicObject(layer, index)));
  state.sides.forEach((side) => sideRoot.add(createSideObject(side)));
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

    uploadButton.addEventListener("click", () => fileInput.click());
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

function renderSideList() {
  const labels = {
    left: "왼쪽 옆면",
    right: "오른쪽 옆면",
    top: "위쪽 옆면",
    bottom: "아래쪽 옆면",
  };
  elements.sideList.innerHTML = "";

  state.sides.forEach((side) => {
    const fragment = elements.sideTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".side-card");
    const fileInput = fragment.querySelector(".side-file-input");
    const uploadButton = fragment.querySelector(".side-upload-button");
    const preview = fragment.querySelector(".side-upload-preview");
    const visibilityInput = fragment.querySelector(".side-visibility-input");

    card.dataset.side = side.type;
    fragment.querySelector(".side-title").textContent = labels[side.type];
    fragment.querySelector(".side-file").textContent = side.fileName || "이미지 없음";
    visibilityInput.checked = side.visible;

    if (side.imageUrl) {
      preview.style.backgroundImage = `url("${side.imageUrl}")`;
      uploadButton.querySelector("b").textContent = "옆면 이미지 교체";
    }

    uploadButton.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      const [file] = fileInput.files;
      if (file) loadImageForSide(side.type, file);
    });
    visibilityInput.addEventListener("change", () => {
      side.visible = visibilityInput.checked;
      rebuildScene();
    });
    fragment.querySelector(".side-remove-button").addEventListener("click", () => removeSide(side.type));
    elements.sideList.append(fragment);
  });

  document.querySelectorAll("[data-add-side]").forEach((button) => {
    button.disabled = state.sides.some((side) => side.type === button.dataset.addSide);
  });
  elements.addSideButton.disabled = state.sides.length === 4;
}

function loadImageForLayer(id, file) {
  if (!file.type.startsWith("image/")) return;
  const layer = state.layers.find((item) => item.id === id);
  if (!layer) return;

  if (layer.imageUrl) URL.revokeObjectURL(layer.imageUrl);
  layer.imageUrl = URL.createObjectURL(file);
  layer.fileName = file.name;

  const loader = new THREE.TextureLoader();
  loader.load(layer.imageUrl, (texture) => {
    if (layer.texture) layer.texture.dispose();
    texture.encoding = THREE.sRGBEncoding;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    layer.texture = texture;
    renderLayerList();
    rebuildScene();
  });
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
    loadImageForLayer(layer.id, file);
  });

  renderLayerList();
  rebuildScene();
}

function loadImageForSide(type, file) {
  if (!file.type.startsWith("image/")) return;
  const side = state.sides.find((item) => item.type === type);
  if (!side) return;
  if (side.imageUrl) URL.revokeObjectURL(side.imageUrl);
  side.imageUrl = URL.createObjectURL(file);
  side.fileName = file.name;

  new THREE.TextureLoader().load(side.imageUrl, (texture) => {
    if (side.texture) side.texture.dispose();
    texture.encoding = THREE.sRGBEncoding;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    side.texture = texture;
    renderSideList();
    rebuildScene();
  });
}

function addSide(type) {
  if (state.sides.some((side) => side.type === type)) return;
  state.sides.push(createSideData(type));
  elements.sideMenu.hidden = true;
  renderSideList();
  rebuildScene();
}

function removeSide(type) {
  const index = state.sides.findIndex((side) => side.type === type);
  if (index < 0) return;
  const [removed] = state.sides.splice(index, 1);
  if (removed.imageUrl) URL.revokeObjectURL(removed.imageUrl);
  if (removed.texture) removed.texture.dispose();
  renderSideList();
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
  rebuildScene();
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
  setCameraView("angle", false);
}

function updateSettingsFromInputs() {
  state.thickness = Number(elements.thicknessRange.value);
  state.gap = Number(elements.gapRange.value);
  state.explode = Number(elements.explodeRange.value);
  state.acrylicOpacity = Number(elements.acrylicRange.value) / 100;
  state.background = elements.backgroundColor.value;

  elements.thicknessOutput.textContent = `${state.thickness} mm`;
  elements.gapOutput.textContent = `${state.gap} mm`;
  elements.explodeOutput.textContent = `${state.explode}%`;
  elements.acrylicOutput.textContent = `${Math.round(state.acrylicOpacity * 100)}%`;
  elements.backgroundValue.textContent = state.background.toUpperCase();

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
  state.sides.forEach((side) => {
    if (side.imageUrl) URL.revokeObjectURL(side.imageUrl);
    if (side.texture) side.texture.dispose();
  });
  state.sides = [];
  Object.assign(state, {
    width: DEFAULTS.width,
    height: DEFAULTS.height,
    thickness: DEFAULTS.thickness,
    gap: DEFAULTS.gap,
    explode: DEFAULTS.explode,
    acrylicOpacity: DEFAULTS.acrylicOpacity,
    background: DEFAULTS.background,
  });
  elements.presetSelect.value = "90x135";
  elements.widthInput.value = String(DEFAULTS.width);
  elements.heightInput.value = String(DEFAULTS.height);
  elements.thicknessRange.value = String(DEFAULTS.thickness);
  elements.gapRange.value = String(DEFAULTS.gap);
  elements.explodeRange.value = String(DEFAULTS.explode);
  elements.acrylicRange.value = String(DEFAULTS.acrylicOpacity * 100);
  elements.backgroundColor.value = DEFAULTS.background;
  renderLayerList();
  renderSideList();
  updateSettingsFromInputs();
  setCameraView("angle");
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
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

async function exportGif() {
  const button = elements.exportGifButton;
  const originalText = button.textContent;
  const originalPosition = camera.position.clone();
  const originalTarget = controls.target.clone();
  const originalSize = new THREE.Vector2();
  renderer.getSize(originalSize);
  const originalPixelRatio = renderer.getPixelRatio();
  const motion = elements.gifMotionSelect.value;
  const frameCount = motion === "spin" ? 48 : 36;
  const outputSize = 540;
  const radius = camera.position.distanceTo(controls.target);
  const verticalAngle = Math.asin((camera.position.y - controls.target.y) / radius);
  const horizontalRadius = Math.cos(verticalAngle) * radius;
  const centerAngle = Math.atan2(
    camera.position.x - controls.target.x,
    camera.position.z - controls.target.z,
  );

  button.disabled = true;
  elements.exportButton.disabled = true;
  controls.enabled = false;
  renderer.setPixelRatio(1);
  renderer.setSize(outputSize, outputSize, false);
  camera.aspect = 1;
  camera.updateProjectionMatrix();

  const gif = GIFEncoder();
  const captureCanvas = document.createElement("canvas");
  captureCanvas.width = outputSize;
  captureCanvas.height = outputSize;
  const captureContext = captureCanvas.getContext("2d", { willReadFrequently: true });

  try {
    for (let index = 0; index < frameCount; index += 1) {
      const progress = index / frameCount;
      let angle;
      if (motion === "spin") {
        angle = centerAngle + progress * Math.PI * 2;
      } else {
        const swing = Math.sin(progress * Math.PI * 2);
        angle = centerAngle + THREE.MathUtils.degToRad(35) * swing;
      }

      camera.position.set(
        controls.target.x + Math.sin(angle) * horizontalRadius,
        controls.target.y + Math.sin(verticalAngle) * radius,
        controls.target.z + Math.cos(angle) * horizontalRadius,
      );
      camera.lookAt(controls.target);
      renderer.render(scene, camera);
      await nextFrame();

      captureContext.clearRect(0, 0, outputSize, outputSize);
      captureContext.drawImage(renderer.domElement, 0, 0, outputSize, outputSize);
      const imageData = captureContext.getImageData(0, 0, outputSize, outputSize);
      const palette = quantize(imageData.data, 256, { format: "rgb565" });
      const indexed = applyPalette(imageData.data, palette, "rgb565");
      gif.writeFrame(indexed, outputSize, outputSize, {
        palette,
        delay: motion === "spin" ? 70 : 80,
        repeat: 0,
      });
      button.textContent = `GIF ${index + 1}/${frameCount}`;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    gif.finish();
    downloadBlob(
      new Blob([gif.bytes()], { type: "image/gif" }),
      `acrylic-layer-${motion}-${new Date().toISOString().slice(0, 10)}.gif`,
    );
  } finally {
    camera.position.copy(originalPosition);
    controls.target.copy(originalTarget);
    controls.enabled = true;
    renderer.setPixelRatio(originalPixelRatio);
    renderer.setSize(originalSize.x, originalSize.y, false);
    camera.aspect = originalSize.x / originalSize.y;
    camera.updateProjectionMatrix();
    controls.update();
    button.disabled = false;
    elements.exportButton.disabled = false;
    button.textContent = originalText;
  }
}

function resizeRenderer() {
  const width = elements.stageWrap.clientWidth;
  const height = elements.stageWrap.clientHeight;
  if (!width || !height) return;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

elements.addLayerButton.addEventListener("click", addLayer);
elements.addImagesButton.addEventListener("click", () => elements.multiImageInput.click());
elements.stageEmpty.addEventListener("click", () => elements.multiImageInput.click());
elements.multiImageInput.addEventListener("change", () => {
  addImageFiles(elements.multiImageInput.files);
  elements.multiImageInput.value = "";
});
elements.addSideButton.addEventListener("click", () => {
  elements.sideMenu.hidden = !elements.sideMenu.hidden;
});
document.querySelectorAll("[data-add-side]").forEach((button) => {
  button.addEventListener("click", () => addSide(button.dataset.addSide));
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".side-builder")) elements.sideMenu.hidden = true;
});
elements.exportButton.addEventListener("click", exportImage);
elements.exportGifButton.addEventListener("click", exportGif);
elements.resetViewButton.addEventListener("click", () => setCameraView("angle"));
elements.resetProjectButton.addEventListener("click", resetProject);

elements.viewButtons.forEach((button) => {
  button.addEventListener("click", () => setCameraView(button.dataset.view));
});

elements.presetSelect.addEventListener("change", () => {
  const presets = {
    "90x135": [90, 135],
    "135x90": [135, 90],
    "100x100": [100, 100],
  };
  if (presets[elements.presetSelect.value]) {
    setDimensions(...presets[elements.presetSelect.value]);
  }
});

[elements.widthInput, elements.heightInput].forEach((input) => {
  input.addEventListener("change", () => {
    elements.presetSelect.value = "custom";
    setDimensions(elements.widthInput.value, elements.heightInput.value);
  });
});

[
  elements.thicknessRange,
  elements.gapRange,
  elements.explodeRange,
  elements.acrylicRange,
  elements.backgroundColor,
].forEach((input) => input.addEventListener("input", updateSettingsFromInputs));

window.addEventListener("resize", resizeRenderer);

const resizeObserver = new ResizeObserver(resizeRenderer);
resizeObserver.observe(elements.stageWrap);

function animate() {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

state.layers.push(createLayerData());
renderLayerList();
renderSideList();
updateSettingsFromInputs();
resizeRenderer();
setCameraView("angle", false);
animate();
