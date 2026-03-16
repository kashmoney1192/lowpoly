// ============================================================
// Low Poly Art Generator — v3
// Edge detection + brush paint + circle zones + Delaunay
// ============================================================

(() => {
  // --- DOM refs ---
  const fileInput = document.getElementById("fileInput");
  const uploadArea = document.getElementById("uploadArea");
  const sourceCanvas = document.getElementById("sourceCanvas");
  const outputCanvas = document.getElementById("outputCanvas");
  const previewCanvas = document.getElementById("previewCanvas");
  const placeholder = document.getElementById("placeholder");
  const canvasContainer = document.getElementById("canvasContainer");
  const generateBtn = document.getElementById("generateBtn");
  const downloadBtn = document.getElementById("downloadBtn");
  const downloadSvgBtn = document.getElementById("downloadSvgBtn");
  const downloadStlBtn = document.getElementById("downloadStlBtn");
  const downloadAmsBtn = document.getElementById("downloadAmsBtn");
  const amsOptions = document.getElementById("amsOptions");
  const amsSlotsSelect = document.getElementById("amsSlots");
  const amsDepthSelect = document.getElementById("amsDepth");
  const amsDownloadBtn = document.getElementById("amsDownloadBtn");
  const amsPalette = document.getElementById("amsPalette");

  // Brush mode
  const drawModeBtn = document.getElementById("drawModeBtn");
  const clearDrawBtn = document.getElementById("clearDrawBtn");
  const doneDrawBtn = document.getElementById("doneDrawBtn");
  const drawToolbar = document.getElementById("drawToolbar");

  // Circle mode
  const circleModeBtn = document.getElementById("circleModeBtn");
  const circleToolbar = document.getElementById("circleToolbar");
  const circleList = document.getElementById("circleList");
  const undoCircleBtn = document.getElementById("undoCircleBtn");
  const doneCircleBtn = document.getElementById("doneCircleBtn");

  // Sliders
  const pointCountSlider = document.getElementById("pointCount");
  const edgeThresholdSlider = document.getElementById("edgeThreshold");
  const edgeBiasSlider = document.getElementById("edgeBias");
  const blurSlider = document.getElementById("blur");
  const resolutionSelect = document.getElementById("resolution");
  const strokeWidthSlider = document.getElementById("strokeWidth");
  const brushSizeSlider = document.getElementById("brushSize");
  const brushStrengthSlider = document.getElementById("brushStrength");
  const circleDensitySlider = document.getElementById("circleDensity");
  const circleAccuracySlider = document.getElementById("circleAccuracy");
  const transparentBgCheckbox = document.getElementById("transparentBg");
  const showWireframeCheckbox = document.getElementById("showWireframe");

  // State
  let sourceImage = null;
  let lastTriangles = null;
  let currentMode = null; // null | "brush" | "circle"
  let isDrawing = false;

  // Density map (brush paint)
  let densityMap = null;
  let densityW = 0;
  let densityH = 0;

  // Circle zones: [{x, y, radius, density, accuracy}]
  let circleZones = [];
  let circleDragStart = null; // {x, y} for drag-to-size

  // --- Slider displays ---
  function bindSlider(slider, el, suffix) {
    slider.addEventListener("input", () => {
      el.textContent = slider.value + (suffix || "");
    });
  }

  bindSlider(pointCountSlider, document.getElementById("pointCountValue"));
  bindSlider(edgeThresholdSlider, document.getElementById("edgeThresholdValue"));
  bindSlider(blurSlider, document.getElementById("blurValue"));
  bindSlider(brushSizeSlider, document.getElementById("brushSizeValue"));

  edgeBiasSlider.addEventListener("input", () => {
    document.getElementById("edgeBiasValue").textContent = edgeBiasSlider.value + "%";
  });
  brushStrengthSlider.addEventListener("input", () => {
    document.getElementById("brushStrengthValue").textContent = brushStrengthSlider.value + "x";
  });
  circleDensitySlider.addEventListener("input", () => {
    document.getElementById("circleDensityValue").textContent = circleDensitySlider.value + "x";
  });
  circleAccuracySlider.addEventListener("input", () => {
    document.getElementById("circleAccuracyValue").textContent = circleAccuracySlider.value + "x";
  });
  strokeWidthSlider.addEventListener("input", () => {
    const v = parseFloat(strokeWidthSlider.value);
    document.getElementById("strokeWidthValue").textContent = v === 0 ? "None" : v.toFixed(1) + "px";
  });

  // --- File upload ---
  uploadArea.addEventListener("click", () => fileInput.click());
  uploadArea.addEventListener("dragover", (e) => { e.preventDefault(); uploadArea.classList.add("drag-over"); });
  uploadArea.addEventListener("dragleave", () => uploadArea.classList.remove("drag-over"));
  uploadArea.addEventListener("drop", (e) => {
    e.preventDefault();
    uploadArea.classList.remove("drag-over");
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) loadFile(file);
  });
  fileInput.addEventListener("change", () => {
    if (fileInput.files[0]) loadFile(fileInput.files[0]);
  });

  function loadFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        sourceImage = img;
        uploadArea.classList.add("has-file");
        uploadArea.querySelector(".upload-prompt span").textContent =
          `${file.name} (${img.width}x${img.height})`;
        generateBtn.disabled = false;
        drawModeBtn.disabled = false;
        circleModeBtn.disabled = false;
        clearDrawBtn.disabled = false;
        saveProjectBtn.disabled = false;

        densityW = img.width;
        densityH = img.height;
        densityMap = new Float32Array(densityW * densityH);
        circleZones = [];
        updateCircleList();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  // ============================================================
  // Mode management — only one mode at a time
  // ============================================================

  function exitAllModes() {
    if (currentMode === "brush") exitBrushMode();
    if (currentMode === "circle") exitCircleMode();
  }

  function showPreview() {
    outputCanvas.style.display = "none";
    placeholder.style.display = "none";
    previewCanvas.hidden = false;
    previewCanvas.width = sourceImage.width;
    previewCanvas.height = sourceImage.height;
    previewCanvas.style.display = "block";
  }

  function hidePreview() {
    previewCanvas.hidden = true;
    previewCanvas.style.display = "none";
    if (lastTriangles) outputCanvas.style.display = "block";
    else placeholder.style.display = "flex";
  }

  // ============================================================
  // Brush Paint Mode
  // ============================================================

  drawModeBtn.addEventListener("click", () => {
    if (!sourceImage) return;
    if (currentMode === "brush") { exitBrushMode(); return; }
    exitAllModes();
    enterBrushMode();
  });

  clearDrawBtn.addEventListener("click", () => {
    if (densityMap) densityMap.fill(0);
    circleZones = [];
    updateCircleList();
    if (currentMode) renderPreview();
  });

  doneDrawBtn.addEventListener("click", () => exitBrushMode());

  function enterBrushMode() {
    currentMode = "brush";
    drawModeBtn.classList.add("active");
    drawModeBtn.textContent = "Exit Brush";
    drawToolbar.hidden = false;
    canvasContainer.classList.add("drawing");
    showPreview();
    renderPreview();
    previewCanvas.addEventListener("mousedown", onBrushStart);
    previewCanvas.addEventListener("mousemove", onBrushMove);
    previewCanvas.addEventListener("mouseup", onBrushEnd);
    previewCanvas.addEventListener("mouseleave", onBrushEnd);
    previewCanvas.addEventListener("touchstart", onBrushTouchStart, { passive: false });
    previewCanvas.addEventListener("touchmove", onBrushTouchMove, { passive: false });
    previewCanvas.addEventListener("touchend", onBrushEnd);
  }

  function exitBrushMode() {
    currentMode = null;
    drawModeBtn.classList.remove("active");
    drawModeBtn.textContent = "Brush Paint";
    drawToolbar.hidden = true;
    canvasContainer.classList.remove("drawing");
    hidePreview();
    previewCanvas.removeEventListener("mousedown", onBrushStart);
    previewCanvas.removeEventListener("mousemove", onBrushMove);
    previewCanvas.removeEventListener("mouseup", onBrushEnd);
    previewCanvas.removeEventListener("mouseleave", onBrushEnd);
    previewCanvas.removeEventListener("touchstart", onBrushTouchStart);
    previewCanvas.removeEventListener("touchmove", onBrushTouchMove);
    previewCanvas.removeEventListener("touchend", onBrushEnd);
  }

  function getCanvasPos(e) {
    const rect = previewCanvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (densityW / rect.width),
      y: (e.clientY - rect.top) * (densityH / rect.height),
    };
  }

  function onBrushStart(e) { isDrawing = true; paintAt(getCanvasPos(e)); renderPreview(); }
  function onBrushMove(e) { if (!isDrawing) return; paintAt(getCanvasPos(e)); renderPreview(); }
  function onBrushEnd() { isDrawing = false; }
  function onBrushTouchStart(e) { e.preventDefault(); isDrawing = true; paintAt(getCanvasPos(e.touches[0])); renderPreview(); }
  function onBrushTouchMove(e) { e.preventDefault(); if (!isDrawing) return; paintAt(getCanvasPos(e.touches[0])); renderPreview(); }

  function paintAt(pos) {
    const radius = parseInt(brushSizeSlider.value);
    const strength = parseInt(brushStrengthSlider.value);
    const r2 = radius * radius;
    const x0 = Math.max(0, Math.floor(pos.x - radius));
    const y0 = Math.max(0, Math.floor(pos.y - radius));
    const x1 = Math.min(densityW - 1, Math.ceil(pos.x + radius));
    const y1 = Math.min(densityH - 1, Math.ceil(pos.y + radius));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - pos.x;
        const dy = y - pos.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < r2) {
          const falloff = 1 - Math.sqrt(d2) / radius;
          densityMap[y * densityW + x] = Math.min(10, densityMap[y * densityW + x] + strength * falloff * 0.5);
        }
      }
    }
  }

  // ============================================================
  // Circle Zone Mode
  // ============================================================

  circleModeBtn.addEventListener("click", () => {
    if (!sourceImage) return;
    if (currentMode === "circle") { exitCircleMode(); return; }
    exitAllModes();
    enterCircleMode();
  });

  undoCircleBtn.addEventListener("click", () => {
    circleZones.pop();
    updateCircleList();
    renderPreview();
  });

  doneCircleBtn.addEventListener("click", () => exitCircleMode());

  function enterCircleMode() {
    currentMode = "circle";
    circleModeBtn.classList.add("active");
    circleModeBtn.textContent = "Exit Circles";
    circleToolbar.hidden = false;
    canvasContainer.classList.add("circle-drawing");
    showPreview();
    renderPreview();
    updateCircleList();
    if (circleZones.length > 0) circleList.hidden = false;
    previewCanvas.addEventListener("mousedown", onCircleStart);
    previewCanvas.addEventListener("mousemove", onCircleMove);
    previewCanvas.addEventListener("mouseup", onCircleEnd);
    previewCanvas.addEventListener("mouseleave", onCircleCancelDrag);
  }

  function exitCircleMode() {
    currentMode = null;
    circleModeBtn.classList.remove("active");
    circleModeBtn.textContent = "Circle Zones";
    circleToolbar.hidden = true;
    circleList.hidden = true;
    canvasContainer.classList.remove("circle-drawing");
    hidePreview();
    previewCanvas.removeEventListener("mousedown", onCircleStart);
    previewCanvas.removeEventListener("mousemove", onCircleMove);
    previewCanvas.removeEventListener("mouseup", onCircleEnd);
    previewCanvas.removeEventListener("mouseleave", onCircleCancelDrag);
    circleDragStart = null;
  }

  function onCircleStart(e) {
    circleDragStart = getCanvasPos(e);
  }

  function onCircleMove(e) {
    if (!circleDragStart) return;
    // Live preview of circle being dragged
    const pos = getCanvasPos(e);
    const dx = pos.x - circleDragStart.x;
    const dy = pos.y - circleDragStart.y;
    const radius = Math.sqrt(dx * dx + dy * dy);
    renderPreview({
      x: circleDragStart.x,
      y: circleDragStart.y,
      radius,
      density: parseInt(circleDensitySlider.value),
      accuracy: parseInt(circleAccuracySlider.value),
    });
  }

  function onCircleEnd(e) {
    if (!circleDragStart) return;
    const pos = getCanvasPos(e);
    const dx = pos.x - circleDragStart.x;
    const dy = pos.y - circleDragStart.y;
    const radius = Math.max(10, Math.sqrt(dx * dx + dy * dy));
    circleZones.push({
      x: circleDragStart.x,
      y: circleDragStart.y,
      radius,
      density: parseInt(circleDensitySlider.value),
      accuracy: parseInt(circleAccuracySlider.value),
    });
    circleDragStart = null;
    updateCircleList();
    renderPreview();
  }

  function onCircleCancelDrag() {
    if (circleDragStart) {
      circleDragStart = null;
      renderPreview();
    }
  }

  function updateCircleList() {
    if (circleZones.length === 0) {
      circleList.hidden = true;
      circleList.innerHTML = "";
      return;
    }
    circleList.hidden = currentMode === "circle" ? false : true;
    let html = '<div class="circle-list-title">Circle Zones</div>';
    circleZones.forEach((z, i) => {
      html += `<div class="circle-zone-item">
        <span class="circle-zone-badge">${i + 1}</span>
        <span class="circle-zone-info">r=${Math.round(z.radius)}px &middot; Detail ${z.density}x &middot; Accuracy ${z.accuracy}x</span>
        <button class="circle-zone-delete" data-idx="${i}">Remove</button>
      </div>`;
    });
    circleList.innerHTML = html;

    circleList.querySelectorAll(".circle-zone-delete").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const idx = parseInt(e.target.dataset.idx);
        circleZones.splice(idx, 1);
        updateCircleList();
        if (currentMode) renderPreview();
      });
    });
  }

  // ============================================================
  // Shared preview renderer (brush density + circle zones)
  // ============================================================

  function renderPreview(tempCircle) {
    const ctx = previewCanvas.getContext("2d", { willReadFrequently: true });
    const pw = previewCanvas.width;
    const ph = previewCanvas.height;
    ctx.clearRect(0, 0, pw, ph);
    ctx.drawImage(sourceImage, 0, 0, pw, ph);

    // Overlay brush density
    if (densityMap) {
      const imgData = ctx.getImageData(0, 0, pw, ph);
      const d = imgData.data;
      const sx = densityW / pw;
      const sy = densityH / ph;
      for (let py = 0; py < ph; py++) {
        const oy = Math.floor(py * sy);
        for (let px = 0; px < pw; px++) {
          const val = densityMap[oy * densityW + Math.floor(px * sx)];
          if (val > 0) {
            const off = (py * pw + px) * 4;
            const a = Math.min(0.7, val * 0.2);
            d[off] = Math.min(255, d[off] + 255 * a);
            d[off + 1] = Math.floor(d[off + 1] * (1 - a * 0.5));
            d[off + 2] = Math.floor(d[off + 2] * (1 - a * 0.8));
          }
        }
      }
      ctx.putImageData(imgData, 0, 0);
    }

    // Draw circle zones
    const allCircles = [...circleZones];
    if (tempCircle) allCircles.push(tempCircle);

    for (let i = 0; i < allCircles.length; i++) {
      const z = allCircles[i];
      const isTemp = tempCircle && i === allCircles.length - 1;

      // Fill with translucent purple
      ctx.beginPath();
      ctx.arc(z.x, z.y, z.radius, 0, Math.PI * 2);
      ctx.fillStyle = isTemp ? "rgba(167, 139, 250, 0.15)" : "rgba(167, 139, 250, 0.12)";
      ctx.fill();

      // Stroke
      ctx.beginPath();
      ctx.arc(z.x, z.y, z.radius, 0, Math.PI * 2);
      ctx.strokeStyle = isTemp ? "rgba(167, 139, 250, 0.8)" : "rgba(167, 139, 250, 0.5)";
      ctx.lineWidth = isTemp ? 3 : 2;
      ctx.setLineDash(isTemp ? [8, 4] : []);
      ctx.stroke();
      ctx.setLineDash([]);

      // Label
      if (!isTemp) {
        ctx.font = `bold ${Math.max(12, Math.min(20, z.radius * 0.3))}px sans-serif`;
        ctx.fillStyle = "rgba(255,255,255,0.8)";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(`${z.density}x / ${z.accuracy}x`, z.x, z.y);
      }
    }
  }

  // ============================================================
  // Generate
  // ============================================================

  generateBtn.addEventListener("click", () => {
    if (!sourceImage) return;
    generate();
  });

  async function generate() {
    exitAllModes();

    const overlay = document.createElement("div");
    overlay.className = "processing-overlay";
    overlay.innerHTML = '<div class="spinner"></div><span>Generating low-poly art...</span>';
    canvasContainer.appendChild(overlay);
    generateBtn.disabled = true;

    await new Promise((r) => setTimeout(r, 50));

    try {
      const resScale = parseFloat(resolutionSelect.value);
      const w = Math.round(sourceImage.width * resScale);
      const h = Math.round(sourceImage.height * resScale);

      sourceCanvas.width = w;
      sourceCanvas.height = h;
      const srcCtx = sourceCanvas.getContext("2d", { willReadFrequently: true });
      srcCtx.drawImage(sourceImage, 0, 0, w, h);
      const imageData = srcCtx.getImageData(0, 0, w, h);

      const numPoints = parseInt(pointCountSlider.value);
      const edgeThreshold = parseInt(edgeThresholdSlider.value);
      const edgeBias = parseInt(edgeBiasSlider.value) / 100;
      const blurRadius = parseInt(blurSlider.value);
      const strokeW = parseFloat(strokeWidthSlider.value);
      const transparentBg = transparentBgCheckbox.checked;
      const wireframe = showWireframeCheckbox.checked;

      // 1. Grayscale + blur
      let gray = toGrayscale(imageData.data, w, h);
      for (let i = 0; i < blurRadius; i++) gray = boxBlur(gray, w, h);

      // 2. Edge detection
      const edges = sobelEdgeDetection(gray, w, h);

      // 3. Density map
      let scaledDensity = null;
      if (densityMap && hasDensityPaint()) {
        scaledDensity = scaleDensityMap(densityMap, densityW, densityH, w, h);
      }

      // 4. Scale circle zones to output resolution
      const scaledCircles = circleZones.map((z) => ({
        x: z.x * resScale,
        y: z.y * resScale,
        radius: z.radius * resScale,
        density: z.density,
        accuracy: z.accuracy,
      }));

      // 5. Sample points
      const points = samplePoints(edges, w, h, numPoints, edgeThreshold, edgeBias, scaledDensity, scaledCircles);
      console.log(`Total points: ${points.length}`);

      // 6. Border points
      addBorderPoints(points, w, h);

      // 7. Delaunay
      const triangulation = delaunay(points);

      // 8. Render
      outputCanvas.width = w;
      outputCanvas.height = h;
      outputCanvas.style.display = "block";
      placeholder.style.display = "none";

      if (transparentBg) {
        canvasContainer.classList.add("checkerboard");
      } else {
        canvasContainer.classList.remove("checkerboard");
      }

      lastTriangles = renderTriangles(
        outputCanvas, imageData.data, w, h,
        points, triangulation, transparentBg, wireframe, strokeW, scaledCircles
      );

      downloadBtn.disabled = false;
      downloadSvgBtn.disabled = false;
      downloadStlBtn.disabled = false;
      downloadAmsBtn.disabled = false;
    } catch (err) {
      console.error("Generation failed:", err);
    } finally {
      overlay.remove();
      generateBtn.disabled = false;
    }
  }

  function hasDensityPaint() {
    for (let i = 0; i < densityMap.length; i++) {
      if (densityMap[i] > 0) return true;
    }
    return false;
  }

  // ============================================================
  // Download
  // ============================================================

  downloadBtn.addEventListener("click", () => {
    const link = document.createElement("a");
    link.download = "low-poly.png";
    link.href = outputCanvas.toDataURL("image/png");
    link.click();
  });

  downloadSvgBtn.addEventListener("click", () => {
    if (!lastTriangles) return;
    const w = outputCanvas.width;
    const h = outputCanvas.height;
    const transparent = transparentBgCheckbox.checked;

    // Build optimized SVG for Bambu Studio compatibility:
    // - Integer coordinates (smaller file, faster parsing)
    // - Hex colors (shorter than rgb(), universal compatibility)
    // - No strokes (fewer attributes, cleaner geometry)
    // - Minimal attributes per element
    const parts = [];
    parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">`);
    if (!transparent) parts.push(`<rect width="${w}" height="${h}" fill="#000"/>`);

    // Group triangles by color to use <g fill="..."> groups (much smaller file)
    const colorGroups = new Map();
    for (const tri of lastTriangles) {
      const hex = colorToHex(tri.color);
      if (!colorGroups.has(hex)) colorGroups.set(hex, []);
      colorGroups.get(hex).push(tri.points);
    }

    for (const [hex, polys] of colorGroups) {
      if (polys.length === 1) {
        // Single polygon, inline
        const pts = polys[0].map((p) => `${Math.round(p[0])},${Math.round(p[1])}`).join(" ");
        parts.push(`<polygon points="${pts}" fill="${hex}"/>`);
      } else {
        // Group polygons sharing the same color
        parts.push(`<g fill="${hex}">`);
        for (const poly of polys) {
          const pts = poly.map((p) => `${Math.round(p[0])},${Math.round(p[1])}`).join(" ");
          parts.push(`<polygon points="${pts}"/>`);
        }
        parts.push("</g>");
      }
    }

    parts.push("</svg>");
    const svg = parts.join("\n");
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const link = document.createElement("a");
    link.download = "low-poly.svg";
    link.href = URL.createObjectURL(blob);
    link.click();
    URL.revokeObjectURL(link.href);
  });

  function colorToHex(color) {
    // Convert rgb(r,g,b) or rgba(r,g,b,a) to #RRGGBB
    const m = color.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (!m) return color; // already hex or other format
    const r = parseInt(m[1]);
    const g = parseInt(m[2]);
    const b = parseInt(m[3]);
    return "#" + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
  }

  // --- STL Export ---
  // Creates a flat 3D plate with each triangle extruded by brightness
  downloadStlBtn.addEventListener("click", () => {
    if (!lastTriangles) return;
    const h = outputCanvas.height;

    // Scale: 1 pixel = 0.1mm, depth based on brightness (darker = taller)
    const scale = 0.1;
    const baseThickness = 1.0; // mm - flat base plate
    const maxExtrude = 3.0;    // mm - max height above base

    // Binary STL: 80-byte header + 4-byte triangle count + 50 bytes per triangle
    // Each low-poly triangle becomes a top face + bottom face + 3 side quads (6 tris) = 8 triangles
    const triCount = lastTriangles.length * 8;
    const bufferSize = 84 + triCount * 50;
    const buffer = new ArrayBuffer(bufferSize);
    const view = new DataView(buffer);

    // Header (80 bytes)
    const header = "Low Poly STL - Generated by Low Poly Art Generator";
    for (let i = 0; i < 80; i++) {
      view.setUint8(i, i < header.length ? header.charCodeAt(i) : 0);
    }

    // Triangle count
    view.setUint32(80, triCount, true);

    let offset = 84;

    function writeTriFacet(ax, ay, az, bx, by, bz, cx, cy, cz) {
      // Compute normal via cross product
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= len; ny /= len; nz /= len;

      view.setFloat32(offset, nx, true); offset += 4;
      view.setFloat32(offset, ny, true); offset += 4;
      view.setFloat32(offset, nz, true); offset += 4;
      view.setFloat32(offset, ax, true); offset += 4;
      view.setFloat32(offset, ay, true); offset += 4;
      view.setFloat32(offset, az, true); offset += 4;
      view.setFloat32(offset, bx, true); offset += 4;
      view.setFloat32(offset, by, true); offset += 4;
      view.setFloat32(offset, bz, true); offset += 4;
      view.setFloat32(offset, cx, true); offset += 4;
      view.setFloat32(offset, cy, true); offset += 4;
      view.setFloat32(offset, cz, true); offset += 4;
      view.setUint16(offset, 0, true); offset += 2; // attribute byte count
    }

    for (const tri of lastTriangles) {
      const p = tri.points;
      // Parse brightness from color to determine extrusion height
      const m = tri.color.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
      let brightness = 128;
      if (m) brightness = 0.299 * parseInt(m[1]) + 0.587 * parseInt(m[2]) + 0.114 * parseInt(m[3]);

      // Darker areas extrude more (like a lithophane)
      const extrudeH = baseThickness + maxExtrude * (1 - brightness / 255);

      // Convert to mm, flip Y so it's right-side up
      const x0 = p[0][0] * scale, y0 = (h - p[0][1]) * scale;
      const x1 = p[1][0] * scale, y1 = (h - p[1][1]) * scale;
      const x2 = p[2][0] * scale, y2 = (h - p[2][1]) * scale;

      // Top face (at extrudeH)
      writeTriFacet(x0, y0, extrudeH, x1, y1, extrudeH, x2, y2, extrudeH);

      // Bottom face (at z=0), reversed winding
      writeTriFacet(x0, y0, 0, x2, y2, 0, x1, y1, 0);

      // 3 side walls (each quad = 2 triangles)
      const verts = [[x0, y0], [x1, y1], [x2, y2]];
      for (let i = 0; i < 3; i++) {
        const [ax, ay] = verts[i];
        const [bx, by] = verts[(i + 1) % 3];
        writeTriFacet(ax, ay, 0, bx, by, 0, bx, by, extrudeH);
        writeTriFacet(ax, ay, 0, bx, by, extrudeH, ax, ay, extrudeH);
      }
    }

    const blob = new Blob([buffer], { type: "application/octet-stream" });
    const link = document.createElement("a");
    link.download = "low-poly.stl";
    link.href = URL.createObjectURL(blob);
    link.click();
    URL.revokeObjectURL(link.href);
  });

  // ============================================================
  // AMS Export — multi-color STLs in a ZIP
  // ============================================================

  downloadAmsBtn.addEventListener("click", () => {
    if (!lastTriangles) return;
    amsOptions.hidden = !amsOptions.hidden;
    if (!amsOptions.hidden) {
      updateAmsPalette();
    }
  });

  amsSlotsSelect.addEventListener("change", updateAmsPalette);

  function parseTriColor(tri) {
    const m = tri.color.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (!m) return [128, 128, 128];
    return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
  }

  function quantizeColors(triangles, numColors) {
    // Median-cut color quantization
    const colors = triangles.map(parseTriColor);

    function medianCut(indices, depth) {
      if (depth === 0 || indices.length === 0) {
        // Average all colors in this bucket
        let r = 0, g = 0, b = 0;
        for (const i of indices) {
          r += colors[i][0]; g += colors[i][1]; b += colors[i][2];
        }
        const n = indices.length || 1;
        const avg = [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
        return [{ color: avg, indices }];
      }

      // Find channel with widest range
      let minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0;
      for (const i of indices) {
        const [r, g, b] = colors[i];
        if (r < minR) minR = r; if (r > maxR) maxR = r;
        if (g < minG) minG = g; if (g > maxG) maxG = g;
        if (b < minB) minB = b; if (b > maxB) maxB = b;
      }

      const rangeR = maxR - minR, rangeG = maxG - minG, rangeB = maxB - minB;
      let ch = 0;
      if (rangeG >= rangeR && rangeG >= rangeB) ch = 1;
      else if (rangeB >= rangeR && rangeB >= rangeG) ch = 2;

      // Sort by that channel and split at median
      indices.sort((a, b) => colors[a][ch] - colors[b][ch]);
      const mid = Math.floor(indices.length / 2);
      const left = indices.slice(0, mid);
      const right = indices.slice(mid);

      return [
        ...medianCut(left, depth - 1),
        ...medianCut(right, depth - 1),
      ];
    }

    const allIndices = Array.from({ length: triangles.length }, (_, i) => i);
    const depth = Math.ceil(Math.log2(numColors));
    let buckets = medianCut(allIndices, depth);

    // Merge smallest buckets if we have too many
    while (buckets.length > numColors) {
      buckets.sort((a, b) => a.indices.length - b.indices.length);
      const smallest = buckets.shift();
      // Merge into nearest color bucket
      let bestDist = Infinity, bestIdx = 0;
      for (let i = 0; i < buckets.length; i++) {
        const dr = smallest.color[0] - buckets[i].color[0];
        const dg = smallest.color[1] - buckets[i].color[1];
        const db = smallest.color[2] - buckets[i].color[2];
        const dist = dr * dr + dg * dg + db * db;
        if (dist < bestDist) { bestDist = dist; bestIdx = i; }
      }
      buckets[bestIdx].indices.push(...smallest.indices);
    }

    return buckets;
  }

  function updateAmsPalette() {
    if (!lastTriangles) return;
    const numSlots = parseInt(amsSlotsSelect.value);
    const buckets = quantizeColors(lastTriangles, numSlots);

    amsPalette.innerHTML = "";
    buckets.forEach((b, i) => {
      const hex = `#${((1 << 24) | (b.color[0] << 16) | (b.color[1] << 8) | b.color[2]).toString(16).slice(1)}`;
      const div = document.createElement("div");
      div.className = "ams-swatch";
      div.innerHTML = `<div class="ams-swatch-color" style="background:${hex}"></div>Slot ${i + 1} (${b.indices.length})`;
      amsPalette.appendChild(div);
    });
  }

  amsDownloadBtn.addEventListener("click", async () => {
    if (!lastTriangles) return;
    const h = outputCanvas.height;
    const numSlots = parseInt(amsSlotsSelect.value);
    const depthMode = amsDepthSelect.value;
    const scale = 0.1;

    let baseH, maxH;
    if (depthMode === "flat") { baseH = 2.0; maxH = 0; }
    else if (depthMode === "thick") { baseH = 2.0; maxH = 6.0; }
    else { baseH = 1.0; maxH = 3.0; } // relief

    const buckets = quantizeColors(lastTriangles, numSlots);

    // Build a single 3MF file with per-triangle colors embedded
    // 3MF = ZIP containing XML files that Bambu Studio reads natively

    // Collect all vertices and triangles for the combined mesh
    const allVertices = []; // [x, y, z]
    const allTriangles = []; // { v1, v2, v3, colorIdx }
    let vertexOffset = 0;

    // Map each low-poly triangle to a color bucket index
    const triToColor = new Int32Array(lastTriangles.length);
    for (let bi = 0; bi < buckets.length; bi++) {
      for (const ti of buckets[bi].indices) {
        triToColor[ti] = bi;
      }
    }

    for (let ti = 0; ti < lastTriangles.length; ti++) {
      const tri = lastTriangles[ti];
      const p = tri.points;
      const col = parseTriColor(tri);
      const brightness = 0.299 * col[0] + 0.587 * col[1] + 0.114 * col[2];
      const extH = baseH + maxH * (1 - brightness / 255);
      const colorIdx = triToColor[ti];

      const x0 = p[0][0] * scale, y0 = (h - p[0][1]) * scale;
      const x1 = p[1][0] * scale, y1 = (h - p[1][1]) * scale;
      const x2 = p[2][0] * scale, y2 = (h - p[2][1]) * scale;

      const base = vertexOffset;
      // Top face vertices (at extrusion height)
      allVertices.push([x0, y0, extH], [x1, y1, extH], [x2, y2, extH]);
      // Bottom face vertices (at z=0)
      allVertices.push([x0, y0, 0], [x1, y1, 0], [x2, y2, 0]);

      // Top face
      allTriangles.push({ v1: base, v2: base + 1, v3: base + 2, pid: colorIdx });
      // Bottom face (reversed winding)
      allTriangles.push({ v1: base + 3, v2: base + 5, v3: base + 4, pid: colorIdx });

      // 3 side quads (2 triangles each)
      const topIdx = [base, base + 1, base + 2];
      const botIdx = [base + 3, base + 4, base + 5];
      for (let i = 0; i < 3; i++) {
        const j = (i + 1) % 3;
        allTriangles.push({ v1: botIdx[i], v2: botIdx[j], v3: topIdx[j], pid: colorIdx });
        allTriangles.push({ v1: botIdx[i], v2: topIdx[j], v3: topIdx[i], pid: colorIdx });
      }

      vertexOffset += 6;
    }

    // Build 3MF XML with per-triangle color assignments
    // displaycolor must include alpha channel (FF) for Bambu Studio
    const colorHexList = buckets.map(b =>
      `#${((1 << 24) | (b.color[0] << 16) | (b.color[1] << 8) | b.color[2]).toString(16).slice(1).toUpperCase()}FF`
    );

    let baseMaterials = "";
    for (let i = 0; i < colorHexList.length; i++) {
      baseMaterials += `      <base name="Color ${i + 1}" displaycolor="${colorHexList[i]}" />\n`;
    }

    // Build vertices XML using array for performance
    const verticesParts = [];
    for (const v of allVertices) {
      verticesParts.push(`        <vertex x="${v[0].toFixed(4)}" y="${v[1].toFixed(4)}" z="${v[2].toFixed(4)}" />`);
    }

    // Build triangles XML — every triangle gets pid="1" and p1 for its color index
    const trianglesParts = [];
    for (const t of allTriangles) {
      trianglesParts.push(`        <triangle v1="${t.v1}" v2="${t.v2}" v3="${t.v3}" pid="1" p1="${t.pid}" />`);
    }

    const modelXml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <metadata name="Title">Low Poly Art</metadata>
  <metadata name="Application">Low Poly Art Generator</metadata>
  <resources>
    <basematerials id="1">
${baseMaterials}    </basematerials>
    <object id="2" type="model" pid="1" pindex="0">
      <mesh>
        <vertices>
${verticesParts.join("\n")}
        </vertices>
        <triangles>
${trianglesParts.join("\n")}
        </triangles>
      </mesh>
    </object>
  </resources>
  <build>
    <item objectid="2" />
  </build>
</model>`;

    const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />
</Types>`;

    const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />
</Relationships>`;

    const enc = new TextEncoder();
    const files = [
      { name: "[Content_Types].xml", data: enc.encode(contentTypes) },
      { name: "_rels/.rels", data: enc.encode(rels) },
      { name: "3D/3dmodel.model", data: enc.encode(modelXml) },
    ];

    const zipBlob = buildZip(files);
    const link = document.createElement("a");
    link.download = "low-poly-ams.3mf";
    link.href = URL.createObjectURL(zipBlob);
    link.click();
    URL.revokeObjectURL(link.href);
  });

  // ============================================================
  // Save / Load Project
  // ============================================================

  const saveProjectBtn = document.getElementById("saveProjectBtn");
  const loadProjectBtn = document.getElementById("loadProjectBtn");
  const loadProjectInput = document.getElementById("loadProjectInput");

  saveProjectBtn.addEventListener("click", () => {
    if (!sourceImage) return;

    // Get source image as data URL
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = sourceImage.width;
    tempCanvas.height = sourceImage.height;
    const tempCtx = tempCanvas.getContext("2d");
    tempCtx.drawImage(sourceImage, 0, 0);
    const imageDataUrl = tempCanvas.toDataURL("image/png");

    // Compress density map: only store non-zero entries
    const sparseMap = [];
    if (densityMap) {
      for (let i = 0; i < densityMap.length; i++) {
        if (densityMap[i] > 0) sparseMap.push([i, densityMap[i]]);
      }
    }

    const project = {
      version: 1,
      image: imageDataUrl,
      imageWidth: sourceImage.width,
      imageHeight: sourceImage.height,
      settings: {
        pointCount: pointCountSlider.value,
        edgeThreshold: edgeThresholdSlider.value,
        edgeBias: edgeBiasSlider.value,
        blur: blurSlider.value,
        resolution: resolutionSelect.value,
        strokeWidth: strokeWidthSlider.value,
        transparentBg: transparentBgCheckbox.checked,
        showWireframe: showWireframeCheckbox.checked,
        brushSize: brushSizeSlider.value,
        brushStrength: brushStrengthSlider.value,
        circleDensity: circleDensitySlider.value,
        circleAccuracy: circleAccuracySlider.value,
      },
      circleZones: circleZones,
      densityMap: sparseMap.length > 0 ? { w: densityW, h: densityH, data: sparseMap } : null,
    };

    const json = JSON.stringify(project);
    const blob = new Blob([json], { type: "application/json" });
    const link = document.createElement("a");
    link.download = "low-poly-project.lowpoly";
    link.href = URL.createObjectURL(blob);
    link.click();
    URL.revokeObjectURL(link.href);
  });

  loadProjectBtn.addEventListener("click", () => loadProjectInput.click());

  loadProjectInput.addEventListener("change", () => {
    const file = loadProjectInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const project = JSON.parse(e.target.result);
        loadProject(project);
      } catch (err) {
        console.error("Failed to load project:", err);
        alert("Invalid project file.");
      }
    };
    reader.readAsText(file);
    loadProjectInput.value = "";
  });

  function loadProject(project) {
    // Load image
    const img = new Image();
    img.onload = () => {
      sourceImage = img;
      uploadArea.classList.add("has-file");
      uploadArea.querySelector(".upload-prompt span").textContent =
        `Loaded project (${img.width}x${img.height})`;

      // Restore settings
      const s = project.settings;
      pointCountSlider.value = s.pointCount;
      document.getElementById("pointCountValue").textContent = s.pointCount;
      edgeThresholdSlider.value = s.edgeThreshold;
      document.getElementById("edgeThresholdValue").textContent = s.edgeThreshold;
      edgeBiasSlider.value = s.edgeBias;
      document.getElementById("edgeBiasValue").textContent = s.edgeBias + "%";
      blurSlider.value = s.blur;
      document.getElementById("blurValue").textContent = s.blur;
      resolutionSelect.value = s.resolution;
      strokeWidthSlider.value = s.strokeWidth;
      const sv = parseFloat(s.strokeWidth);
      document.getElementById("strokeWidthValue").textContent = sv === 0 ? "None" : sv.toFixed(1) + "px";
      transparentBgCheckbox.checked = s.transparentBg;
      showWireframeCheckbox.checked = s.showWireframe;
      brushSizeSlider.value = s.brushSize;
      document.getElementById("brushSizeValue").textContent = s.brushSize;
      brushStrengthSlider.value = s.brushStrength;
      document.getElementById("brushStrengthValue").textContent = s.brushStrength + "x";
      circleDensitySlider.value = s.circleDensity;
      document.getElementById("circleDensityValue").textContent = s.circleDensity + "x";
      circleAccuracySlider.value = s.circleAccuracy;
      document.getElementById("circleAccuracyValue").textContent = s.circleAccuracy + "x";

      // Restore density map
      densityW = project.imageWidth;
      densityH = project.imageHeight;
      densityMap = new Float32Array(densityW * densityH);
      if (project.densityMap && project.densityMap.data) {
        for (const [idx, val] of project.densityMap.data) {
          densityMap[idx] = val;
        }
      }

      // Restore circle zones
      circleZones = project.circleZones || [];
      updateCircleList();

      // Enable buttons
      generateBtn.disabled = false;
      drawModeBtn.disabled = false;
      circleModeBtn.disabled = false;
      clearDrawBtn.disabled = false;
      saveProjectBtn.disabled = false;

      // Auto-generate
      lastTriangles = null;
      generate();
    };
    img.src = project.image;
  }

  // Minimal ZIP builder (store mode, no compression)
  function buildZip(files) {
    const entries = [];
    let centralOffset = 0;

    // Local file entries
    for (const f of files) {
      const nameBytes = new TextEncoder().encode(f.name);
      // Local file header: 30 bytes + name + data
      const localHeader = new ArrayBuffer(30 + nameBytes.length);
      const lv = new DataView(localHeader);
      lv.setUint32(0, 0x04034b50, true); // signature
      lv.setUint16(4, 20, true);         // version needed
      lv.setUint16(6, 0, true);          // flags
      lv.setUint16(8, 0, true);          // compression: store
      lv.setUint16(10, 0, true);         // mod time
      lv.setUint16(12, 0, true);         // mod date
      lv.setUint32(14, crc32(f.data), true);
      lv.setUint32(18, f.data.length, true); // compressed size
      lv.setUint32(22, f.data.length, true); // uncompressed size
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);         // extra field length
      new Uint8Array(localHeader).set(nameBytes, 30);

      entries.push({ name: nameBytes, data: f.data, localHeader: new Uint8Array(localHeader), offset: centralOffset });
      centralOffset += localHeader.byteLength + f.data.length;
    }

    // Central directory
    const centralParts = [];
    for (const e of entries) {
      const cdHeader = new ArrayBuffer(46 + e.name.length);
      const cv = new DataView(cdHeader);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, 0, true);
      cv.setUint16(14, 0, true);
      cv.setUint32(16, crc32(e.data), true);
      cv.setUint32(20, e.data.length, true);
      cv.setUint32(24, e.data.length, true);
      cv.setUint16(28, e.name.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, e.offset, true);
      new Uint8Array(cdHeader).set(e.name, 46);
      centralParts.push(new Uint8Array(cdHeader));
    }

    let centralSize = 0;
    for (const cp of centralParts) centralSize += cp.length;

    // End of central directory
    const eocd = new ArrayBuffer(22);
    const ev = new DataView(eocd);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, entries.length, true);
    ev.setUint16(10, entries.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, centralOffset, true);
    ev.setUint16(20, 0, true);

    // Combine all parts
    const parts = [];
    for (const e of entries) {
      parts.push(e.localHeader);
      parts.push(e.data);
    }
    for (const cp of centralParts) parts.push(cp);
    parts.push(new Uint8Array(eocd));

    return new Blob(parts, { type: "application/zip" });
  }

  // CRC-32 implementation
  function crc32(data) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) {
      crc ^= data[i];
      for (let j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
      }
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  // ============================================================
  // Image Processing
  // ============================================================

  function toGrayscale(data, w, h) {
    const gray = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const off = i * 4;
      gray[i] = 0.299 * data[off] + 0.587 * data[off + 1] + 0.114 * data[off + 2];
    }
    return gray;
  }

  function boxBlur(src, w, h) {
    const dst = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++)
            sum += src[(y + dy) * w + (x + dx)];
        dst[y * w + x] = sum / 9;
      }
    }
    return dst;
  }

  function sobelEdgeDetection(gray, w, h) {
    const edges = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const tl = gray[(y - 1) * w + (x - 1)];
        const tc = gray[(y - 1) * w + x];
        const tr = gray[(y - 1) * w + (x + 1)];
        const ml = gray[y * w + (x - 1)];
        const mr = gray[y * w + (x + 1)];
        const bl = gray[(y + 1) * w + (x - 1)];
        const bc = gray[(y + 1) * w + x];
        const br = gray[(y + 1) * w + (x + 1)];
        const gx = -tl + tr - 2 * ml + 2 * mr - bl + br;
        const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;
        edges[y * w + x] = Math.sqrt(gx * gx + gy * gy);
      }
    }
    return edges;
  }

  function scaleDensityMap(src, srcW, srcH, dstW, dstH) {
    const dst = new Float32Array(dstW * dstH);
    const sx = srcW / dstW;
    const sy = srcH / dstH;
    for (let y = 0; y < dstH; y++) {
      const oy = Math.floor(y * sy);
      for (let x = 0; x < dstW; x++) {
        dst[y * dstW + x] = src[oy * srcW + Math.floor(x * sx)];
      }
    }
    return dst;
  }

  function samplePoints(edges, w, h, numPoints, threshold, edgeBias, densityMap, circles) {
    const points = [];
    const edgePoints = [];
    const step = Math.max(1, Math.floor(Math.sqrt(w * h) / 600));

    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        if (edges[y * w + x] > threshold) edgePoints.push([x, y]);
      }
    }

    const numEdge = Math.min(Math.floor(numPoints * edgeBias), edgePoints.length);
    const numRandom = numPoints - numEdge;

    shuffle(edgePoints);
    for (let i = 0; i < numEdge; i++) points.push(edgePoints[i]);
    for (let i = 0; i < numRandom; i++) {
      points.push([Math.floor(Math.random() * w), Math.floor(Math.random() * h)]);
    }

    // Brush density points
    if (densityMap) {
      const maxDensityPts = numPoints * 2;
      let added = 0;
      for (let y = 0; y < h && added < maxDensityPts; y += step) {
        for (let x = 0; x < w && added < maxDensityPts; x += step) {
          const d = densityMap[y * w + x];
          if (d > 0.5) {
            const count = Math.ceil(d * 1.5);
            for (let j = 0; j < count && added < maxDensityPts; j++) {
              points.push([
                Math.max(0, Math.min(w - 1, Math.floor(x + (Math.random() - 0.5) * step * 2))),
                Math.max(0, Math.min(h - 1, Math.floor(y + (Math.random() - 0.5) * step * 2))),
              ]);
              added++;
            }
          }
        }
      }
    }

    // Circle zone points — density controls how many extra triangles,
    // but keeps the count low enough to still look like low-poly art.
    // Base: ~30 points per circle, scaled by density multiplier.
    for (const z of circles) {
      const basePts = 30;
      const ptsInCircle = Math.floor(basePts * z.density);
      for (let i = 0; i < ptsInCircle; i++) {
        const angle = Math.random() * Math.PI * 2;
        const r = z.radius * Math.sqrt(Math.random());
        const px = Math.floor(z.x + r * Math.cos(angle));
        const py = Math.floor(z.y + r * Math.sin(angle));
        if (px >= 0 && px < w && py >= 0 && py < h) {
          points.push([px, py]);
        }
      }
    }

    return points;
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  function addBorderPoints(points, w, h) {
    const step = Math.max(15, Math.floor(Math.min(w, h) / 40));
    points.push([0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]);
    for (let x = step; x < w - 1; x += step) points.push([x, 0], [x, h - 1]);
    for (let y = step; y < h - 1; y += step) points.push([0, y], [w - 1, y]);
  }

  // ============================================================
  // Delaunay Triangulation (Bowyer-Watson)
  // ============================================================

  function delaunay(points) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of points) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    const dx = maxX - minX;
    const dy = maxY - minY;
    const dmax = Math.max(dx, dy);
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;

    const p1 = [midX - 20 * dmax, midY - dmax];
    const p2 = [midX + 20 * dmax, midY - dmax];
    const p3 = [midX, midY + 20 * dmax];

    const allPoints = [...points, p1, p2, p3];
    const superIdxStart = points.length;
    let triangles = [[superIdxStart, superIdxStart + 1, superIdxStart + 2]];

    for (let i = 0; i < points.length; i++) {
      const px = allPoints[i][0];
      const py = allPoints[i][1];
      const badTriangles = [];
      for (let t = 0; t < triangles.length; t++) {
        const tri = triangles[t];
        if (inCircumcircle(px, py, allPoints[tri[0]], allPoints[tri[1]], allPoints[tri[2]])) {
          badTriangles.push(t);
        }
      }
      const edges = [];
      for (const t of badTriangles) {
        const tri = triangles[t];
        edges.push([tri[0], tri[1]]);
        edges.push([tri[1], tri[2]]);
        edges.push([tri[2], tri[0]]);
      }
      const boundary = [];
      for (let e = 0; e < edges.length; e++) {
        let shared = false;
        for (let f = 0; f < edges.length; f++) {
          if (e === f) continue;
          if (edges[e][0] === edges[f][1] && edges[e][1] === edges[f][0]) { shared = true; break; }
        }
        if (!shared) boundary.push(edges[e]);
      }
      const badSet = new Set(badTriangles);
      const newTris = [];
      for (let t = 0; t < triangles.length; t++) {
        if (!badSet.has(t)) newTris.push(triangles[t]);
      }
      for (const edge of boundary) newTris.push([edge[0], edge[1], i]);
      triangles = newTris;
    }

    triangles = triangles.filter(
      (t) => t[0] < superIdxStart && t[1] < superIdxStart && t[2] < superIdxStart
    );
    return { points: allPoints, triangles };
  }

  function inCircumcircle(px, py, a, b, c) {
    const ax = a[0] - px, ay = a[1] - py;
    const bx = b[0] - px, by = b[1] - py;
    const cx = c[0] - px, cy = c[1] - py;
    return (
      (ax * ax + ay * ay) * (bx * cy - cx * by) -
      (bx * bx + by * by) * (ax * cy - cx * ay) +
      (cx * cx + cy * cy) * (ax * by - bx * ay)
    ) > 0;
  }

  // ============================================================
  // Rendering
  // ============================================================

  function renderTriangles(canvas, imageData, w, h, origPoints, { points, triangles }, transparent, wireframe, strokeW, circles) {
    const ctx = canvas.getContext("2d");

    if (transparent) {
      ctx.clearRect(0, 0, w, h);
    } else {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, w, h);
    }

    const result = [];

    for (const tri of triangles) {
      const p0 = points[tri[0]];
      const p1 = points[tri[1]];
      const p2 = points[tri[2]];

      const cx = Math.floor((p0[0] + p1[0] + p2[0]) / 3);
      const cy = Math.floor((p0[1] + p1[1] + p2[1]) / 3);

      // Determine accuracy level: check if centroid is inside any circle zone
      let accuracyLevel = 1;
      for (const z of circles) {
        const dx = cx - z.x;
        const dy = cy - z.y;
        if (dx * dx + dy * dy <= z.radius * z.radius) {
          accuracyLevel = Math.max(accuracyLevel, z.accuracy);
        }
      }

      const color = sampleAreaColor(imageData, w, h, p0, p1, p2, cx, cy, accuracyLevel);

      const alpha = transparent ? sampleAlpha(imageData, w, h, cx, cy) : 255;
      if (transparent && alpha < 10) continue;

      const a = transparent ? alpha / 255 : 1;
      const fillStyle = a < 1
        ? `rgba(${color[0]},${color[1]},${color[2]},${a.toFixed(3)})`
        : `rgb(${color[0]},${color[1]},${color[2]})`;

      ctx.beginPath();
      ctx.moveTo(p0[0], p0[1]);
      ctx.lineTo(p1[0], p1[1]);
      ctx.lineTo(p2[0], p2[1]);
      ctx.closePath();
      ctx.fillStyle = fillStyle;
      ctx.fill();

      let strokeStyle = fillStyle;
      let lineWidth = 0.5;

      if (wireframe) {
        strokeStyle = "rgba(255,255,255,0.15)";
        lineWidth = 0.8;
      } else if (strokeW > 0) {
        strokeStyle = `rgba(0,0,0,${Math.min(1, strokeW * 0.3).toFixed(2)})`;
        lineWidth = strokeW;
      } else if (transparent) {
        strokeStyle = "transparent";
        lineWidth = 0;
      }

      if (lineWidth > 0) {
        ctx.strokeStyle = strokeStyle;
        ctx.lineWidth = lineWidth;
        ctx.lineJoin = "round";
        ctx.stroke();
      }

      result.push({ points: [p0, p1, p2], color: fillStyle, stroke: strokeStyle, strokeWidth: lineWidth });
    }

    return result;
  }

  function sampleAreaColor(imageData, w, h, p0, p1, p2, cx, cy, accuracy) {
    // Base 7 sample points
    const baseSamples = [
      [cx, cy],
      [(p0[0] + p1[0]) >> 1, (p0[1] + p1[1]) >> 1],
      [(p1[0] + p2[0]) >> 1, (p1[1] + p2[1]) >> 1],
      [(p2[0] + p0[0]) >> 1, (p2[1] + p0[1]) >> 1],
      [Math.floor(cx * 0.7 + p0[0] * 0.3), Math.floor(cy * 0.7 + p0[1] * 0.3)],
      [Math.floor(cx * 0.7 + p1[0] * 0.3), Math.floor(cy * 0.7 + p1[1] * 0.3)],
      [Math.floor(cx * 0.7 + p2[0] * 0.3), Math.floor(cy * 0.7 + p2[1] * 0.3)],
    ];

    let r = 0, g = 0, b = 0, count = 0;

    // Sample base points
    for (const [sx, sy] of baseSamples) {
      const px = Math.max(0, Math.min(w - 1, sx));
      const py = Math.max(0, Math.min(h - 1, sy));
      const off = (py * w + px) * 4;
      r += imageData[off];
      g += imageData[off + 1];
      b += imageData[off + 2];
      count++;
    }

    // Extra samples for higher accuracy (inside the triangle)
    // Adds a few more sample points using barycentric coords for truer color
    if (accuracy > 1) {
      const extraCount = (accuracy - 1) * 3;
      for (let i = 0; i < extraCount; i++) {
        // Random barycentric coordinates
        let u = Math.random();
        let v = Math.random();
        if (u + v > 1) { u = 1 - u; v = 1 - v; }
        const wx = 1 - u - v;
        const sx = Math.floor(p0[0] * wx + p1[0] * u + p2[0] * v);
        const sy = Math.floor(p0[1] * wx + p1[1] * u + p2[1] * v);
        const px = Math.max(0, Math.min(w - 1, sx));
        const py = Math.max(0, Math.min(h - 1, sy));
        const off = (py * w + px) * 4;
        r += imageData[off];
        g += imageData[off + 1];
        b += imageData[off + 2];
        count++;
      }
    }

    return [Math.round(r / count), Math.round(g / count), Math.round(b / count)];
  }

  function sampleAlpha(imageData, w, h, cx, cy) {
    const px = Math.max(0, Math.min(w - 1, cx));
    const py = Math.max(0, Math.min(h - 1, cy));
    return imageData[(py * w + px) * 4 + 3];
  }
})();
