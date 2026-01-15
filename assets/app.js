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
