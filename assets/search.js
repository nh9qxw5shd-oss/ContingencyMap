/* Contingency Map — ELR / mileage search.
 *
 * "MLN2"      -> zoom to the whole ELR route line
 * "MLN2 25.3" -> jump to that mileage, interpolated between the two nearest
 *                Network Rail waymarks (mileposts)
 */

(function () {
  const esc = CMap.esc;
  const input = document.getElementById("searchInput");
  const resultsEl = document.getElementById("searchResults");

  let waymarksByElr = null; // Map elr -> [{v, lat, lng, unit}] sorted by v
  let waymarksLoading = null;
  let marker = null;

  function loadWaymarks() {
    if (waymarksLoading) return waymarksLoading;
    waymarksLoading = (async () => {
      const res = await fetch("./assets/data/nwr_waymarks.json", { cache: "force-cache" });
      if (!res.ok) throw new Error("nwr_waymarks.json " + res.status);
      const rows = await res.json();
      waymarksByElr = new Map();
      rows.forEach(([elr, v, lat, lng, unit]) => {
        let list = waymarksByElr.get(elr);
        if (!list) { list = []; waymarksByElr.set(elr, list); }
        list.push({ v, lat, lng, unit: unit || "M" });
      });
      // rows are pre-sorted by (elr, value) at build time
      return waymarksByElr;
    })();
    return waymarksLoading;
  }

  function parseQuery(q) {
    const m = q.trim().toUpperCase().match(/^([A-Z][A-Z0-9]{1,5})(?:\s+(\d+(?:\.\d+)?))?$/);
    if (!m) return null;
    return { code: m[1], mileage: m[2] != null ? parseFloat(m[2]) : null };
  }

  function unitLabel(u) { return u === "K" ? "km" : "mi"; }

  function showResults(items) {
    if (!items.length) {
      resultsEl.classList.add("hidden");
      resultsEl.innerHTML = "";
      return;
    }
    resultsEl.innerHTML = items.map((it, i) => `
      <button class="search-item${i === 0 ? " active" : ""}" data-i="${i}">
        <b>${esc(it.code)}</b>
        <span>${esc(it.sub)}</span>
        ${it.kind ? `<span class="search-kind">${esc(it.kind)}</span>` : ""}
      </button>`).join("");
    resultsEl.classList.remove("hidden");
    resultsEl.querySelectorAll(".search-item").forEach((el) => {
      el.addEventListener("click", () => {
        items[Number(el.dataset.i)].go();
        hideResults();
      });
    });
  }

  function hideResults() {
    resultsEl.classList.add("hidden");
  }

  function elrItems(parsed) {
    const items = [];
    if (!parsed) return items;
    const { code, mileage } = parsed;

    // ELR matches by prefix (exact match first)
    const codes = [...CMap.nr.byCode.keys()]
      .filter((c) => c.startsWith(code))
      .sort((a, b) => (a === code ? -1 : b === code ? 1 : a < b ? -1 : 1))
      .slice(0, mileage != null ? 6 : 4);

    codes.forEach((c) => {
      const f = CMap.nr.byCode.get(c);
      const { start, end } = f.properties;
      if (mileage != null) {
        items.push({
          code: c, kind: "ELR",
          sub: `go to ${mileage} (route runs ${start.toFixed(1)}–${end.toFixed(1)})`,
          go: () => jumpToMileage(c, mileage),
        });
      } else {
        items.push({
          code: c, kind: "ELR",
          sub: `route line · ${start.toFixed(1)}–${end.toFixed(1)}`,
          go: () => zoomToElr(c),
        });
      }
    });
    return items;
  }

  function goToLocation(l) {
    CMap.map.flyTo([l.lat, l.lng], Math.max(CMap.map.getZoom(), 14), { duration: 0.8 });
    setMarker([l.lat, l.lng], `<b>${esc(l.name)}</b>${l.crs ? " · " + esc(l.crs) : ""}`);
    highlight(null);
    input.value = l.name;
  }

  function locationItems(q, locs) {
    const ql = q.trim().toLowerCase();
    if (ql.length < 2) return [];
    return locs
      .filter((l) => l.name.toLowerCase().includes(ql) || (l.crs && l.crs.toLowerCase() === ql))
      .sort((a, b) => {
        const ax = a.crs && a.crs.toLowerCase() === ql ? 0 : a.name.toLowerCase().startsWith(ql) ? 1 : 2;
        const bx = b.crs && b.crs.toLowerCase() === ql ? 0 : b.name.toLowerCase().startsWith(ql) ? 1 : 2;
        return ax - bx || (a.name < b.name ? -1 : 1);
      })
      .slice(0, 8)
      .map((l) => ({
        code: l.name,
        kind: l.kind === "j" ? "junction" : "station",
        sub: l.crs || "",
        go: () => goToLocation(l),
      }));
  }

  async function buildItems(q) {
    const locs = await CMap.loadLocations().catch(() => []);
    const locItems = locationItems(q, locs);
    const elrs = elrItems(parseQuery(q));
    // an exact CRS hit (e.g. "SAC") is almost always what was meant — put it first
    const exactCrs = locItems.length && locItems[0].sub &&
      locItems[0].sub.toLowerCase() === q.trim().toLowerCase();
    return exactCrs ? [...locItems, ...elrs] : [...elrs, ...locItems];
  }

  function zoomToElr(code) {
    const f = CMap.nr.byCode.get(code);
    if (!f) return;
    const layer = L.geoJSON(f);
    const b = layer.getBounds();
    if (b.isValid()) CMap.map.fitBounds(b, { padding: [50, 50] });
    setMarker(null);
    highlight(f, code);
    input.value = code;
  }

  let highlightLayer = null;
  function highlight(feature, label) {
    if (highlightLayer) { CMap.map.removeLayer(highlightLayer); highlightLayer = null; }
    if (!feature) return;
    highlightLayer = L.geoJSON(feature, {
      style: { color: "#2563eb", weight: 4, opacity: 0.9, dashArray: "1 8" },
      interactive: false,
    }).addTo(CMap.map);
    if (label) CMap.toast(`Showing ${label} — clear the search box to remove the highlight.`);
  }

  function setMarker(latlng, popupHtml) {
    if (marker) { CMap.map.removeLayer(marker); marker = null; }
    if (!latlng) return;
    marker = L.marker(latlng).addTo(CMap.map);
    if (popupHtml) marker.bindPopup(popupHtml).openPopup();
  }

  async function jumpToMileage(code, mileage) {
    input.value = `${code} ${mileage}`;
    try {
      await loadWaymarks();
    } catch (err) {
      return CMap.toast("Waymark data could not be loaded: " + err.message, "err");
    }
    const list = waymarksByElr.get(code);
    if (!list || !list.length) {
      // no waymarks: fall back to showing the whole ELR
      CMap.toast(`No waymarks recorded for ${code} — showing the route instead.`, "err");
      return zoomToElr(code);
    }

    const unit = list[0].unit;
    let lat, lng, note = "";

    if (mileage <= list[0].v) {
      ({ lat, lng } = list[0]);
      if (mileage < list[0].v - 0.5) note = ` (route starts at ${list[0].v.toFixed(1)})`;
    } else if (mileage >= list[list.length - 1].v) {
      ({ lat, lng } = list[list.length - 1]);
      const last = list[list.length - 1].v;
      if (mileage > last + 0.5) note = ` (route ends at ${last.toFixed(1)})`;
    } else {
      let i = 1;
      while (i < list.length && list[i].v < mileage) i++;
      const a = list[i - 1], b = list[i];
      const t = (mileage - a.v) / (b.v - a.v || 1);
      lat = a.lat + t * (b.lat - a.lat);
      lng = a.lng + t * (b.lng - a.lng);
    }

    CMap.map.flyTo([lat, lng], Math.max(CMap.map.getZoom(), 14), { duration: 0.8 });
    setMarker([lat, lng], `<b>${esc(code)}</b> · ${esc(String(mileage))} ${unitLabel(unit)}${esc(note)}`);
    const f = CMap.nr.byCode.get(code);
    if (f) highlight(f);
  }

  // ===== wiring =====
  let debounceT = null;
  input.addEventListener("input", () => {
    clearTimeout(debounceT);
    debounceT = setTimeout(async () => {
      await CMap.nr.ready;
      const q = input.value;
      if (!q.trim()) { hideResults(); setMarker(null); highlight(null); return; }
      showResults(await buildItems(q));
    }, 120);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const first = resultsEl.querySelector(".search-item");
      if (first) first.click();
    } else if (e.key === "Escape") {
      hideResults();
      input.blur();
    }
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest("#searchWrap")) hideResults();
  });
})();
