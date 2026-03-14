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
