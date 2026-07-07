import { useMemo, useState } from 'react';

const MODE_OPTIONS = [
  { id: 'plane', label: 'Plane', icon: '✈' },
  { id: 'drive', label: 'Car', icon: '🚗' },
  { id: 'train', label: 'Train', icon: '🚆' },
  { id: 'boat', label: 'Boat', icon: '⛴' }
];
const TRAVELER_OPTIONS = [
  { id: 'joey', label: 'Joey', color: '#ff8a00' },
  { id: 'bonnie', label: 'Bonnie', color: '#ff4fd8' }
];
const empty = {
  year: new Date().getFullYear(), month: null, day: null, label: '', travelers: ['joey','bonnie'], mode: 'plane',
  roundTrip: true, fromLocationId: null, toLocationId: '', toLocationText: '', notes: '', occasion: '', route: [], extraLegs: [], overrideFrom: false
};

export default function AdminPanel({ trips, setTrips, locations, setLocations, homeBases }) {
  const [draft, setDraft] = useState(empty);
  const [modal, setModal] = useState(null); // 'add' | 'edit' | null
  const [editingId, setEditingId] = useState(null);
  const [reorderMode, setReorderMode] = useState(false);
  const [orderDraft, setOrderDraft] = useState(() => sortTripsForEditor(trips));
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [token, setToken] = useState(() => localStorage.getItem('journeylines.githubToken') || '');
  const [repo, setRepo] = useState(() => localStorage.getItem('journeylines.repo') || '');
  const [dragId, setDragId] = useState(null);
  const locs = useMemo(() => [...locations].sort((a,b) => a.name.localeCompare(b.name)), [locations]);
  const locById = useMemo(() => Object.fromEntries(locations.map(l => [l.id, l])), [locations]);
  const sortedTrips = useMemo(() => sortTripsForEditor(trips), [trips]);

  function saveLocalToken(value) { setToken(value); localStorage.setItem('journeylines.githubToken', value); }
  function saveRepo(value) { setRepo(value); localStorage.setItem('journeylines.repo', value); }

  function openAdd() {
    setEditingId(null);
    setDraft({ ...empty, year: new Date().getFullYear(), toLocationText: '' });
    setModal('add');
  }
  function openEdit(trip) {
    const to = locById[trip.toLocationId];
    const routeStops = trip.route?.length ? trip.route.slice(1) : [];
    setEditingId(trip.id);
    setDraft({
      ...empty,
      ...trip,
      overrideFrom: !!trip.fromLocationId || !!trip.route?.length,
      toLocationText: to ? displayLocation(to) : (trip.toLocationName || trip.label || ''),
      extraLegs: routeStops.slice(1).map(r => ({ locationId: r.locationId || '', locationText: displayLocation(locById[r.locationId]) || '', modeFromPrevious: r.modeFromPrevious || trip.mode || 'plane' }))
    });
    setModal('edit');
  }
  function closeModal() { setModal(null); setEditingId(null); setDraft(empty); }

  function updateTraveler(id) {
    const set = new Set(draft.travelers || []);
    if (set.has(id)) set.delete(id); else set.add(id);
    const next = Array.from(set);
    setDraft({ ...draft, travelers: next.length ? next : [id] });
  }

  function chooseDestination(location) {
    setDraft({ ...draft, toLocationId: location.id, toLocationText: displayLocation(location), label: draft.label || location.name });
  }
  function chooseFrom(location) { setDraft({ ...draft, fromLocationId: location.id, fromLocationText: displayLocation(location), overrideFrom: true }); }
  function chooseExtraLeg(index, location) {
    const extraLegs = [...(draft.extraLegs || [])];
    extraLegs[index] = { ...extraLegs[index], locationId: location.id, locationText: displayLocation(location) };
    setDraft({ ...draft, extraLegs });
  }
  function setExtraLeg(index, patch) {
    const extraLegs = [...(draft.extraLegs || [])];
    extraLegs[index] = { ...extraLegs[index], ...patch };
    setDraft({ ...draft, extraLegs });
  }
  function addLeg() { setDraft({ ...draft, extraLegs: [...(draft.extraLegs || []), { locationId: '', locationText: '', modeFromPrevious: draft.mode || 'plane' }] }); }
  function removeLeg(index) { setDraft({ ...draft, extraLegs: (draft.extraLegs || []).filter((_, i) => i !== index) }); }

  async function saveTripFromModal() {
    try {
      setBusy(true);
      const { trip, nextLocations } = normalizeTrip(draft, trips, locations, homeBases);
      const nextTrips = editingId ? trips.map(t => t.id === editingId ? { ...t, ...trip, id: editingId } : t) : insertChronologically([...trips, trip]);
      setTrips(nextTrips);
      if (nextLocations !== locations) setLocations(nextLocations);
      await commitData(nextTrips, nextLocations, editingId ? `Edit trip: ${trip.label || trip.toLocationName || trip.id}` : `Add trip: ${trip.label || trip.toLocationName || trip.id}`);
      closeModal();
    } catch (err) {
      alert(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }
  function del(id) {
    if (!confirm('Delete this trip?')) return;
    const nextTrips = trips.filter(t => t.id !== id);
    setTrips(nextTrips);
    commitData(nextTrips, locations, 'Delete trip from GlobeHoppers').catch(err => alert(err.message || String(err)));
  }
  function download() {
    const blob = new Blob([JSON.stringify(trips, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'trips.json'; a.click(); URL.revokeObjectURL(url);
  }
  async function commitData(nextTrips = trips, nextLocations = locations, message = 'Update travel history from GlobeHoppers') {
    if (!token || !repo) throw new Error('Enter a repo and fine-grained GitHub token in Repository Settings first.');
    const files = [
      { path: 'src/data/trips.json', data: nextTrips },
      { path: 'src/data/locations.json', data: nextLocations }
    ];
    await commitFilesAtomically(files, message);
  }

  async function commitFilesAtomically(files, message) {
    const headers = githubHeaders(token);
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const refRes = await fetch(`https://api.github.com/repos/${repo}/git/ref/heads/main`, { headers });
        if (!refRes.ok) throw new Error(await refRes.text());
        const ref = await refRes.json();
        const headSha = ref.object?.sha;
        if (!headSha) throw new Error('Could not read the current main branch SHA.');

        const commitRes = await fetch(`https://api.github.com/repos/${repo}/git/commits/${headSha}`, { headers });
        if (!commitRes.ok) throw new Error(await commitRes.text());
        const headCommit = await commitRes.json();
        const baseTree = headCommit.tree?.sha;
        if (!baseTree) throw new Error('Could not read the current tree SHA.');

        const treeRes = await fetch(`https://api.github.com/repos/${repo}/git/trees`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            base_tree: baseTree,
            tree: files.map(file => ({
              path: file.path,
              mode: '100644',
              type: 'blob',
              content: JSON.stringify(file.data, null, 2) + '\n'
            }))
          })
        });
        if (!treeRes.ok) throw new Error(await treeRes.text());
        const tree = await treeRes.json();

        const newCommitRes = await fetch(`https://api.github.com/repos/${repo}/git/commits`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ message, tree: tree.sha, parents: [headSha] })
        });
        if (!newCommitRes.ok) throw new Error(await newCommitRes.text());
        const newCommit = await newCommitRes.json();

        const updateRefRes = await fetch(`https://api.github.com/repos/${repo}/git/refs/heads/main`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ sha: newCommit.sha, force: false })
        });
        if (updateRefRes.ok) return newCommit;

        const text = await updateRefRes.text();
        if (updateRefRes.status !== 409) throw new Error(text);
        lastError = new Error(text || 'GitHub reported a conflict while updating main. Retrying with the latest branch state.');
        await wait(450 * attempt);
      } catch (err) {
        lastError = err;
        if (!String(err.message || err).includes('409') && attempt === 1) {
          // Fall back to the Contents API if this token cannot use the Git Data API.
          return commitFilesWithContentsApi(files, message);
        }
        if (attempt < 3) await wait(450 * attempt);
      }
    }
    throw new Error(`GitHub commit conflict after retrying. Refresh GlobeHoppers Studio and try again. Details: ${lastError?.message || lastError}`);
  }

  async function commitFilesWithContentsApi(files, message) {
    for (const file of files) await commitFileWithRetry(file.path, file.data, message);
  }

  async function commitFileWithRetry(path, data, message) {
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const headers = githubHeaders(token);
        const getRes = await fetch(`https://api.github.com/repos/${repo}/contents/${path}?ref=main`, { headers, cache: 'no-store' });
        const existing = getRes.ok ? await getRes.json() : null;
        const body = { message, content: toBase64(JSON.stringify(data, null, 2) + '\n'), branch: 'main' };
        if (existing?.sha) body.sha = existing.sha;
        const putRes = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, { method: 'PUT', headers, body: JSON.stringify(body) });
        if (putRes.ok) return await putRes.json();
        const text = await putRes.text();
        lastError = new Error(text);
        if (putRes.status !== 409) throw lastError;
        await wait(450 * attempt);
      } catch (err) {
        lastError = err;
        if (attempt < 3) await wait(450 * attempt);
      }
    }
    throw lastError || new Error(`Could not commit ${path}.`);
  }

  function enterReorder() { setOrderDraft(sortTripsForEditor(trips)); setReorderMode(true); }
  function moveTrip(fromId, toId) {
    if (!fromId || fromId === toId) return;
    const fromTrip = orderDraft.find(t => t.id === fromId);
    const toTrip = orderDraft.find(t => t.id === toId);
    if (!fromTrip || !toTrip || bucketKey(fromTrip) !== bucketKey(toTrip)) return;
    const next = [...orderDraft];
    const from = next.findIndex(t => t.id === fromId);
    const to = next.findIndex(t => t.id === toId);
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setOrderDraft(next);
  }
  async function saveReorder() {
    try {
      setBusy(true);
      const next = applyBucketOrder(orderDraft);
      setTrips(next);
      await commitData(next, locations, 'Reorder travel history');
      setReorderMode(false);
    } catch (err) { alert(err.message || String(err)); }
    finally { setBusy(false); }
  }

  return <section className="studio-shell">
    <aside className="studio-panel glass">
      <div className="studio-header">
        <div>
          <p className="eyebrow">GlobeHoppers Studio</p>
          <h2>Edit Travel History</h2>
          <p>Curate trips, reorder timeline entries, and commit updates directly to GitHub.</p>
        </div>
        <button className="studio-close" onClick={() => window.dispatchEvent(new CustomEvent('globehoppers-close-studio'))}>Close</button>
      </div>

      <div className="studio-actions-main">
        <button className="primary" onClick={openAdd}>Add Trip</button>
        {!reorderMode && <button onClick={enterReorder}>Reorder</button>}
        {reorderMode && <><button className="primary" onClick={saveReorder} disabled={busy}>Save order</button><button onClick={() => setReorderMode(false)}>Cancel reorder</button></>}
      </div>

      <div className={`studio-trip-list ${reorderMode ? 'is-reordering' : ''}`}>
        {(reorderMode ? orderDraft : sortedTrips).map(trip => <div
          className="studio-trip-row"
          key={trip.id}
          draggable={reorderMode}
          onDragStart={() => setDragId(trip.id)}
          onDragOver={e => e.preventDefault()}
          onDrop={() => { moveTrip(dragId, trip.id); setDragId(null); }}
        >
          <span className="studio-trip-date">{formatTripDate(trip)}</span>
          <span className="studio-trip-main"><strong>{trip.label || trip.toLocationName || trip.toLocationId}</strong><small>{summarizeTrip(trip, locById)}</small></span>
          <span className="studio-trip-buttons">
            {reorderMode ? <span className="drag-handle">↕</span> : <><button onClick={() => openEdit(trip)}>Edit</button><button onClick={() => del(trip.id)}>Delete</button></>}
          </span>
        </div>)}
      </div>

      <details className="repo-settings" open={settingsOpen} onToggle={e => setSettingsOpen(e.currentTarget.open)}>
        <summary>Repository Settings</summary>
        <div className="repo-grid">
          <button onClick={download}>Download trips.json</button>
          <input value={repo} onChange={e => saveRepo(e.target.value)} placeholder="owner/repo" />
          <input value={token} onChange={e => saveLocalToken(e.target.value)} type="password" placeholder="GitHub fine-grained token" />
          <button onClick={() => commitData().then(() => alert('Travel history committed.')).catch(err => alert(err.message))}>Commit current data</button>
          <button onClick={() => { localStorage.removeItem('journeylines.githubToken'); setToken(''); }}>Clear token</button>
        </div>
      </details>
    </aside>

    {modal && <TripModal
      mode={modal}
      draft={draft}
      setDraft={setDraft}
      busy={busy}
      locs={locs}
      locById={locById}
      onClose={closeModal}
      onSave={saveTripFromModal}
      onTravelerToggle={updateTraveler}
      onChooseDestination={chooseDestination}
      onChooseFrom={chooseFrom}
      onChooseExtraLeg={chooseExtraLeg}
      onSetExtraLeg={setExtraLeg}
      onAddLeg={addLeg}
      onRemoveLeg={removeLeg}
    />}
  </section>;
}

function TripModal({ mode, draft, setDraft, busy, locs, locById, onClose, onSave, onTravelerToggle, onChooseDestination, onChooseFrom, onChooseExtraLeg, onSetExtraLeg, onAddLeg, onRemoveLeg }) {
  const destinationMatches = filterLocations(locs, draft.toLocationText || '');
  const fromMatches = filterLocations(locs, draft.fromLocationText || '');
  const title = mode === 'add' ? 'Add a trip' : draft.label || draft.toLocationText || 'Edit trip';
  return <div className="studio-modal-backdrop">
    <div className="studio-modal glass">
      <div className="studio-modal-sticky">
        <div className="studio-modal-header studio-modal-header--with-actions">
          <div className="studio-title-block">
            <p className="eyebrow">{mode === 'add' ? 'New Trip' : 'Edit Trip'}</p>
            <h2>{title}</h2>
          </div>
          <div className="studio-modal-top-actions">
            <button onClick={onClose}>Cancel</button>
            <button className="primary" disabled={busy} onClick={onSave}>{busy ? 'Saving…' : 'Save and commit'}</button>
          </div>
        </div>

        <div className="studio-form-grid studio-form-grid--sticky-fields">
          <label>Trip title<input value={draft.label || ''} onChange={e => setDraft({...draft, label:e.target.value})} placeholder="Cabo Trip" /></label>
          <label>Year<input type="number" value={draft.year || ''} onChange={e => setDraft({...draft, year:Number(e.target.value)})} /></label>
          <label>Month<input type="number" min="1" max="12" value={draft.month || ''} onChange={e => setDraft({...draft, month:e.target.value ? Number(e.target.value) : null})} placeholder="Optional" /></label>
          <label>Day<input type="number" min="1" max="31" value={draft.day || ''} onChange={e => setDraft({...draft, day:e.target.value ? Number(e.target.value) : null})} placeholder="Optional" /></label>
        </div>
      </div>

      <div className="studio-modal-scroll-content">
        <section className="studio-pick-section">
          <h3>Travelers</h3>
          <div className="pill-selectors">
            {TRAVELER_OPTIONS.map(t => <button key={t.id} type="button" className={`traveler-pill ${draft.travelers?.includes(t.id) ? 'is-selected' : ''}`} style={{ '--accent': t.color }} onClick={() => onTravelerToggle(t.id)}><span></span>{t.label}</button>)}
          </div>
        </section>

        <section className="studio-pick-section">
          <h3>Travel mode</h3>
          <div className="mode-selectors">
            {MODE_OPTIONS.map(m => <button key={m.id} type="button" className={`mode-tile ${draft.mode === m.id ? 'is-selected' : ''}`} onClick={() => setDraft({...draft, mode:m.id})}><span>{m.icon}</span>{m.label}</button>)}
          </div>
        </section>

        <section className="studio-pick-section">
          <h3>Route</h3>
          <div className="route-form">
            <label className="check premium-check"><input type="checkbox" checked={!!draft.overrideFrom} onChange={e => setDraft({...draft, overrideFrom:e.target.checked, fromLocationId:e.target.checked ? draft.fromLocationId : null})}/> Override from location</label>
            {draft.overrideFrom && <AutocompleteField label="From" value={draft.fromLocationText || displayLocation(locById[draft.fromLocationId]) || ''} onChange={v => setDraft({...draft, fromLocationText:v, fromLocationId:''})} matches={fromMatches} onChoose={onChooseFrom} />}
            <AutocompleteField label="Destination" value={draft.toLocationText || ''} onChange={v => setDraft({...draft, toLocationText:v, toLocationId:''})} matches={destinationMatches} onChoose={onChooseDestination} />
            <label className="check premium-check"><input type="checkbox" checked={!!draft.roundTrip} onChange={e => setDraft({...draft, roundTrip:e.target.checked})}/> Round trip</label>
            <div className="legs-block">
              <div className="legs-header"><strong>Additional legs</strong><button type="button" onClick={onAddLeg}>Add leg</button></div>
              {(draft.extraLegs || []).map((leg, index) => <div className="leg-row" key={index}>
                <select value={leg.modeFromPrevious || draft.mode || 'plane'} onChange={e => onSetExtraLeg(index, { modeFromPrevious: e.target.value })}>{MODE_OPTIONS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
                <AutocompleteField compact label={`Leg ${index + 2} destination`} value={leg.locationText || displayLocation(locById[leg.locationId]) || ''} onChange={v => onSetExtraLeg(index, { locationText: v, locationId: '' })} matches={filterLocations(locs, leg.locationText || '')} onChoose={loc => onChooseExtraLeg(index, loc)} />
                <button type="button" onClick={() => onRemoveLeg(index)}>Remove</button>
              </div>)}
            </div>
          </div>
        </section>

        <div className="studio-form-grid single">
          <label>Notes<textarea value={draft.notes || ''} onChange={e => setDraft({...draft, notes:e.target.value})} placeholder="Vacation, work trip, birthday, etc." /></label>
        </div>

        <section className="photo-placeholder">
          <button type="button" disabled><span>＋</span> Upload photos</button>
          <p>Photo uploads are reserved for the next media pass.</p>
        </section>

        <div className="studio-modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy} onClick={onSave}>{busy ? 'Saving…' : 'Save and commit'}</button>
        </div>
      </div>
    </div>
  </div>;
}

function AutocompleteField({ label, value, onChange, matches, onChoose, compact }) {
  return <label className={`autocomplete-field ${compact ? 'compact' : ''}`}>{label}
    <input value={value} onChange={e => onChange(e.target.value)} placeholder="Start typing a destination" />
    {!!value && matches.length > 0 && <div className="autocomplete-menu">
      {matches.slice(0, 8).map(l => <button type="button" key={l.id} onClick={() => onChoose(l)}><strong>{l.name}</strong><small>{[l.region, l.country].filter(Boolean).join(', ')}</small></button>)}
    </div>}
  </label>;
}

function normalizeTrip(draft, trips, locations, homeBases) {
  let nextLocations = locations;
  let toLocationId = draft.toLocationId;
  if (!toLocationId && draft.toLocationText) {
    const found = findLocationByText(locations, draft.toLocationText);
    if (found) toLocationId = found.id;
    else {
      const loc = createPlaceholderLocation(draft.toLocationText);
      nextLocations = [...locations, loc];
      toLocationId = loc.id;
    }
  }
  if (!toLocationId) throw new Error('Choose or enter a destination.');

  let fromLocationId = draft.overrideFrom ? draft.fromLocationId : null;
  if (draft.overrideFrom && !fromLocationId && draft.fromLocationText) {
    const found = findLocationByText(nextLocations, draft.fromLocationText);
    if (found) fromLocationId = found.id;
    else {
      const loc = createPlaceholderLocation(draft.fromLocationText);
      nextLocations = [...nextLocations, loc];
      fromLocationId = loc.id;
    }
  }

  const extraLegs = (draft.extraLegs || []).filter(l => l.locationId || l.locationText);
  const route = [];
  if (extraLegs.length) {
    const homeId = fromLocationId || activeHomeBaseId(homeBases, draft);
    route.push({ locationId: homeId, modeFromPrevious: null });
    route.push({ locationId: toLocationId, modeFromPrevious: draft.mode || 'plane' });
    for (const leg of extraLegs) {
      let id = leg.locationId;
      if (!id && leg.locationText) {
        const found = findLocationByText(nextLocations, leg.locationText);
        if (found) id = found.id;
        else {
          const loc = createPlaceholderLocation(leg.locationText);
          nextLocations = [...nextLocations, loc];
          id = loc.id;
        }
      }
      if (id) route.push({ locationId: id, modeFromPrevious: leg.modeFromPrevious || draft.mode || 'plane' });
    }
  }

  const count = trips.filter(t => Number(t.year) === Number(draft.year)).length + 1;
  const label = draft.label || displayNameFromLocation(nextLocations.find(l => l.id === toLocationId)) || draft.toLocationText || 'Trip';
  const clean = {
    id: draft.id || `${draft.year}-${String(trips.length + 1).padStart(3,'0')}-${slug(label)}`,
    year: Number(draft.year),
    month: draft.month ? Number(draft.month) : null,
    day: draft.day ? Number(draft.day) : null,
    displayDate: formatDisplayDate(draft),
    sortKey: buildSortKey(draft, count),
    label,
    travelers: draft.travelers?.length ? draft.travelers : ['joey','bonnie'],
    mode: draft.mode || 'plane',
    roundTrip: route.length ? false : !!draft.roundTrip,
    fromLocationId,
    toLocationId,
    route,
    notes: draft.notes || '',
    occasion: draft.occasion || ''
  };
  return { trip: clean, nextLocations };
}
function insertChronologically(trips) { return sortTripsForEditor(trips).map((t, i) => ({ ...t, sortKey: t.sortKey || buildSortKey(t, i + 1) })); }
function applyBucketOrder(rows) {
  const counters = new Map();
  return rows.map(t => {
    const key = bucketKey(t);
    const n = (counters.get(key) || 0) + 1;
    counters.set(key, n);
    return { ...t, sortKey: `${key}-${String(n).padStart(3,'0')}` };
  }).sort((a,b) => String(a.sortKey).localeCompare(String(b.sortKey)));
}
function bucketKey(t) { return `${t.year}-${String(t.month || 13).padStart(2,'0')}-${String(t.day || 99).padStart(2,'0')}`; }
function buildSortKey(t, n) { return `${bucketKey(t)}-${String(n).padStart(3,'0')}`; }
function sortTripsForEditor(rows) { return [...rows].sort((a,b) => String(a.sortKey || buildSortKey(a, 999)).localeCompare(String(b.sortKey || buildSortKey(b, 999)))); }
function activeHomeBaseId(homeBases, trip) { const key = `${trip.year}-${String(trip.month || 1).padStart(2,'0')}`; return (homeBases || []).find(h => h.start <= key && (!h.end || h.end >= key))?.locationId || 'melbourne-fl'; }
function formatDisplayDate(t) { if (t.month && t.day) return new Date(t.year, t.month - 1, t.day).toLocaleDateString(undefined, { month:'long', day:'numeric', year:'numeric' }); if (t.month) return new Date(t.year, t.month - 1, 1).toLocaleDateString(undefined, { month:'long', year:'numeric' }); return String(t.year); }
function formatTripDate(t) { return t.displayDate || formatDisplayDate(t); }
function displayLocation(l) { return l ? [l.name, l.region && regionShort(l.region), l.country !== 'United States' ? l.country : ''].filter(Boolean).join(', ') : ''; }
function displayNameFromLocation(l) { return l?.name || ''; }
function summarizeTrip(t, locById) { const to = locById[t.toLocationId]; const people = t.travelers?.includes('joey') && t.travelers?.includes('bonnie') ? 'Joey + Bonnie' : t.travelers?.includes('bonnie') ? 'Bonnie' : 'Joey'; return `${MODE_OPTIONS.find(m => m.id === t.mode)?.label || t.mode} · ${people} · ${displayLocation(to) || t.toLocationName || t.toLocationId || 'Unmapped destination'}`; }
function filterLocations(locs, q) { const needle = String(q || '').toLowerCase().trim(); if (!needle) return locs.slice(0, 6); return locs.filter(l => `${l.name} ${l.region} ${l.country} ${l.id}`.toLowerCase().includes(needle)); }
function findLocationByText(locs, text) { const q = String(text || '').toLowerCase().trim(); return locs.find(l => [l.id, l.name, displayLocation(l)].some(v => String(v).toLowerCase() === q)) || locs.find(l => displayLocation(l).toLowerCase().includes(q) || q.includes(l.name.toLowerCase())); }
function createPlaceholderLocation(text) { const name = String(text || 'New destination').split(',')[0].trim(); return { id: slug(text || name), name, region: '', country: '', continent: '', lat: 0, lon: 0, needsGeocoding: true }; }
function regionShort(region) { const map = { California:'CA', Florida:'FL', Georgia:'GA', Illinois:'IL', 'New York':'NY', Texas:'TX', Nevada:'NV', Arizona:'AZ', Colorado:'CO', Tennessee:'TN', Kentucky:'KY', Washington:'WA', Massachusetts:'MA', Michigan:'MI', 'North Carolina':'NC', 'South Carolina':'SC', Pennsylvania:'PA', Maryland:'MD', Hawaii:'HI' }; return map[region] || region; }
function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') || `location-${Date.now()}`; }
function githubHeaders(token) { return { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }; }
function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function toBase64(str) { return btoa(unescape(encodeURIComponent(str))); }
