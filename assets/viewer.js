/* Contingency Map — full-screen map + plan viewer. */

(function () {
  const esc = CMap.esc;

  // ===== Map =====
  const map = L.map("map", { zoomControl: true }).setView([51.65, -0.25], 10);
  CMap.map = map;

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  // Optional detailed rail tiles (OpenRailwayMap) — off by default now that we
  // have the authoritative Network Rail network.
  const railOverlay = L.tileLayer(
    "https://{s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png",
    {
      maxZoom: 19,
      opacity: 0.85,
      attribution:
        'Rail tiles: <a href="https://www.openrailwaymap.org/">OpenRailwayMap</a> (CC-BY-SA)',
    }
  );

  document.getElementById("railOverlayToggle").addEventListener("change", (e) => {
    if (e.target.checked) railOverlay.addTo(map);
    else map.removeLayer(railOverlay);
  });

  // ===== Network Rail network overlay (from the NR Track Model data pack) =====
  // ELR route lines, rendered from a local reprojected/simplified extract.
  CMap.nr = { byCode: new Map(), layer: null, ready: null };

  CMap.nr.ready = (async function loadNR() {
    try {
      const res = await fetch("./assets/data/nwr_elrs.json", { cache: "force-cache" });
      if (!res.ok) throw new Error("nwr_elrs.json " + res.status);
      const fc = await res.json();
      fc.features.forEach((f) => CMap.nr.byCode.set(f.properties.elr, f));

      const renderer = L.canvas({ padding: 0.4 });
      CMap.nr.layer = L.geoJSON(fc, {
        style: { color: "#475569", weight: 1.6, opacity: 0.8 },
        interactive: false,
        renderer,
        attribution: "Track data: Network Rail (open data)",
      });
      if (document.getElementById("nrOverlayToggle").checked) CMap.nr.layer.addTo(map);
      return true;
    } catch (err) {
      console.warn("NR network unavailable:", err);
      CMap.toast("Network Rail overlay could not be loaded.", "err");
      return false;
    }
  })();

  document.getElementById("nrOverlayToggle").addEventListener("change", (e) => {
    if (!CMap.nr.layer) return;
    if (e.target.checked) CMap.nr.layer.addTo(map);
    else map.removeLayer(CMap.nr.layer);
  });

  // ===== Section layers =====
  const sectionLayers = L.layerGroup().addTo(map);

  function styleFor(section, hover) {
    const color = section.color || "#c2410c";
    return {
      color,
      weight: hover ? 8 : 6,
      opacity: hover ? 1 : 0.85,
      fillColor: color,
      fillOpacity: hover ? 0.45 : 0.3,
    };
  }

  CMap.renderSections = function () {
    sectionLayers.clearLayers();

    CMap.state.sections.forEach((section) => {
      if (!section.geometry || !section.geometry.type) return;

      let layer;
      try {
        // white casing under lines makes them readable over the rail overlay
        if (section.geometry.type === "LineString" || section.geometry.type === "MultiLineString") {
          const casing = L.geoJSON({ type: "Feature", geometry: section.geometry }, {
            style: { color: "#ffffff", weight: 10, opacity: 0.75 },
            interactive: false,
          });
          sectionLayers.addLayer(casing);
        }
        layer = L.geoJSON({ type: "Feature", geometry: section.geometry }, {
          style: styleFor(section, false),
        });
      } catch (err) {
        console.warn("Bad geometry on section", section.code, err);
        return;
      }

      layer.on("mouseover", () => layer.setStyle(styleFor(section, true)));
      layer.on("mouseout", () => layer.setStyle(styleFor(section, false)));
      layer.bindTooltip(section.name || section.code, { sticky: true });
      layer.on("click", () => {
        if (CMap.admin && CMap.admin.isDrawing && CMap.admin.isDrawing()) return; // let the draw tool handle it
        if (CMap.admin && CMap.admin.active) CMap.admin.openSection(section.id);
        else openViewer(section.id);
      });

      sectionLayers.addLayer(layer);
    });
  };

  CMap.fitAll = function () {
    const bounds = L.latLngBounds([]);
    CMap.state.sections.forEach((s) => {
      if (!s.geometry) return;
      try {
        bounds.extend(L.geoJSON({ type: "Feature", geometry: s.geometry }).getBounds());
      } catch { /* skip broken geometry */ }
    });
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40] });
  };

  document.getElementById("fitAllBtn").addEventListener("click", CMap.fitAll);

  // ===== Viewer panel =====
  const panel = document.getElementById("viewerPanel");
  const titleEl = document.getElementById("viewerTitle");
  const metaEl = document.getElementById("viewerMeta");
  const bodyEl = document.getElementById("viewerBody");

  document.getElementById("viewerCloseBtn").addEventListener("click", closeViewer);

  function closeViewer() {
    panel.classList.remove("open");
    panel.setAttribute("aria-hidden", "true");
  }

  function openViewer(sectionId) {
    const section = CMap.state.sections.find((s) => s.id === sectionId);
    if (!section) return;

    panel.classList.add("open");
    panel.setAttribute("aria-hidden", "false");
    titleEl.textContent = section.name;
    metaEl.textContent = section.code + (section.description ? " — " + section.description : "");

    const plans = section.plans || [];
    if (!plans.length) {
      bodyEl.innerHTML = `<div class="empty">No contingency plans have been added for this section yet.</div>`;
      return;
    }
    if (plans.length === 1) {
      renderPlanDetail(section, plans[0], false);
      return;
    }
    renderChooser(section);
  }
  CMap.openViewer = openViewer;

  function renderChooser(section) {
    const groups = new Map(); // group label -> plans
    section.plans.forEach((p) => {
      const g = p.scenario_group || "";
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(p);
    });

    let html = `<div class="small" style="margin-bottom:10px">What's the scenario? Pick the option that matches the incident.</div>`;
    groups.forEach((plans, group) => {
      if (group) html += `<div class="group-label">${esc(group)}</div>`;
      plans.forEach((p) => {
        const label = p.scenario_label || p.title;
        const sub = [p.plan_code, p.severity].filter(Boolean).join(" · ");
        html += `
          <button class="choice-btn" data-plan="${esc(p.id)}">
            ${esc(label)}
            ${sub ? `<small>${esc(sub)}</small>` : ""}
          </button>`;
      });
    });

    bodyEl.innerHTML = html;
    bodyEl.querySelectorAll("[data-plan]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const plan = section.plans.find((p) => p.id === btn.dataset.plan);
        if (plan) renderPlanDetail(section, plan, true);
      });
    });
  }

  function renderPlanDetail(section, plan, withBack) {
    const steps = Array.isArray(plan.steps) ? plan.steps : [];
    const docs = Array.isArray(plan.docs) ? plan.docs : [];

    const stepsHtml = steps.map((s) => `
      <li>
        ${s.step_type ? `<span class="step-type">${esc(s.step_type)}</span>` : ""}<b>${esc(s.title)}</b>
        ${s.detail ? `<div class="small">${esc(s.detail)}</div>` : ""}
        ${s.owner_role ? `<div class="step-owner">Owner: ${esc(s.owner_role)}</div>` : ""}
      </li>`).join("");

    const docsHtml = docs.map((d) => `
      <div class="small">📄 <a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.label || d.url)}</a></div>`).join("");

    bodyEl.innerHTML = `
      ${withBack ? `<button class="back-link" id="viewerBackBtn">← All scenarios for this section</button>` : ""}
      <div class="card">
        <h3>${esc(plan.title)}
          ${plan.severity ? `<span class="badge ${CMap.severityClass(plan.severity)}">${esc(plan.severity)}</span>` : ""}
        </h3>
        ${plan.plan_code ? `<div class="small"><b>${esc(plan.plan_code)}</b>${plan.owner_team ? " · " + esc(plan.owner_team) : ""}</div>` : ""}
        ${plan.summary ? `<div class="small" style="margin-top:8px">${esc(plan.summary)}</div>` : ""}
        ${plan.assumptions ? `<div class="small" style="margin-top:8px"><b>Assumptions:</b> ${esc(plan.assumptions)}</div>` : ""}
        ${plan.constraints ? `<div class="small" style="margin-top:4px"><b>Constraints:</b> ${esc(plan.constraints)}</div>` : ""}
        ${docsHtml ? `<div style="margin-top:8px">${docsHtml}</div>` : ""}
      </div>
      ${stepsHtml ? `<div class="group-label">Steps</div><ol class="steps">${stepsHtml}</ol>` : ""}
    `;

    const back = document.getElementById("viewerBackBtn");
    if (back) back.addEventListener("click", () => renderChooser(section));
  }

  // ===== Boot =====
  (async function boot() {
    try {
      await CMap.loadAll();
      CMap.renderSections();
      CMap.fitAll();
    } catch (err) {
      CMap.toast(err.message || String(err), "err");
    }
  })();
})();
