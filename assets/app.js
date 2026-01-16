// ====== CONFIG ======
const SUPABASE_URL = "https://ungtmfwxqawkdiflmora.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVuZ3RtZnd4cWF3a2RpZmxtb3JhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIxMDY4NjQsImV4cCI6MjA3NzY4Mjg2NH0.Yaq0XfbbkwxJDUoiPCS7bLVBy70Wa-NOOWIxkpRRxdc";

// Reuse client if app.js gets loaded twice.
// Also avoid naming the client variable "supabase" because the UMD bundle may already declare that identifier.
window.__sbClient = window.__sbClient
  || window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const sb = window.__sbClient;

// ====== MAP SETUP ======
const map = L.map("map", { zoomControl: true }).setView([52.5, -1.6], 7);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

let corridorLayer;

// ====== UI HELPERS ======
const panelTitle = document.getElementById("panelTitle");
const panelMeta = document.getElementById("panelMeta");
const panelBody = document.getElementById("panelBody");

function setPanelLoading(title, meta){
  panelTitle.textContent = title || "Loading…";
  panelMeta.textContent = meta || "";
  panelBody.innerHTML = `<div class="empty">Pulling plans from Supabase… because humans love spreadsheets.</div>`;
}

function setPanelError(message){
  panelBody.innerHTML = `<div class="error">${escapeHtml(message)}</div>`;
}

function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, (m) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"
  }[m]));
}

function renderPlans(corridor, plans){
  panelTitle.textContent = corridor.name || corridor.corridor_code;
  panelMeta.textContent = `Corridor: ${corridor.corridor_code}`;

  if (!plans.length){
    panelBody.innerHTML = `<div class="empty">No plans mapped to this corridor. That’s either “lean” or “unprepared”.</div>`;
    return;
  }

  const html = plans.map(p => {
    const stepsHtml = (p.steps || []).map(s =>
      `<li><b>${escapeHtml(s.step_type)}:</b> ${escapeHtml(s.title)}<div class="small">${escapeHtml(s.detail)}</div></li>`
    ).join("");

    const docsHtml = (p.docs || []).map(d =>
      `<div class="small">📄 <a href="${escapeHtml(d.url)}" target="_blank" rel="noopener">${escapeHtml(d.label)}</a></div>`
    ).join("");

    return `
      <div class="card">
        <h3>${escapeHtml(p.title)}
          <span class="badge">${escapeHtml(p.severity || "Unrated")}</span>
        </h3>
        ${p.summary ? `<div class="small">${escapeHtml(p.summary)}</div>` : ``}
        ${docsHtml ? `<div style="margin-top:8px">${docsHtml}</div>` : ``}
        ${stepsHtml ? `<ol class="steps">${stepsHtml}</ol>` : ``}
      </div>
    `;
  }).join("");

  panelBody.innerHTML = html;
}

// ====== DECISION MODAL (for corridors with logic) ======
let __decisionModalInjected = false;

function ensureDecisionModal(){
  if (__decisionModalInjected) return;
  __decisionModalInjected = true;

  const style = document.createElement("style");
  style.textContent = `
    .modalOverlay{
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.45);
      display: flex; align-items: center; justify-content: center;
      z-index: 9999;
      padding: 16px;
    }
    .modalCard{
      width: min(520px, 100%);
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.25);
      overflow: hidden;
      font-family: system-ui, -apple-system, Segoe UI, sans-serif;
    }
    .modalHead{
      padding: 14px 16px;
      background: #111827;
      color: #f9fafb;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .modalHead h3{
      margin: 0;
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 0.2px;
    }
    .modalBody{
      padding: 14px 16px;
      color: #111827;
    }
    .modalQuestion{
      font-size: 14px;
      font-weight: 700;
      margin: 0 0 10px 0;
    }
    .modalHint{
      font-size: 12px;
      opacity: 0.75;
      margin: 0 0 12px 0;
    }
    .modalBtns{
      display: grid;
      grid-template-columns: 1fr;
      gap: 10px;
      margin-top: 10px;
    }
    .modalBtn{
      border: 1px solid #e5e7eb;
      background: #f9fafb;
      border-radius: 10px;
      padding: 10px 12px;
      text-align: left;
      cursor: pointer;
      font-weight: 700;
      font-size: 13px;
    }
    .modalBtn:hover{
      background: #f3f4f6;
    }
    .modalBtn small{
      display: block;
      font-weight: 500;
      opacity: 0.8;
      margin-top: 3px;
    }
    .modalClose{
      border: 0;
      background: transparent;
      color: #f9fafb;
      cursor: pointer;
      font-size: 18px;
      line-height: 1;
      padding: 4px 8px;
      opacity: 0.85;
    }
    .modalClose:hover{ opacity: 1; }
  `;
  document.head.appendChild(style);
}

function showChoiceModal({ title, question, hint, choices }){
  ensureDecisionModal();

  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modalOverlay";

    const card = document.createElement("div");
    card.className = "modalCard";

    const head = document.createElement("div");
    head.className = "modalHead";

    const h3 = document.createElement("h3");
    h3.textContent = title || "Select";

    const closeBtn = document.createElement("button");
    closeBtn.className = "modalClose";
    closeBtn.type = "button";
    closeBtn.innerHTML = "×";
    closeBtn.addEventListener("click", () => cleanup(null));

    head.appendChild(h3);
    head.appendChild(closeBtn);

    const body = document.createElement("div");
    body.className = "modalBody";

    const q = document.createElement("p");
    q.className = "modalQuestion";
    q.textContent = question || "Choose one";

    const h = document.createElement("p");
    h.className = "modalHint";
    h.textContent = hint || "";

    const btns = document.createElement("div");
    btns.className = "modalBtns";

    (choices || []).forEach(ch => {
      const b = document.createElement("button");
      b.className = "modalBtn";
      b.type = "button";
      b.innerHTML = `${escapeHtml(ch.label)}${ch.sub ? `<small>${escapeHtml(ch.sub)}</small>` : ""}`;
      b.addEventListener("click", () => cleanup(ch.value));
      btns.appendChild(b);
    });

    body.appendChild(q);
    if (hint) body.appendChild(h);
    body.appendChild(btns);

    card.appendChild(head);
    card.appendChild(body);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    function onKey(e){
      if (e.key === "Escape") cleanup(null);
    }
    document.addEventListener("keydown", onKey);

    function cleanup(val){
      document.removeEventListener("keydown", onKey);
      overlay.remove();
      resolve(val);
    }

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) cleanup(null);
    });
  });
}

// KTN_SAC decision tree -> plan_code
async function decidePlanForKTN_SAC(){
  const blockType = await showChoiceModal({
    title: "Kentish Town ↔ St Albans",
    question: "What’s the infrastructure state?",
    hint: "We’ll pick the correct MML plan based on this.",
    choices: [
      { value: "FULL", label: "Full block", sub: "No usable route through the affected section" },
      { value: "PARTIAL", label: "Reduced capacity", sub: "Partial block / degraded operation" }
    ]
  });
  if (!blockType) return null;

  if (blockType === "FULL"){
    const section = await showChoiceModal({
      title: "Full block (MML)",
      question: "Where is the full block?",
      choices: [
        { value: "SAC_RDL", label: "St Albans → Radlett", sub: "Maps to MML-6" },
        { value: "RDL_KTN", label: "Radlett → Kentish Town", sub: "Maps to MML-7" }
      ]
    });
    if (!section) return null;
    return section === "SAC_RDL" ? "MML-6" : "MML-7";
  }

  // PARTIAL
  const section = await showChoiceModal({
    title: "Reduced capacity (MML)",
    question: "Which section is constrained?",
    choices: [
      { value: "SAC_RDL", label: "St Albans → Radlett", sub: "Fast/Slow line reduced capacity variants" },
      { value: "RDL_WHS", label: "Radlett → West Hampstead South", sub: "Fast/Slow line reduced capacity variants" },
      { value: "SAC_KTN", label: "St Albans → Kentish Town", sub: "Carlton Road Jn / red status style constraint" }
    ]
  });
  if (!section) return null;

  if (section === "SAC_KTN"){
    return "MML-7C";
  }

  const lineType = await showChoiceModal({
    title: "Reduced capacity detail",
    question: "Which lines are impacted?",
    hint: "Pick the constrained pair.",
    choices: [
      { value: "FAST", label: "Fast lines reduced capacity", sub: "Maps to MML-7A" },
      { value: "SLOW", label: "Slow lines reduced capacity", sub: "Maps to MML-7B" }
    ]
  });
  if (!lineType) return null;

  return lineType === "FAST" ? "MML-7A" : "MML-7B";
}

// ====== DATA FETCH ======
async function fetchPlansForCorridor(corridor_code){
  // 1) find corridor id
  const { data: corridor, error: cErr } = await sb
    .from("corridors")
    .select("id,corridor_code,name,route,line,notes")
    .eq("corridor_code", corridor_code)
    .maybeSingle();

  if (cErr) throw new Error(`Corridor lookup failed: ${cErr.message}`);
  if (!corridor) return { corridor: { corridor_code, name: corridor_code }, plans: [] };

  // 2) mapped plans (ordered by priority)
  const { data: maps, error: mErr } = await sb
    .from("corridor_plan_map")
    .select("priority, plan_id")
    .eq("corridor_id", corridor.id)
    .order("priority", { ascending: true });

  if (mErr) throw new Error(`Plan mapping failed: ${mErr.message}`);
  if (!maps?.length) return { corridor, plans: [] };

  const planIds = maps.map(x => x.plan_id);

  // 3) pull plan headers
  const { data: plans, error: pErr } = await sb
    .from("contingency_plans")
    .select("id,plan_code,title,severity,owner_team,summary,assumptions,constraints")
    .in("id", planIds);

  if (pErr) throw new Error(`Plan fetch failed: ${pErr.message}`);

  // 4) steps + docs (bulk)
  const { data: steps, error: sErr } = await sb
    .from("plan_steps")
    .select("plan_id,step_order,step_type,title,detail,owner_role")
    .in("plan_id", planIds)
    .order("step_order", { ascending: true });

  if (sErr) throw new Error(`Steps fetch failed: ${sErr.message}`);

  const { data: docs, error: dErr } = await sb
    .from("plan_docs")
    .select("plan_id,label,url")
    .in("plan_id", planIds);

  if (dErr) throw new Error(`Docs fetch failed: ${dErr.message}`);

  // 5) attach children to plans
  const byId = new Map(plans.map(p => [p.id, { ...p, steps: [], docs: [] }]));
  (steps || []).forEach(s => byId.get(s.plan_id)?.steps.push(s));
  (docs || []).forEach(d => byId.get(d.plan_id)?.docs.push(d));

  // 6) preserve priority ordering
  const orderedPlans = maps.map(m => byId.get(m.plan_id)).filter(Boolean);

  return { corridor, plans: orderedPlans };
}

// ====== LOAD GEOJSON + INTERACTION ======
async function loadCorridors(){
  const res = await fetch("./assets/corridors.geojson", { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load corridors.geojson (${res.status})`);
  const geojson = await res.json();

  corridorLayer = L.geoJSON(geojson, {
    style: () => ({
      weight: 5,
      opacity: 0.8
    }),
    onEachFeature: (feature, layer) => {
      layer.on("click", async () => {
        const props = feature.properties || {};
        const code = props.corridor_code;
        const name = props.name || code;

        if (!code){
          setPanelError("This corridor feature has no corridor_code. Map it properly.");
          return;
        }

        // Corridor with decision-tree logic
        if (code === "KTN_SAC"){
          panelTitle.textContent = name;
          panelMeta.textContent = `Corridor: ${code}`;
          panelBody.innerHTML = `<div class="empty">Select the scenario to load the correct plan.</div>`;

          const chosenPlanCode = await decidePlanForKTN_SAC();
          if (!chosenPlanCode){
            panelBody.innerHTML = `<div class="empty">No selection made. Corridor remains clickable when you’re ready.</div>`;
            return;
          }

          setPanelLoading(`${name}`, `Corridor: ${code} • Selected: ${chosenPlanCode}`);
          try{
            const result = await fetchPlansForCorridor(code);
            const selected = (result.plans || []).find(p => p.plan_code === chosenPlanCode);
            if (!selected){
              setPanelError(`Selected plan ${chosenPlanCode} is not mapped to corridor ${code} in Supabase.`);
              return;
            }
            renderPlans(result.corridor, [selected]);
          } catch (e){
            setPanelError(e.message || String(e));
          }
          return;
        }

        // Default behaviour: render all mapped plans (usually just 1)
        setPanelLoading(name, `Corridor: ${code}`);
        try{
          const result = await fetchPlansForCorridor(code);
          renderPlans(result.corridor, result.plans);
        } catch (e){
          setPanelError(e.message || String(e));
        }
      });

      const p = feature.properties || {};
layer.bindTooltip(
  `<b>${p.name || p.corridor_code}</b><br>${p.route || ""} – ${p.line || ""}`,
  { sticky: true }
);

    }
  }).addTo(map);

  try{
    map.fitBounds(corridorLayer.getBounds(), { padding: [20, 20] });
  } catch {
    // ignore if bounds fail
  }
}

loadCorridors().catch(err => {
  setPanelError(err.message || String(err));
});
