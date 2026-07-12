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
          <span class="li-sub">${esc(p.title !== (p.plan_code || p.title) ? p.title : "")}</span>
        </span>
        ${p.scenario_group ? `<span class="badge">${esc(p.scenario_group)}</span>` : ""}
      </button>`).join("");

    bodyEl.innerHTML = `
      <button class="back-link" id="backToList">← All sections</button>

      <div class="field"><label>Name</label>
        <input type="text" id="fName" value="${esc(s.name)}" placeholder="e.g. Luton – Bedford" /></div>
      <div class="field-row">
        <div class="field" style="flex:0 0 70px"><label>Colour</label>
          <input type="color" id="fColor" value="${esc(s.color || "#c2410c")}" /></div>
        <div class="field"><label>Notes / description</label>
          <input type="text" id="fDesc" value="${esc(s.description || "")}" /></div>
      </div>

      <div class="section-divider">Map geometry</div>
      <div class="geom-status" id="geomStatus">${geometrySummary(s.geometry)}</div>

      <div class="small" style="margin:12px 0 4px"><b>Route between two locations</b> — the easy way:</div>
      <div class="field-row">
        <div class="field loc-field">
          <input type="text" id="locA" placeholder="From… e.g. St Albans City" autocomplete="off" />
          <div class="loc-results hidden" id="locAres"></div>
        </div>
        <div class="field loc-field">
          <input type="text" id="locB" placeholder="To… e.g. Radlett Junction" autocomplete="off" />
          <div class="loc-results hidden" id="locBres"></div>
        </div>
      </div>
      <button class="btn btn-sm" id="autoRouteBtn" disabled>⚡ Create route between locations</button>

      <div class="small" style="margin:12px 0 4px"><b>Or draw on the map:</b></div>
      <div class="tool-grid">
        <button class="btn btn-sm" id="toolTrace" title="Click along the railway — the route follows the actual track">🛤 Trace railway</button>
        <button class="btn btn-sm" id="toolLine" title="Click points to draw a line by hand">✏️ Draw line</button>
        <button class="btn btn-sm" id="toolArea" title="Click corners to draw an area (e.g. a station)">⬠ Draw area</button>
        <button class="btn btn-sm btn-danger" id="toolClear">Clear</button>
      </div>
      <div class="small" style="margin-top:8px">
        Pick a station/junction in each box and the section is routed along the official Network Rail
        track automatically. <b>Trace railway</b> does the same via map clicks — each click snaps to
        the track and follows it (then extend/trim with more clicks or Undo).
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
    bind("#fColor", "color");
    bind("#fDesc", "description");

    setupLocationRouting();

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

  function generateCode(name) {
    const base = name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24) || "SECTION";
    const taken = new Set(CMap.state.sections.filter((x) => x.id !== A.editing.id).map((x) => x.code));
    let code = base, n = 2;
    while (taken.has(code)) code = base + "_" + n++;
    return code;
  }

  async function saveSection() {
    const s = A.editing;
    if (!s.name.trim()) {
      return CMap.toast("Give the section a name first.", "err");
    }
    // double-taps on a slow connection must not create duplicate sections
    const btn = bodyEl.querySelector("#saveSectionBtn");
    if (btn) { if (btn.disabled) return; btn.disabled = true; btn.textContent = "Saving…"; }
    try {
      const saved = await CMap.saveSection({
        id: s.id,
        code: (s.code || "").trim() || generateCode(s.name),
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
      if (btn) { btn.disabled = false; btn.textContent = "Save section"; }
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

    const btn = bodyEl.querySelector("#deleteSectionBtn");
    if (btn) { btn.disabled = true; btn.textContent = "Deleting…"; }

    try {
      const deleted = await CMap.deleteSection(s.id);
      if (deleted === false) {
        throw new Error("The server couldn't find that section — reload the page and try again.");
      }

      // Scrub every trace locally straight away, even if the reload below fails:
      // map line, open viewer panel, edit preview.
      CMap.state.sections = CMap.state.sections.filter((x) => x.id !== s.id);
      CMap.renderSections();
      if (CMap.closeViewerFor) CMap.closeViewerFor(s.id);
      clearEditPreview();
      try { await refreshData(); } catch { /* local state is already correct */ }

      CMap.toast("Section deleted.", "ok");
      showSectionList();
    } catch (err) {
      if (btn) { btn.disabled = false; btn.textContent = "Delete"; }
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
    nodes: new Map(),   // node key "lng,lat" -> [lat, lng]
    adj: new Map(),     // node key -> [{to, w}]
    ways: [],           // [[latlng, ...], ...] one per NR segment, for the guide layer
    seenSegs: new Set(),
    loadedTiles: new Set(),
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

    // On phones the panel covers the whole screen — get it out of the way while drawing
    if (window.matchMedia("(max-width: 760px)").matches) panel.classList.remove("open");

    if (mode === "trace") {
      setDrawBar("Trace: click on the railway where the section starts, then click along it. Each click follows the track.");
      showGuideLayer();
      map.on("moveend", onTraceMove); // fetch more track tiles as the user pans
      await loadRailsInView();
    } else if (mode === "line") {
      setDrawBar("Draw line: click to add points. Done to finish.");
    } else {
      setDrawBar("Draw area: click the corners of the area (e.g. around a station). Done to finish.");
    }
    updateDrawPreview();
  }

  function onTraceMove() {
    if (draw.mode === "trace") loadRailsInView(true);
  }

  function stopDrawing() {
    map.off("click", onDrawClick);
    map.off("moveend", onTraceMove);
    map.doubleClickZoom.enable();
    document.getElementById("map").classList.remove("drawing");
    drawBar.classList.add("hidden");
    if (draw.previewLayer) { map.removeLayer(draw.previewLayer); draw.previewLayer = null; }
    hideGuideLayer();
    draw.mode = null;
    if (A.active) panel.classList.add("open"); // bring the admin panel back (mobile)
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
      CMap.toast("No track data loaded here yet — loading now…");
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

  // ----- Network Rail track centre-line network (local tiles from the NR data pack) -----

  const TILE_SIZE = 0.5; // degrees; must match the build pipeline

  function nodeKey(lng, lat) { return lng + "," + lat; }

  function integrateSegment(seg) {
    const [aid, , , , , coords] = seg;
    if (rail.seenSegs.has(aid) || coords.length < 2) return;
    rail.seenSegs.add(aid);

    const latlngs = [];
    let prevKey = null, prevPos = null;
    coords.forEach(([lng, lat]) => {
      const key = nodeKey(lng, lat);
      const pos = [lat, lng];
      if (!rail.nodes.has(key)) rail.nodes.set(key, pos);
      if (prevKey !== null && prevKey !== key) {
        const w = haversine(prevPos, pos);
        addEdge(prevKey, key, w);
        addEdge(key, prevKey, w);
      }
      prevKey = key; prevPos = pos;
      latlngs.push(pos);
    });
    rail.ways.push(latlngs);
  }

  async function loadTilesByKeys(keys) {
    const need = keys.filter((k) => !rail.loadedTiles.has(k));
    if (!need.length) return { newSegs: 0, failed: 0 };

    let newSegs = 0, failed = 0;
    await Promise.all(need.map(async (k) => {
      try {
        const res = await fetch(`./assets/data/cl/${k}.json`, { cache: "force-cache" });
        if (res.status === 404) { rail.loadedTiles.add(k); return; } // sea / no rail here
        if (!res.ok) throw new Error("tile " + k + " -> " + res.status);
        const data = await res.json();
        (data.segs || []).forEach((seg) => { integrateSegment(seg); newSegs++; });
        rail.loadedTiles.add(k);
      } catch (err) { failed++; }
    }));
    return { newSegs, failed };
  }

  function tileKey(lng, lat) {
    return Math.floor(lng / TILE_SIZE) + "_" + Math.floor(lat / TILE_SIZE);
  }

  async function loadRailsInView(quiet) {
    if (rail.loading) return;
    if (map.getZoom() < 10) {
      if (!quiet) CMap.toast("Zoom in a bit more before loading the track layout (too large an area).", "err");
      return;
    }

    const b = map.getBounds().pad(0.1);
    const keys = [];
    for (let tx = Math.floor(b.getWest() / TILE_SIZE); tx <= Math.floor(b.getEast() / TILE_SIZE); tx++) {
      for (let ty = Math.floor(b.getSouth() / TILE_SIZE); ty <= Math.floor(b.getNorth() / TILE_SIZE); ty++) {
        keys.push(tx + "_" + ty);
      }
    }

    rail.loading = true;
    if (!quiet && draw.mode === "trace") setDrawBar("Loading Network Rail track layout…");
    const { newSegs, failed } = await loadTilesByKeys(keys);
    rail.loading = false;
    refreshGuideLayer();

    if (draw.mode === "trace") {
      setDrawBar("Trace: click on the railway where the section starts, then click along it. Each click follows the track.");
      if (failed) CMap.toast("Some track data failed to load — pan slightly to retry, or use Draw line.", "err");
      else if (!quiet && newSegs) CMap.toast(`Network Rail track layout loaded (${newSegs} track segments).`, "ok");
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

  // ----- Route between two named locations (stations/junctions) -----

  function setupLocationRouting() {
    const sel = { A: null, B: null };
    const btn = bodyEl.querySelector("#autoRouteBtn");
    if (!btn) return;

    // warm the dataset so the first keystroke already filters
    CMap.loadLocations().catch(() => {});

    [["A", "#locA", "#locAres"], ["B", "#locB", "#locBres"]].forEach(([key, inputSel, resSel]) => {
      const input = bodyEl.querySelector(inputSel);
      const results = bodyEl.querySelector(resSel);
      let t = null;
      let current = []; // matches shown right now

      function choose(l) {
        sel[key] = l;
        input.value = l.name;
        input.classList.remove("loc-invalid");
        results.classList.add("hidden");
        btn.disabled = !(sel.A && sel.B);
      }

      async function refresh() {
        const q = input.value.trim().toLowerCase();
        if (!q) { results.classList.add("hidden"); input.classList.remove("loc-invalid"); return; }
        let locs;
        try { locs = await CMap.loadLocations(); }
        catch (err) { return CMap.toast("Locations data could not be loaded: " + err.message, "err"); }

        current = locs
          .filter((l) => l.name.toLowerCase().includes(q) || (l.crs && l.crs.toLowerCase() === q))
          .sort((a, b) => {
            const ax = a.crs && a.crs.toLowerCase() === q ? 0 : a.name.toLowerCase().startsWith(q) ? 1 : 2;
            const bx = b.crs && b.crs.toLowerCase() === q ? 0 : b.name.toLowerCase().startsWith(q) ? 1 : 2;
            return ax - bx || (a.name < b.name ? -1 : 1);
          })
          .slice(0, 8);

        input.classList.toggle("loc-invalid", !current.length);
        results.innerHTML = current.length
          ? current.map((l, i) => `
              <button type="button" data-i="${i}">${esc(l.name)}
                <span class="small">${esc(l.elr || "")}${l.elr ? " · " : ""}${l.kind === "j" ? "junction" : "station"}${l.crs ? " · " + esc(l.crs) : ""}</span>
              </button>`).join("")
          : `<div class="small" style="padding:8px 11px">No matching station or junction</div>`;
        results.classList.remove("hidden");
        results.querySelectorAll("button").forEach((b) => {
          // mousedown, not click: it fires before the input's blur hides the list
          b.addEventListener("mousedown", (e) => { e.preventDefault(); choose(current[Number(b.dataset.i)]); });
        });
      }

      input.addEventListener("input", () => {
        sel[key] = null;
        btn.disabled = true;
        clearTimeout(t);
        t = setTimeout(refresh, 80);
      });
      input.addEventListener("focus", refresh);
      input.addEventListener("blur", () => setTimeout(() => results.classList.add("hidden"), 150));
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !sel[key] && current.length) { e.preventDefault(); choose(current[0]); }
        if (e.key === "Escape") results.classList.add("hidden");
      });
    });

    btn.addEventListener("click", () => autoRouteBetween(sel.A, sel.B, btn));
  }

  async function autoRouteBetween(a, b, btn) {
    if (!a || !b) return;
    const s = A.editing;
    btn.disabled = true;
    btn.textContent = "Routing along the railway…";

    try {
      // load track tiles along the straight-line corridor (plus neighbours)
      const keys = new Set();
      const steps = Math.max(2, Math.ceil(Math.max(Math.abs(a.lat - b.lat), Math.abs(a.lng - b.lng)) / 0.15));
      for (let i = 0; i <= steps; i++) {
        const lat = a.lat + (b.lat - a.lat) * i / steps;
        const lng = a.lng + (b.lng - a.lng) * i / steps;
        const tx = Math.floor(lng / TILE_SIZE), ty = Math.floor(lat / TILE_SIZE);
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) keys.add((tx + dx) + "_" + (ty + dy));
      }
      await loadTilesByKeys([...keys]);

      let na = nearestNodeToLatLng([a.lat, a.lng], 2500);
      let nb = nearestNodeToLatLng([b.lat, b.lng], 2500);
      let path = na != null && nb != null ? shortestPath(na, nb) : null;

      if (!path) {
        // the railway may swing wide of the straight line — widen to the padded bounding box
        const wide = [];
        const x0 = Math.floor((Math.min(a.lng, b.lng) - 0.5) / TILE_SIZE), x1 = Math.floor((Math.max(a.lng, b.lng) + 0.5) / TILE_SIZE);
        const y0 = Math.floor((Math.min(a.lat, b.lat) - 0.5) / TILE_SIZE), y1 = Math.floor((Math.max(a.lat, b.lat) + 0.5) / TILE_SIZE);
        for (let tx = x0; tx <= x1; tx++) for (let ty = y0; ty <= y1; ty++) wide.push(tx + "_" + ty);
        if (wide.length <= 90) {
          await loadTilesByKeys(wide);
          na = nearestNodeToLatLng([a.lat, a.lng], 2500);
          nb = nearestNodeToLatLng([b.lat, b.lng], 2500);
          path = na != null && nb != null ? shortestPath(na, nb) : null;
        }
      }

      if (!path || path.length < 2) {
        CMap.toast("Couldn't find a rail route between those locations — they may be on disconnected lines. Try Trace railway instead.", "err");
        return;
      }

      s.geometry = {
        type: "LineString",
        coordinates: path.map((k) => { const p = rail.nodes.get(k); return [p[1], p[0]]; }),
      };
      if (!s.name.trim()) s.name = `${a.name} – ${b.name}`;
      renderSectionEditor();
      showEditPreview();
      zoomToGeometry(s.geometry);
      CMap.toast(`Route created along the railway (${path.length} points). Press “Save section” to keep it.`, "ok");
    } finally {
      // if the editor re-rendered, this button is detached — resetting it is harmless
      btn.textContent = "⚡ Create route between locations";
      btn.disabled = false;
    }
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

  const SCENARIO_GROUPS = ["Full block", "Partial block", "Degraded conditions"];
  const ACTIONS = ["Suspend", "Alteration", "Normal working"];

  function openPlanEditor(planId) {
    cancelDraw();
    const section = A.editing;
    const existing = planId ? (section.plans || []).find((p) => p.id === planId) : null;

    A.editingPlan = existing
      ? JSON.parse(JSON.stringify(existing))
      : {
          id: null, section_id: section.id, plan_code: "", title: "",
          scenario_group: "", summary: "", assumptions: "", constraints: "",
          steps: [], docs: [],
        };
    if (!Array.isArray(A.editingPlan.steps)) A.editingPlan.steps = [];
    if (!Array.isArray(A.editingPlan.docs)) A.editingPlan.docs = [];
    // legacy step-format rows can't be edited in the table editor — start the table fresh
    if (A.editingPlan.steps.length && A.editingPlan.steps[0].title !== undefined) A.editingPlan.steps = [];

    renderPlanEditor();
  }

  function renderPlanEditor() {
    const p = A.editingPlan;
    const section = A.editing;
    titleEl.textContent = p.id ? "Edit plan" : "New plan";
    metaEl.textContent = section.name;

    bodyEl.innerHTML = `
      <button class="back-link" id="backToSection">← ${esc(section.name)}</button>

      <div class="field-row">
        <div class="field" style="flex:0 0 130px"><label>Plan code</label>
          <input type="text" id="pCode" value="${esc(p.plan_code)}" placeholder="e.g. MML-6" /></div>
        <div class="field"><label>Scenario</label>
          <select id="pGroup">
            <option value="" ${!p.scenario_group ? "selected" : ""}>—</option>
            ${SCENARIO_GROUPS.map((g) =>
              `<option value="${g}" ${p.scenario_group === g ? "selected" : ""}>${g}</option>`).join("")}
          </select></div>
      </div>
      <div class="field"><label>Section</label>
        <select id="pSection">
          ${CMap.state.sections.map((sec) =>
            `<option value="${esc(sec.id)}" ${sec.id === p.section_id ? "selected" : ""}>${esc(sec.name)}${sec.geometry ? "" : " (no geometry)"}</option>`).join("")}
        </select>
        <div class="small" style="margin-top:4px">Pick a different section and press “Save plan” to move this plan there — e.g. from the Plan Library onto a drawn section.</div>
      </div>
      <div class="field"><label>Title</label>
        <input type="text" id="pTitle" value="${esc(p.title)}" placeholder="e.g. St Albans to Radlett full block" /></div>

      <div class="field"><label>Summary</label><textarea id="pSummary">${esc(p.summary)}</textarea></div>
      <div class="field"><label>Assumptions</label><textarea id="pAssump">${esc(p.assumptions)}</textarea></div>
      <div class="field"><label>Constraints</label><textarea id="pConstr">${esc(p.constraints)}</textarea></div>

      <div class="section-divider">Service groups (${p.steps.length})</div>
      <div class="small" style="margin-bottom:8px">One row per service group: what happens to it under this plan.</div>
      <div id="rowsWrap"></div>
      <div class="btn-row" style="margin-top:6px">
        <button class="btn btn-sm" id="addRowBtn">+ Add service group</button>
        <button class="btn btn-sm" id="bulkRowsBtn" title="Paste many rows at once, one per line">📋 Bulk paste</button>
      </div>

      <div class="section-divider">Documents / links</div>
      <div id="docsWrap"></div>
      <button class="btn btn-sm" id="addDocBtn">+ Add link</button>

      <div class="btn-row">
        <button class="btn btn-primary" id="savePlanBtn">Save plan</button>
        ${p.id ? `<button class="btn btn-danger" id="deletePlanBtn">Delete plan</button>` : ""}
      </div>
    `;

    bodyEl.querySelector("#backToSection").addEventListener("click", () => renderSectionEditor());

    const bind = (sel, key) => {
      bodyEl.querySelector(sel).addEventListener("input", (e) => { p[key] = e.target.value; });
    };
    bind("#pCode", "plan_code");
    bind("#pSection", "section_id");
    bind("#pGroup", "scenario_group");
    bind("#pTitle", "title");
    bind("#pSummary", "summary");
    bind("#pAssump", "assumptions");
    bind("#pConstr", "constraints");

    renderDocsEditor();
    renderRowsEditor();

    bodyEl.querySelector("#addDocBtn").addEventListener("click", () => {
      p.docs.push({ label: "", url: "" });
      renderDocsEditor();
    });
    bodyEl.querySelector("#addRowBtn").addEventListener("click", () => {
      p.steps.push({ group: "", od: "", action: "Normal working", plan: "" });
      renderRowsEditor();
      const wrap = bodyEl.querySelector("#rowsWrap");
      wrap.lastElementChild?.scrollIntoView({ block: "nearest" });
      wrap.lastElementChild?.querySelector("input")?.focus();
    });
    bodyEl.querySelector("#bulkRowsBtn").addEventListener("click", bulkPasteRows);

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

  function renderRowsEditor() {
    const p = A.editingPlan;
    const wrap = bodyEl.querySelector("#rowsWrap");
    wrap.innerHTML = p.steps.map((r, i) => `
      <div class="step-row" data-row="${i}">
        <div class="step-row-head">
          <span>${esc(r.group || "SERVICE GROUP " + (i + 1))}</span>
          <span class="btns">
            <button class="btn btn-sm" data-move="up" ${i === 0 ? "disabled" : ""}>↑</button>
            <button class="btn btn-sm" data-move="down" ${i === p.steps.length - 1 ? "disabled" : ""}>↓</button>
            <button class="btn btn-sm btn-danger" data-remove>✕</button>
          </span>
        </div>
        <div class="field-row">
          <div class="field" style="flex:0 0 110px"><label>Service group</label>
            <input type="text" data-k="group" value="${esc(r.group)}" placeholder="e.g. 9K" /></div>
          <div class="field"><label>Origin / Destination</label>
            <input type="text" data-k="od" value="${esc(r.od)}" placeholder="e.g. Luton – Rainham" /></div>
        </div>
        <div class="field"><label>Action</label>
          <select data-k="action">${ACTIONS.map((a) =>
            `<option value="${a}" ${r.action === a ? "selected" : ""}>${a}</option>`).join("")}
          </select></div>
        <div class="field"><label>Plan</label>
          <textarea data-k="plan" style="min-height:48px" placeholder="What happens to this service group…">${esc(r.plan)}</textarea></div>
      </div>`).join("");

    wrap.querySelectorAll("[data-row]").forEach((row) => {
      const i = Number(row.dataset.row);
      row.querySelectorAll("input,textarea,select").forEach((input) => {
        input.addEventListener("input", (e) => { p.steps[i][e.target.dataset.k] = e.target.value; });
      });
      row.querySelector("[data-remove]").addEventListener("click", () => {
        p.steps.splice(i, 1);
        renderRowsEditor();
      });
      row.querySelectorAll("[data-move]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const j = btn.dataset.move === "up" ? i - 1 : i + 1;
          if (j < 0 || j >= p.steps.length) return;
          [p.steps[i], p.steps[j]] = [p.steps[j], p.steps[i]];
          renderRowsEditor();
        });
      });
    });

    const divider = [...bodyEl.querySelectorAll(".section-divider")]
      .find((el) => el.textContent.startsWith("Service groups"));
    if (divider) divider.textContent = `Service groups (${p.steps.length})`;
  }

  function normaliseAction(text) {
    const t = String(text || "").trim().toLowerCase();
    if (t.startsWith("s")) return "Suspend";
    if (t.startsWith("a")) return "Alteration";
    return "Normal working";
  }

  function bulkPasteRows() {
    const p = A.editingPlan;
    const body = document.createElement("div");
    body.innerHTML = `
      <div class="small" style="margin-bottom:8px">
        One service group per line, fields split with a pipe:<br />
        <b>Service group | Origin / Destination | Action | Plan</b><br />
        Action can be S, A or N (Suspend / Alteration / Normal working) — e.g.<br />
        <code>9K | Luton – Rainham | S | Suspended throughout</code>
      </div>
      <div class="field"><textarea id="bulkText" style="min-height:160px" placeholder="Paste rows here…"></textarea></div>
      <div class="btn-row"><button class="btn btn-primary" id="bulkGo">Add rows</button></div>
    `;
    const m = CMap.modal({ title: "Bulk paste service groups", body });
    body.querySelector("#bulkGo").addEventListener("click", () => {
      const lines = body.querySelector("#bulkText").value.split("\n")
        .map((l) => l.trim()).filter(Boolean);
      lines.forEach((line) => {
        const parts = line.split("|").map((x) => x.trim());
        p.steps.push({
          group: parts[0] || "",
          od: parts[1] || "",
          action: normaliseAction(parts[2]),
          plan: parts[3] || "",
        });
      });
      m.close();
      renderRowsEditor();
      CMap.toast(`Added ${lines.length} row${lines.length === 1 ? "" : "s"}.`, "ok");
    });
  }

  async function savePlan() {
    const p = A.editingPlan;
    if (!p.title.trim()) return CMap.toast("The plan needs a title.", "err");
    const btn = bodyEl.querySelector("#savePlanBtn");
    if (btn) { if (btn.disabled) return; btn.disabled = true; btn.textContent = "Saving…"; }
    try {
      await CMap.savePlan(p);
      await refreshData();
      // re-open the refreshed section so the plan list is current; if the plan
      // was moved to another section, follow it there
      const fromId = A.editing.id;
      const targetId = p.section_id || fromId;
      const target = CMap.state.sections.find((s) => s.id === targetId)
        || CMap.state.sections.find((s) => s.id === fromId);
      const moved = target.id !== fromId;
      A.editing = JSON.parse(JSON.stringify(target));
      CMap.toast(moved ? `Plan moved to “${target.name}”.` : "Plan saved.", "ok");
      renderSectionEditor();
      showEditPreview();
      if (moved && target.geometry) zoomToGeometry(target.geometry);
    } catch (err) {
      if (btn) { btn.disabled = false; btn.textContent = "Save plan"; }
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
      if (btn) { btn.disabled = false; btn.textContent = "Delete plan"; }
      CMap.toast(err.message, "err");
    }
  }
})();
