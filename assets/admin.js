/* Contingency Map — in-app admin.
 *
 * Everything is administered here: sections are drawn directly on the map
 * (by tracing the real railway pulled from OpenStreetMap, or manually), and
 * contingency plans are created/edited with forms. No backend work needed.
 */

(function () {
  const esc = CMap.esc;
  const map = CMap.map;

  const A = (CMap.admin = {
    active: false,
    editing: null, // working copy of the section being edited (null = list view)
    editingPlan: null,
  });

  const panel = document.getElementById("adminPanel");
  const titleEl = document.getElementById("adminTitle");
  const metaEl = document.getElementById("adminMeta");
  const bodyEl = document.getElementById("adminBody");

  // =====================================================================
  // Admin mode on/off
  // =====================================================================

  document.getElementById("adminBtn").addEventListener("click", async () => {
    if (A.active) return exitAdmin();
    if (CMap.state.adminCode) {
      try {
        const ok = await CMap.verifyAdmin(CMap.state.adminCode);
        if (ok) return enterAdmin();
      } catch { /* fall through to prompt */ }
      CMap.setAdminCode(null);
    }
    promptPasscode();
  });

  document.getElementById("adminCloseBtn").addEventListener("click", exitAdmin);

  function promptPasscode() {
    const body = document.createElement("div");
    body.innerHTML = `
      <div class="field">
        <label>Admin passcode</label>
        <input type="text" id="pcInput" autocomplete="off" placeholder="Enter passcode" />
      </div>
      <div class="btn-row">
        <button class="btn btn-primary" id="pcGo">Sign in</button>
      </div>
      <div class="small" style="margin-top:10px">Admin mode lets you draw sections on the map and manage their contingency plans.</div>
    `;
    const m = CMap.modal({ title: "Admin sign in", body });
    const input = body.querySelector("#pcInput");
    input.focus();

    async function go() {
      const code = input.value.trim();
      if (!code) return;
      try {
        const ok = await CMap.verifyAdmin(code);
        if (!ok) return CMap.toast("Wrong passcode.", "err");
        CMap.setAdminCode(code);
        m.close();
        enterAdmin();
      } catch (err) {
        CMap.toast(err.message, "err");
      }
    }
    body.querySelector("#pcGo").addEventListener("click", go);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  }

  function enterAdmin() {
    A.active = true;
    document.getElementById("adminBtn").textContent = "Exit admin";
    panel.classList.add("open");
    panel.setAttribute("aria-hidden", "false");
    showSectionList();
  }

  function exitAdmin() {
    cancelDraw();
    clearEditPreview();
    A.active = false;
    A.editing = null;
    A.editingPlan = null;
    document.getElementById("adminBtn").textContent = "Admin";
    panel.classList.remove("open");
    panel.setAttribute("aria-hidden", "true");
  }

  async function refreshData() {
    await CMap.loadAll();
    CMap.renderSections();
  }

  // =====================================================================
  // View: section list
  // =====================================================================

  function showSectionList() {
    cancelDraw();
    clearEditPreview();
    A.editing = null;
    A.editingPlan = null;
    titleEl.textContent = "Admin — Sections";
    metaEl.textContent = "Click a section to edit it, or click one on the map.";

    const items = CMap.state.sections.map((s) => `
      <button class="list-item" data-id="${esc(s.id)}">
        <span class="li-dot" style="background:${esc(s.color || "#c2410c")}"></span>
        <span style="flex:1">
          <span class="li-main">${esc(s.name)}</span>
          <span class="li-sub">${esc(s.code)} · ${s.plans.length} plan${s.plans.length === 1 ? "" : "s"}</span>
        </span>
        ${s.geometry ? "" : `<span class="li-flag warn">no geometry</span>`}
      </button>`).join("");

    bodyEl.innerHTML = `
      <button class="btn btn-primary" id="newSectionBtn" style="width:100%; justify-content:center; margin-bottom:12px">+ New section</button>
      ${items || `<div class="empty">No sections yet. Create one, then draw it on the map.</div>`}
      <div class="section-divider">Admin settings</div>
      <div class="btn-row" style="margin-top:0">
        <button class="btn btn-sm" id="changeCodeBtn">Change passcode</button>
        <button class="btn btn-sm" id="signOutBtn">Sign out of admin</button>
      </div>
    `;

    bodyEl.querySelector("#newSectionBtn").addEventListener("click", () => openSectionEditor(null));
    bodyEl.querySelectorAll(".list-item").forEach((el) =>
      el.addEventListener("click", () => openSectionEditor(el.dataset.id))
    );
    bodyEl.querySelector("#signOutBtn").addEventListener("click", () => {
      CMap.setAdminCode(null);
      exitAdmin();
      CMap.toast("Signed out of admin.");
    });
    bodyEl.querySelector("#changeCodeBtn").addEventListener("click", promptChangeCode);
  }

  function promptChangeCode() {
    const body = document.createElement("div");
    body.innerHTML = `
      <div class="field"><label>New passcode</label>
        <input type="text" id="ncInput" autocomplete="off" /></div>
      <div class="btn-row"><button class="btn btn-primary" id="ncGo">Change passcode</button></div>
    `;
    const m = CMap.modal({ title: "Change admin passcode", body });
    body.querySelector("#ncGo").addEventListener("click", async () => {
      const next = body.querySelector("#ncInput").value.trim();
      try {
        await CMap.changeAdminCode(CMap.state.adminCode, next);
        CMap.setAdminCode(next);
        m.close();
        CMap.toast("Passcode changed.", "ok");
      } catch (err) {
        CMap.toast(err.message, "err");
      }
    });
  }

  // =====================================================================
  // View: section editor
  // =====================================================================

  A.openSection = function (id) {
    if (!A.active) return;
    openSectionEditor(id);
  };

  function openSectionEditor(id) {
    cancelDraw();
    A.editingPlan = null;

    const existing = id ? CMap.state.sections.find((s) => s.id === id) : null;
    A.editing = existing
      ? JSON.parse(JSON.stringify(existing))
      : { id: null, code: "", name: "", description: "", color: "#c2410c", sort_order: 100, geometry: null, plans: [] };

    renderSectionEditor();
    showEditPreview();
    if (existing && existing.geometry) zoomToGeometry(existing.geometry);
  }

  function geometrySummary(geom) {
    if (!geom || !geom.type) return "No geometry yet — draw this section on the map.";
    if (geom.type === "LineString") return `<b>Route line</b> · ${geom.coordinates.length} points`;
    if (geom.type === "Polygon") return `<b>Area</b> · ${geom.coordinates[0].length - 1} corners`;
    return `<b>${esc(geom.type)}</b>`;
  }

  function renderSectionEditor() {
    const s = A.editing;
    titleEl.textContent = s.id ? "Edit section" : "New section";
    metaEl.textContent = s.id ? s.code : "Fill in the details, then draw it on the map.";

    const plansHtml = (s.plans || []).map((p) => `
      <button class="list-item" data-plan="${esc(p.id)}">
        <span style="flex:1">
          <span class="li-main">${esc(p.plan_code || p.title)}</span>
          <span class="li-sub">${esc(p.scenario_label || p.title)}</span>
        </span>
        ${p.severity ? `<span class="badge ${CMap.severityClass(p.severity)}">${esc(p.severity)}</span>` : ""}
      </button>`).join("");

    bodyEl.innerHTML = `
      <button class="back-link" id="backToList">← All sections</button>

      <div class="field"><label>Name</label>
        <input type="text" id="fName" value="${esc(s.name)}" placeholder="e.g. Luton – Bedford" /></div>
      <div class="field-row">
        <div class="field"><label>Code (unique)</label>
          <input type="text" id="fCode" value="${esc(s.code)}" placeholder="e.g. LUT_BDM" /></div>
        <div class="field" style="flex:0 0 130px"><label>Sort order</label>
          <input type="number" id="fSort" value="${esc(s.sort_order)}" /></div>
      </div>
      <div class="field-row">
        <div class="field" style="flex:0 0 70px"><label>Colour</label>
          <input type="color" id="fColor" value="${esc(s.color || "#c2410c")}" /></div>
        <div class="field"><label>Notes / description</label>
          <input type="text" id="fDesc" value="${esc(s.description || "")}" /></div>
      </div>

      <div class="section-divider">Map geometry</div>
      <div class="geom-status" id="geomStatus">${geometrySummary(s.geometry)}</div>
      <div class="tool-grid">
        <button class="btn btn-sm" id="toolTrace" title="Click along the railway — the route follows the actual track">🛤 Trace railway</button>
        <button class="btn btn-sm" id="toolLine" title="Click points to draw a line by hand">✏️ Draw line</button>
        <button class="btn btn-sm" id="toolArea" title="Click corners to draw an area (e.g. a station)">⬠ Draw area</button>
        <button class="btn btn-sm btn-danger" id="toolClear">Clear</button>
      </div>
      <div class="small" style="margin-top:8px">
        <b>Trace railway</b> is the quick way: it loads the real track layout from OpenStreetMap and
        snaps your clicks along it, so you get the exact railway alignment. Zoom in, click where the
        section starts, then click along to where it ends.
      </div>

      <div class="btn-row">
        <button class="btn btn-primary" id="saveSectionBtn">Save section</button>
        ${s.id ? `<button class="btn btn-danger" id="deleteSectionBtn">Delete</button>` : ""}
      </div>

      ${s.id ? `
        <div class="section-divider">Contingency plans (${(s.plans || []).length})</div>
        ${plansHtml || `<div class="empty">No plans yet for this section.</div>`}
        <button class="btn" id="newPlanBtn" style="width:100%; justify-content:center; margin-top:8px">+ Add plan</button>
      ` : `
        <div class="section-divider">Contingency plans</div>
        <div class="small">Save the section first, then add its contingency plans.</div>
      `}
    `;

    bodyEl.querySelector("#backToList").addEventListener("click", showSectionList);

    const bind = (sel, key) => {
      bodyEl.querySelector(sel).addEventListener("input", (e) => {
        s[key] = key === "sort_order" ? Number(e.target.value || 0) : e.target.value;
        if (key === "color") showEditPreview();
      });
    };
    bind("#fName", "name");
    bind("#fCode", "code");
    bind("#fSort", "sort_order");
    bind("#fColor", "color");
    bind("#fDesc", "description");

    bodyEl.querySelector("#toolTrace").addEventListener("click", () => startDraw("trace"));
    bodyEl.querySelector("#toolLine").addEventListener("click", () => startDraw("line"));
    bodyEl.querySelector("#toolArea").addEventListener("click", () => startDraw("area"));
    bodyEl.querySelector("#toolClear").addEventListener("click", async () => {
      if (!s.geometry) return;
      if (!(await CMap.confirm("Clear geometry", "Remove this section's shape from the map? (Not saved until you press Save section.)", "Clear"))) return;
      s.geometry = null;
      renderSectionEditor();
      showEditPreview();
    });

    bodyEl.querySelector("#saveSectionBtn").addEventListener("click", saveSection);
    const del = bodyEl.querySelector("#deleteSectionBtn");
    if (del) del.addEventListener("click", deleteSection);

    const newPlan = bodyEl.querySelector("#newPlanBtn");
    if (newPlan) newPlan.addEventListener("click", () => openPlanEditor(null));
    bodyEl.querySelectorAll("[data-plan]").forEach((el) =>
      el.addEventListener("click", () => openPlanEditor(el.dataset.plan))
    );
  }

  async function saveSection() {
    const s = A.editing;
    if (!s.name.trim() || !s.code.trim()) {
      return CMap.toast("A section needs at least a name and a unique code.", "err");
    }
    try {
      const saved = await CMap.saveSection({
        id: s.id,
        code: s.code,
        name: s.name,
        description: s.description || "",
        color: s.color,
        sort_order: s.sort_order,
        geometry: s.geometry,
      });
      await refreshData();
      CMap.toast("Section saved.", "ok");
      openSectionEditor(saved.id);
    } catch (err) {
      CMap.toast(err.message, "err");
    }
  }

  async function deleteSection() {
    const s = A.editing;
    const ok = await CMap.confirm(
      "Delete section",
      `Delete "${s.name}" and ALL its contingency plans? This cannot be undone.`,
      "Delete section"
    );
    if (!ok) return;
    try {
      await CMap.deleteSection(s.id);
      await refreshData();
      CMap.toast("Section deleted.", "ok");
      showSectionList();
    } catch (err) {
      CMap.toast(err.message, "err");
    }
  }

  // Preview of the section being edited (so unsaved geometry is visible)
  let editPreviewLayer = null;

  function clearEditPreview() {
    if (editPreviewLayer) { map.removeLayer(editPreviewLayer); editPreviewLayer = null; }
  }

  function showEditPreview() {
    clearEditPreview();
    const s = A.editing;
    if (!s || !s.geometry) return;
    editPreviewLayer = L.geoJSON({ type: "Feature", geometry: s.geometry }, {
      style: { color: s.color || "#c2410c", weight: 7, opacity: 0.95, dashArray: "6 6", fillOpacity: 0.25 },
      interactive: false,
    }).addTo(map);
  }

  function zoomToGeometry(geom) {
    try {
      const b = L.geoJSON({ type: "Feature", geometry: geom }).getBounds();
      if (b.isValid()) map.fitBounds(b, { padding: [60, 60] });
    } catch { /* ignore */ }
  }

  // =====================================================================
  // Drawing & railway tracing
  // =====================================================================

  const draw = {
    mode: null,        // 'trace' | 'line' | 'area'
    coords: [],        // [[lat,lng], ...]
    legs: [],          // number of coords appended per trace click (for undo)
    anchorNodeId: null,
    previewLayer: null,
    guideLayer: null,
  };

  const rail = {
    nodes: new Map(),  // osm node id -> [lat, lng]
    adj: new Map(),    // node id -> [{to, w}]
    ways: [],          // [[latlng, ...], ...] one per OSM way, for the guide layer
    seenWays: new Set(),
    loading: false,
  };

  A.isDrawing = () => !!draw.mode;

  const drawBar = document.getElementById("drawBar");
  const drawBarText = document.getElementById("drawBarText");
  document.getElementById("drawUndoBtn").addEventListener("click", undoDraw);
  document.getElementById("drawDoneBtn").addEventListener("click", finishDraw);
  document.getElementById("drawCancelBtn").addEventListener("click", cancelDraw);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && draw.mode) cancelDraw();
  });

  function setDrawBar(text) {
    drawBarText.textContent = text;
    drawBar.classList.remove("hidden");
  }

  async function startDraw(mode) {
    cancelDraw();
    draw.mode = mode;
    draw.coords = [];
    draw.legs = [];
    draw.anchorNodeId = null;

    // Continue an existing route line from its end when tracing/drawing a line
    const g = A.editing && A.editing.geometry;
    if ((mode === "trace" || mode === "line") && g && g.type === "LineString") {
      draw.coords = g.coordinates.map(([lng, lat]) => [lat, lng]);
    }

    document.getElementById("map").classList.add("drawing");
    map.doubleClickZoom.disable();
    map.on("click", onDrawClick);

    if (mode === "trace") {
      setDrawBar("Trace: click on the railway where the section starts, then click along it. Each click follows the track.");
      showGuideLayer();
      if (!rail.nodes.size) await loadRailsInView();
    } else if (mode === "line") {
      setDrawBar("Draw line: click to add points. Done to finish.");
    } else {
      setDrawBar("Draw area: click the corners of the area (e.g. around a station). Done to finish.");
    }
    updateDrawPreview();
  }

  function stopDrawing() {
    map.off("click", onDrawClick);
    map.doubleClickZoom.enable();
    document.getElementById("map").classList.remove("drawing");
    drawBar.classList.add("hidden");
    if (draw.previewLayer) { map.removeLayer(draw.previewLayer); draw.previewLayer = null; }
    hideGuideLayer();
    draw.mode = null;
  }

  function cancelDraw() {
    if (!draw.mode) return;
    stopDrawing();
    showEditPreview();
  }

  function finishDraw() {
    const mode = draw.mode;
    if (!mode) return;
    const s = A.editing;

    if (mode === "area") {
      if (draw.coords.length < 3) return CMap.toast("An area needs at least 3 corners.", "err");
      const ring = draw.coords.map(([lat, lng]) => [lng, lat]);
      ring.push(ring[0]);
      s.geometry = { type: "Polygon", coordinates: [ring] };
    } else {
      if (draw.coords.length < 2) return CMap.toast("A line needs at least 2 points.", "err");
      s.geometry = {
        type: "LineString",
        coordinates: draw.coords.map(([lat, lng]) => [lng, lat]),
      };
    }

    stopDrawing();
    renderSectionEditor();
    showEditPreview();
    CMap.toast("Geometry updated — press “Save section” to keep it.", "ok");
  }

  function undoDraw() {
    if (!draw.mode) return;
    if (draw.mode === "trace" && draw.legs.length) {
      const n = draw.legs.pop();
      draw.coords.length = Math.max(0, draw.coords.length - n);
      draw.anchorNodeId = draw.coords.length
        ? nearestNodeToLatLng(draw.coords[draw.coords.length - 1], 100)
        : null;
    } else {
      draw.coords.pop();
    }
    updateDrawPreview();
  }

  function updateDrawPreview() {
    if (draw.previewLayer) { map.removeLayer(draw.previewLayer); draw.previewLayer = null; }
    if (!draw.coords.length) return;

    const color = (A.editing && A.editing.color) || "#c2410c";
    const group = L.layerGroup();

    if (draw.mode === "area" && draw.coords.length >= 3) {
      group.addLayer(L.polygon(draw.coords, { color, weight: 4, fillOpacity: 0.25 }));
    } else {
      group.addLayer(L.polyline(draw.coords, { color, weight: 5, opacity: 0.95 }));
    }
    // start & end markers
    group.addLayer(L.circleMarker(draw.coords[0], { radius: 5, color: "#0f172a", fillColor: "#fff", fillOpacity: 1, weight: 2 }));
    if (draw.coords.length > 1) {
      group.addLayer(L.circleMarker(draw.coords[draw.coords.length - 1], { radius: 5, color, fillColor: "#fff", fillOpacity: 1, weight: 2 }));
    }
    draw.previewLayer = group.addTo(map);
  }

  async function onDrawClick(e) {
    if (draw.mode === "line" || draw.mode === "area") {
      draw.coords.push([e.latlng.lat, e.latlng.lng]);
      updateDrawPreview();
      return;
    }
    if (draw.mode !== "trace") return;

    if (!rail.nodes.size) {
      CMap.toast("No railway data loaded here yet — loading now…");
      await loadRailsInView();
      if (!rail.nodes.size) return;
    }

    const nodeId = nearestNodeToPoint(e.latlng, 30);
    if (nodeId == null) {
      CMap.toast("Click closer to a railway line (blue guide). If none is shown here, pan/zoom and it will load.", "err");
      await loadRailsInView(true);
      return;
    }

    if (!draw.coords.length) {
      draw.coords.push(rail.nodes.get(nodeId));
      draw.anchorNodeId = nodeId;
      draw.legs = [];
      updateDrawPreview();
      return;
    }

    let from = draw.anchorNodeId;
    if (from == null) from = nearestNodeToLatLng(draw.coords[draw.coords.length - 1], 150);
    if (from == null) {
      CMap.toast("Couldn't join up with the end of the existing line — use Undo/Clear, or draw manually.", "err");
      return;
    }

    const path = shortestPath(from, nodeId);
    if (!path || path.length < 2) {
      CMap.toast("No connected railway found between those points — try shorter hops, or load more track by panning.", "err");
      return;
    }

    let added = 0;
    for (let i = 1; i < path.length; i++) {
      draw.coords.push(rail.nodes.get(path[i]));
      added++;
    }
    draw.legs.push(added);
    draw.anchorNodeId = nodeId;
    updateDrawPreview();
  }

  // ----- OSM railway network via Overpass -----

  const OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
  ];

  async function loadRailsInView(quiet) {
    if (rail.loading) return;
    if (map.getZoom() < 11) {
      CMap.toast("Zoom in a bit more before loading the railway layout (too large an area).", "err");
      return;
    }
    rail.loading = true;
    if (!quiet) setDrawBar("Loading real railway layout from OpenStreetMap…");

    const b = map.getBounds().pad(0.15);
    const bbox = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()]
      .map((v) => v.toFixed(5)).join(",");
    const query = `[out:json][timeout:30];way["railway"~"^(rail|light_rail|subway|narrow_gauge)$"](${bbox});(._;>;);out body;`;

    let data = null, lastErr = null;
    for (const url of OVERPASS_ENDPOINTS) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "data=" + encodeURIComponent(query),
        });
        if (!res.ok) throw new Error("Overpass returned " + res.status);
        data = await res.json();
        break;
      } catch (err) { lastErr = err; }
    }

    rail.loading = false;

    if (!data) {
      CMap.toast("Couldn't load railway data (OpenStreetMap busy?): " + (lastErr && lastErr.message) + " — you can still Draw line manually.", "err");
      if (draw.mode === "trace") setDrawBar("Trace: railway data unavailable right now — try again, or use Draw line.");
      return;
    }

    let newNodes = 0, newWays = 0;
    (data.elements || []).forEach((el) => {
      if (el.type === "node" && !rail.nodes.has(el.id)) {
        rail.nodes.set(el.id, [el.lat, el.lon]);
        newNodes++;
      }
    });
    (data.elements || []).forEach((el) => {
      if (el.type !== "way" || !Array.isArray(el.nodes) || rail.seenWays.has(el.id)) return;
      rail.seenWays.add(el.id);
      newWays++;
      const wayCoords = [];
      for (let i = 0; i < el.nodes.length - 1; i++) {
        const a = el.nodes[i], b2 = el.nodes[i + 1];
        const pa = rail.nodes.get(a), pb = rail.nodes.get(b2);
        if (!pa || !pb) continue;
        const w = haversine(pa, pb);
        addEdge(a, b2, w);
        addEdge(b2, a, w);
        if (!wayCoords.length) wayCoords.push(pa);
        wayCoords.push(pb);
      }
      if (wayCoords.length > 1) rail.ways.push(wayCoords);
    });

    refreshGuideLayer();
    if (draw.mode === "trace") {
      setDrawBar("Trace: click on the railway where the section starts, then click along it. Each click follows the track.");
      if (!quiet) CMap.toast(`Railway layout loaded (${newWays} tracks in view).`, "ok");
    }
  }

  function addEdge(a, b, w) {
    let list = rail.adj.get(a);
    if (!list) { list = []; rail.adj.set(a, list); }
    list.push({ to: b, w });
  }

  function haversine(a, b) {
    const R = 6371000, rad = Math.PI / 180;
    const dLat = (b[0] - a[0]) * rad, dLng = (b[1] - a[1]) * rad;
    const q = Math.sin(dLat / 2) ** 2 +
      Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(q));
  }

  function nearestNodeToPoint(latlng, maxPx) {
    const clickPt = map.latLngToContainerPoint(latlng);
    const view = map.getBounds().pad(0.2);
    let best = null, bestD = Infinity;
    rail.nodes.forEach((pos, id) => {
      if (!view.contains(pos)) return;
      const pt = map.latLngToContainerPoint(pos);
      const dx = pt.x - clickPt.x, dy = pt.y - clickPt.y;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = id; }
    });
    return best != null && Math.sqrt(bestD) <= maxPx ? best : null;
  }

  function nearestNodeToLatLng(latlngArr, maxMeters) {
    let best = null, bestD = Infinity;
    rail.nodes.forEach((pos, id) => {
      const d = haversine(latlngArr, pos);
      if (d < bestD) { bestD = d; best = id; }
    });
    return best != null && bestD <= maxMeters ? best : null;
  }

  // Dijkstra over the loaded rail network
  function shortestPath(from, to) {
    if (from === to) return [from];
    const dist = new Map([[from, 0]]);
    const prev = new Map();
    const heap = new MinHeap();
    heap.push(0, from);

    while (heap.size()) {
      const [d, u] = heap.pop();
      if (u === to) break;
      if (d > (dist.get(u) ?? Infinity)) continue;
      const edges = rail.adj.get(u);
      if (!edges) continue;
      for (const { to: v, w } of edges) {
        const nd = d + w;
        if (nd < (dist.get(v) ?? Infinity)) {
          dist.set(v, nd);
          prev.set(v, u);
          heap.push(nd, v);
        }
      }
    }

    if (!prev.has(to)) return null;
    const path = [to];
    let cur = to;
    while (cur !== from) { cur = prev.get(cur); path.push(cur); }
    return path.reverse();
  }

  function MinHeap() {
    const a = [];
    this.size = () => a.length;
    this.push = (k, v) => {
      a.push([k, v]);
      let i = a.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (a[p][0] <= a[i][0]) break;
        [a[p], a[i]] = [a[i], a[p]]; i = p;
      }
    };
    this.pop = () => {
      const top = a[0], last = a.pop();
      if (a.length) {
        a[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < a.length && a[l][0] < a[m][0]) m = l;
          if (r < a.length && a[r][0] < a[m][0]) m = r;
          if (m === i) break;
          [a[m], a[i]] = [a[i], a[m]]; i = m;
        }
      }
      return top;
    };
  }

  // Guide layer: the loaded railway shown as snappable blue lines while tracing
  const guideRenderer = L.canvas({ padding: 0.3 });

  function refreshGuideLayer() {
    if (!draw.guideLayer) return;
    draw.guideLayer.clearLayers();
    rail.ways.forEach((coords) => {
      draw.guideLayer.addLayer(
        L.polyline(coords, {
          color: "#2563eb", weight: 2, opacity: 0.55,
          interactive: false, renderer: guideRenderer,
        })
      );
    });
  }

  function showGuideLayer() {
    if (!draw.guideLayer) draw.guideLayer = L.layerGroup();
    draw.guideLayer.addTo(map);
    refreshGuideLayer();
  }

  function hideGuideLayer() {
    if (draw.guideLayer) map.removeLayer(draw.guideLayer);
  }

  // =====================================================================
  // View: plan editor
  // =====================================================================

  const SEVERITIES = ["", "High", "Medium", "Low"];

  function openPlanEditor(planId) {
    cancelDraw();
    const section = A.editing;
    const existing = planId ? (section.plans || []).find((p) => p.id === planId) : null;

    A.editingPlan = existing
      ? JSON.parse(JSON.stringify(existing))
      : {
          id: null, section_id: section.id, plan_code: "", title: "", severity: "",
          scenario_group: "", scenario_label: "", owner_team: "", summary: "",
          assumptions: "", constraints: "", steps: [], docs: [], sort_order: 100,
        };
    if (!Array.isArray(A.editingPlan.steps)) A.editingPlan.steps = [];
    if (!Array.isArray(A.editingPlan.docs)) A.editingPlan.docs = [];

    renderPlanEditor();
  }

  function renderPlanEditor() {
    const p = A.editingPlan;
    const section = A.editing;
    titleEl.textContent = p.id ? "Edit plan" : "New plan";
    metaEl.textContent = `${section.name} (${section.code})`;

    const groups = [...new Set((section.plans || []).map((x) => x.scenario_group).filter(Boolean))];

    bodyEl.innerHTML = `
      <button class="back-link" id="backToSection">← ${esc(section.name)}</button>

      <div class="field-row">
        <div class="field"><label>Plan code</label>
          <input type="text" id="pCode" value="${esc(p.plan_code)}" placeholder="e.g. MML-6" /></div>
        <div class="field" style="flex:0 0 130px"><label>Severity</label>
          <select id="pSev">${SEVERITIES.map((s) =>
            `<option value="${s}" ${p.severity === s ? "selected" : ""}>${s || "—"}</option>`).join("")}
          </select></div>
      </div>
      <div class="field"><label>Title</label>
        <input type="text" id="pTitle" value="${esc(p.title)}" placeholder="e.g. MML-6 – St Albans to Radlett (Full Block)" /></div>

      <div class="field"><label>Scenario group <span style="text-transform:none; font-weight:500">(how choices are grouped when this section has several plans)</span></label>
        <input type="text" id="pGroup" value="${esc(p.scenario_group)}" list="groupList" placeholder="e.g. Full block / Reduced capacity" />
        <datalist id="groupList">${groups.map((g) => `<option value="${esc(g)}">`).join("")}</datalist></div>
      <div class="field"><label>Scenario label <span style="text-transform:none; font-weight:500">(the button text users pick)</span></label>
        <input type="text" id="pLabel" value="${esc(p.scenario_label)}" placeholder="e.g. St Albans → Radlett" /></div>

      <div class="field-row">
        <div class="field"><label>Owner team</label>
          <input type="text" id="pOwner" value="${esc(p.owner_team)}" placeholder="e.g. TRC WH / GTR Control" /></div>
        <div class="field" style="flex:0 0 110px"><label>Sort</label>
          <input type="number" id="pSort" value="${esc(p.sort_order)}" /></div>
      </div>

      <div class="field"><label>Summary</label><textarea id="pSummary">${esc(p.summary)}</textarea></div>
      <div class="field"><label>Assumptions</label><textarea id="pAssump">${esc(p.assumptions)}</textarea></div>
      <div class="field"><label>Constraints</label><textarea id="pConstr">${esc(p.constraints)}</textarea></div>

      <div class="section-divider">Documents / links</div>
      <div id="docsWrap"></div>
      <button class="btn btn-sm" id="addDocBtn">+ Add link</button>

      <div class="section-divider">Steps (${p.steps.length})</div>
      <div id="stepsWrap"></div>
      <div class="btn-row" style="margin-top:6px">
        <button class="btn btn-sm" id="addStepBtn">+ Add step</button>
        <button class="btn btn-sm" id="bulkStepsBtn" title="Paste many steps at once, one per line">📋 Bulk paste steps</button>
      </div>

      <div class="btn-row">
        <button class="btn btn-primary" id="savePlanBtn">Save plan</button>
        ${p.id ? `<button class="btn btn-danger" id="deletePlanBtn">Delete plan</button>` : ""}
      </div>
    `;

    bodyEl.querySelector("#backToSection").addEventListener("click", () => renderSectionEditor());

    const bind = (sel, key, isNum) => {
      bodyEl.querySelector(sel).addEventListener("input", (e) => {
        p[key] = isNum ? Number(e.target.value || 0) : e.target.value;
      });
    };
    bind("#pCode", "plan_code");
    bind("#pSev", "severity");
    bind("#pTitle", "title");
    bind("#pGroup", "scenario_group");
    bind("#pLabel", "scenario_label");
    bind("#pOwner", "owner_team");
    bind("#pSort", "sort_order", true);
    bind("#pSummary", "summary");
    bind("#pAssump", "assumptions");
    bind("#pConstr", "constraints");

    renderDocsEditor();
    renderStepsEditor();

    bodyEl.querySelector("#addDocBtn").addEventListener("click", () => {
      p.docs.push({ label: "", url: "" });
      renderDocsEditor();
    });
    bodyEl.querySelector("#addStepBtn").addEventListener("click", () => {
      p.steps.push({ step_type: "Action", title: "", detail: "", owner_role: "" });
      renderStepsEditor();
      const wrap = bodyEl.querySelector("#stepsWrap");
      wrap.lastElementChild?.scrollIntoView({ block: "nearest" });
    });
    bodyEl.querySelector("#bulkStepsBtn").addEventListener("click", bulkPasteSteps);

    bodyEl.querySelector("#savePlanBtn").addEventListener("click", savePlan);
    const del = bodyEl.querySelector("#deletePlanBtn");
    if (del) del.addEventListener("click", deletePlanCurrent);
  }

  function renderDocsEditor() {
    const p = A.editingPlan;
    const wrap = bodyEl.querySelector("#docsWrap");
    wrap.innerHTML = p.docs.map((d, i) => `
      <div class="step-row" data-doc="${i}">
        <div class="field-row">
          <div class="field"><label>Label</label><input type="text" data-k="label" value="${esc(d.label)}" /></div>
          <div class="field"><label>URL</label><input type="url" data-k="url" value="${esc(d.url)}" /></div>
        </div>
        <button class="btn btn-sm btn-danger" data-del="${i}">Remove</button>
      </div>`).join("");

    wrap.querySelectorAll("[data-doc] input").forEach((input) => {
      input.addEventListener("input", (e) => {
        const i = Number(e.target.closest("[data-doc]").dataset.doc);
        p.docs[i][e.target.dataset.k] = e.target.value;
      });
    });
    wrap.querySelectorAll("[data-del]").forEach((btn) => {
      btn.addEventListener("click", () => {
        p.docs.splice(Number(btn.dataset.del), 1);
        renderDocsEditor();
      });
    });
  }

  function renderStepsEditor() {
    const p = A.editingPlan;
    const wrap = bodyEl.querySelector("#stepsWrap");
    wrap.innerHTML = p.steps.map((s, i) => `
      <div class="step-row" data-step="${i}">
        <div class="step-row-head">
          <span>STEP ${i + 1}</span>
          <span class="btns">
            <button class="btn btn-sm" data-move="up" ${i === 0 ? "disabled" : ""}>↑</button>
            <button class="btn btn-sm" data-move="down" ${i === p.steps.length - 1 ? "disabled" : ""}>↓</button>
            <button class="btn btn-sm btn-danger" data-remove>✕</button>
          </span>
        </div>
        <div class="field-row">
          <div class="field" style="flex:0 0 120px"><label>Type</label>
            <input type="text" data-k="step_type" value="${esc(s.step_type)}" placeholder="Action" /></div>
          <div class="field"><label>Title</label>
            <input type="text" data-k="title" value="${esc(s.title)}" /></div>
        </div>
        <div class="field"><label>Detail</label><textarea data-k="detail" style="min-height:48px">${esc(s.detail)}</textarea></div>
        <div class="field"><label>Owner role (optional)</label>
          <input type="text" data-k="owner_role" value="${esc(s.owner_role || "")}" /></div>
      </div>`).join("");

    wrap.querySelectorAll("[data-step]").forEach((row) => {
      const i = Number(row.dataset.step);
      row.querySelectorAll("input,textarea").forEach((input) => {
        input.addEventListener("input", (e) => { p.steps[i][e.target.dataset.k] = e.target.value; });
      });
      row.querySelector("[data-remove]").addEventListener("click", () => {
        p.steps.splice(i, 1);
        renderStepsEditor();
      });
      row.querySelectorAll("[data-move]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const j = btn.dataset.move === "up" ? i - 1 : i + 1;
          if (j < 0 || j >= p.steps.length) return;
          [p.steps[i], p.steps[j]] = [p.steps[j], p.steps[i]];
          renderStepsEditor();
        });
      });
    });

    const divider = [...bodyEl.querySelectorAll(".section-divider")]
      .find((el) => el.textContent.startsWith("Steps"));
    if (divider) divider.textContent = `Steps (${p.steps.length})`;
  }

  function bulkPasteSteps() {
    const p = A.editingPlan;
    const body = document.createElement("div");
    body.innerHTML = `
      <div class="small" style="margin-bottom:8px">
        One step per line. Optionally split fields with a pipe:<br />
        <b>Type | Title | Detail | Owner</b> — e.g.<br />
        <code>Trains | Cancel 9K group | Between St Albans and Radlett | GTR Control</code><br />
        A line without pipes becomes an “Action” step title.
      </div>
      <div class="field"><textarea id="bulkText" style="min-height:160px" placeholder="Paste steps here…"></textarea></div>
      <div class="btn-row"><button class="btn btn-primary" id="bulkGo">Add steps</button></div>
    `;
    const m = CMap.modal({ title: "Bulk paste steps", body });
    body.querySelector("#bulkGo").addEventListener("click", () => {
      const lines = body.querySelector("#bulkText").value.split("\n")
        .map((l) => l.trim()).filter(Boolean);
      lines.forEach((line) => {
        const parts = line.split("|").map((x) => x.trim());
        if (parts.length === 1) {
          p.steps.push({ step_type: "Action", title: parts[0], detail: "", owner_role: "" });
        } else {
          p.steps.push({
            step_type: parts[0] || "Action",
            title: parts[1] || "",
            detail: parts[2] || "",
            owner_role: parts[3] || "",
          });
        }
      });
      m.close();
      renderStepsEditor();
      CMap.toast(`Added ${lines.length} step${lines.length === 1 ? "" : "s"}.`, "ok");
    });
  }

  async function savePlan() {
    const p = A.editingPlan;
    if (!p.title.trim()) return CMap.toast("The plan needs a title.", "err");
    try {
      await CMap.savePlan(p);
      await refreshData();
      // re-open the refreshed section so the plan list is current
      const sectionId = A.editing.id;
      A.editing = JSON.parse(JSON.stringify(CMap.state.sections.find((s) => s.id === sectionId)));
      CMap.toast("Plan saved.", "ok");
      renderSectionEditor();
      showEditPreview();
    } catch (err) {
      CMap.toast(err.message, "err");
    }
  }

  // Introspection hook for automated testing/debugging of the trace tool.
  A._debug = () => ({
    nodes: rail.nodes.size,
    ways: rail.ways.length,
    drawMode: draw.mode,
    coords: draw.coords.length,
    nearestNodePoint(lat, lng) {
      const id = nearestNodeToLatLng([lat, lng], 5000);
      if (id == null) return null;
      const pt = map.latLngToContainerPoint(rail.nodes.get(id));
      return { x: pt.x, y: pt.y };
    },
  });

  async function deletePlanCurrent() {
    const p = A.editingPlan;
    const ok = await CMap.confirm("Delete plan", `Delete plan "${p.title}"? This cannot be undone.`, "Delete plan");
    if (!ok) return;
    try {
      await CMap.deletePlan(p.id);
      await refreshData();
      const sectionId = A.editing.id;
      A.editing = JSON.parse(JSON.stringify(CMap.state.sections.find((s) => s.id === sectionId)));
      CMap.toast("Plan deleted.", "ok");
      renderSectionEditor();
      showEditPreview();
    } catch (err) {
      CMap.toast(err.message, "err");
    }
  }
})();
