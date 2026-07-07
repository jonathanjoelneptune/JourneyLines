import { useEffect, useMemo, useRef, useState } from 'react';

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
const MONTH_OPTIONS = [
  { value: '', label: 'Choose month' },
  { value: 1, label: 'January' },
  { value: 2, label: 'February' },
  { value: 3, label: 'March' },
  { value: 4, label: 'April' },
  { value: 5, label: 'May' },
  { value: 6, label: 'June' },
  { value: 7, label: 'July' },
  { value: 8, label: 'August' },
  { value: 9, label: 'September' },
  { value: 10, label: 'October' },
  { value: 11, label: 'November' },
  { value: 12, label: 'December' }
];
const empty = {
  year: new Date().getFullYear(), month: null, day: null, endYear: null, endMonth: null, endDay: null, label: '', travelers: ['joey','bonnie'], mode: 'plane',
  roundTrip: true, fromLocationId: null, toLocationId: '', toLocationText: '', notes: '', occasion: '', route: [], extraLegs: [], overrideFrom: false
};

export default function AdminPanel({ trips, setTrips, locations, setLocations, homeBases, initialEditTripId, onConsumedInitialEdit }) {
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
  const studioListRef = useRef(null);
  const restoreScrollRef = useRef(null);
  const locs = useMemo(() => [...locations].sort((a,b) => a.name.localeCompare(b.name)), [locations]);
  const locById = useMemo(() => Object.fromEntries(locations.map(l => [l.id, l])), [locations]);
  const sortedTrips = useMemo(() => sortTripsForEditor(trips), [trips]);

  useEffect(() => {
    if (!initialEditTripId) return;
    const trip = trips.find(t => t.id === initialEditTripId);
    if (trip) openEdit(trip);
    onConsumedInitialEdit?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialEditTripId]);

  useEffect(() => {
    if (restoreScrollRef.current == null || !studioListRef.current) return;
    const y = restoreScrollRef.current;
    requestAnimationFrame(() => {
      if (studioListRef.current) studioListRef.current.scrollTop = y;
      restoreScrollRef.current = null;
    });
  }, [trips]);

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
      if (!draft.year || !draft.month) throw new Error('Year and month are required before saving.');
      const currentScroll = studioListRef.current?.scrollTop ?? null;
      const { trip, nextLocations } = normalizeTrip(draft, trips, locations, homeBases);
      const nextTrips = editingId ? trips.map(t => t.id === editingId ? { ...t, ...trip, id: editingId } : t) : insertChronologically([...trips, trip]);
      if (currentScroll != null) restoreScrollRef.current = currentScroll;
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

      <div ref={studioListRef} className={`studio-trip-list ${reorderMode ? 'is-reordering' : ''}`}>
        {(reorderMode ? orderDraft : sortedTrips).map(trip => <div
          className="studio-trip-row"
          style={{ '--accent': tripAccent(trip) }}
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
      homeBases={homeBases}
    />}
  </section>;
}

function TripModal({ mode, draft, setDraft, busy, locs, locById, homeBases, onClose, onSave, onTravelerToggle, onChooseDestination, onChooseFrom, onChooseExtraLeg, onSetExtraLeg, onAddLeg, onRemoveLeg }) {
  const destinationMatches = filterLocations(locs, draft.toLocationText || '');
  const fromMatches = filterLocations(locs, draft.fromLocationText || '');
  const title = mode === 'add' ? 'Add a trip' : draft.label || draft.toLocationText || 'Edit trip';
  const defaultFromId = activeHomeBaseId(homeBases, draft);
  const defaultFrom = locById[defaultFromId];
  const effectiveStart = draft.overrideFrom ? (locById[draft.fromLocationId] || findLocationByText(locs, draft.fromLocationText) || { name: draft.fromLocationText || 'Override start' }) : defaultFrom;
  const effectiveDestination = locById[draft.toLocationId] || findLocationByText(locs, draft.toLocationText) || (draft.toLocationText ? { name: draft.toLocationText } : null);
  const yearOptions = buildYearOptions(locs, draft.year);
  const dateRangeLabel = formatDateRangeLabel(draft);
  const [dateRangeOpen, setDateRangeOpen] = useState(false);
  const [rangePhase, setRangePhase] = useState('start');
  const [calendarCursor, setCalendarCursor] = useState(() => ({ year: Number(draft.year) || new Date().getFullYear(), month: Number(draft.month) || new Date().getMonth() + 1 }));

  function selectCalendarDay(day) {
    const selected = { year: calendarCursor.year, month: calendarCursor.month, day };
    if (rangePhase === 'start') {
      setDraft({ ...draft, ...selected, endYear: null, endMonth: null, endDay: null });
      setRangePhase('end');
    } else {
      const startKey = dateKey(draft.year, draft.month, draft.day);
      const endKey = dateKey(selected.year, selected.month, selected.day);
      if (startKey && endKey && endKey < startKey) {
        setDraft({ ...draft, ...selected, endYear: draft.year || selected.year, endMonth: draft.month || selected.month, endDay: draft.day || selected.day });
      } else {
        setDraft({ ...draft, endYear: selected.year, endMonth: selected.month, endDay: selected.day });
      }
      setDateRangeOpen(false);
      setRangePhase('start');
    }
  }

  return <div className="studio-modal-backdrop">
    <div className="studio-modal glass studio-modal--wide">
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

        <div className="studio-form-grid studio-form-grid--sticky-fields studio-form-grid--dates">
          <label className="title-field">Trip title<input value={draft.label || ''} onChange={e => setDraft({...draft, label:e.target.value})} placeholder="Cabo Trip" /></label>
          <label>Year<select className={!draft.year ? 'needs-choice' : ''} value={draft.year || ''} onChange={e => setDraft({...draft, year:Number(e.target.value)})}><option value="">Choose year</option>{yearOptions.map(y => <option key={y} value={y}>{y}</option>)}</select></label>
          <label>Month<select className={!draft.month ? 'needs-choice' : ''} value={draft.month || ''} onChange={e => setDraft({...draft, month:e.target.value ? Number(e.target.value) : null, day:e.target.value ? draft.day : null})}>{MONTH_OPTIONS.map(m => <option key={m.value || 'choose'} value={m.value}>{m.label}</option>)}</select></label>
          <label className="date-range-field">Trip dates<button type="button" className="date-range-button" onClick={() => { setDateRangeOpen(v => !v); setRangePhase('start'); }}>{dateRangeLabel || 'Choose start and end dates'}<span>▾</span></button></label>
        </div>
      </div>

      <div className="studio-modal-scroll-content studio-modal-layout">
        <div className="studio-modal-maincol">
          <section className="studio-pick-section compact-section">
            <h3>Travelers</h3>
            <div className="pill-selectors">
              {TRAVELER_OPTIONS.map(t => <button key={t.id} type="button" className={`traveler-pill ${draft.travelers?.includes(t.id) ? 'is-selected' : ''}`} style={{ '--accent': t.color }} onClick={() => onTravelerToggle(t.id)}><span></span>{t.label}</button>)}
            </div>
          </section>

          <section className="studio-pick-section compact-section">
            <h3>Travel mode</h3>
            <div className="mode-selectors">
              {MODE_OPTIONS.map(m => <button key={m.id} type="button" className={`mode-tile ${draft.mode === m.id ? 'is-selected' : ''}`} onClick={() => setDraft({...draft, mode:m.id})}><span>{m.icon}</span>{m.label}</button>)}
            </div>
          </section>

          <section className="studio-pick-section route-section compact-section">
            <h3>Route</h3>
            <div className="route-form">
              <div className="default-start-row">
                <div className="default-start-card">
                  <span>Start location</span>
                  <strong>{displayLocation(defaultFrom) || 'Current home base'}</strong>
                  <small>Auto-derived from trip date and active home base</small>
                </div>
                <label className="check premium-check override-check"><input type="checkbox" checked={!!draft.overrideFrom} onChange={e => setDraft({...draft, overrideFrom:e.target.checked, fromLocationId:e.target.checked ? draft.fromLocationId : null})}/> Override start location</label>
              </div>
              {draft.overrideFrom && <AutocompleteField label="From" value={draft.fromLocationText || displayLocation(locById[draft.fromLocationId]) || ''} onChange={v => setDraft({...draft, fromLocationText:v, fromLocationId:''})} matches={fromMatches} onChoose={onChooseFrom} />}
              <AutocompleteField prominent label="Destination" value={draft.toLocationText || ''} onChange={v => setDraft({...draft, toLocationText:v, toLocationId:''})} matches={destinationMatches} onChoose={onChooseDestination} />
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

          <div className="studio-form-grid single compact-section">
            <label>Notes<textarea value={draft.notes || ''} onChange={e => setDraft({...draft, notes:e.target.value})} placeholder="Vacation, work trip, birthday, etc." /></label>
          </div>

          <section className="photo-placeholder compact-section">
            <button type="button" disabled><span>＋</span> Upload photos</button>
            <p>Photo uploads are reserved for the next media pass.</p>
          </section>
        </div>

        <TripRoutePreview draft={draft} locById={locById} locs={locs} startLocation={effectiveStart} destination={effectiveDestination} />

        {dateRangeOpen && <DateRangePopover
          draft={draft}
          cursor={calendarCursor}
          setCursor={setCalendarCursor}
          phase={rangePhase}
          onClose={() => setDateRangeOpen(false)}
          onSelectDay={selectCalendarDay}
        />}
      </div>
    </div>
  </div>;
}

function TripRoutePreview({ draft, locById, locs, startLocation, destination }) {
  const rows = [];
  rows.push({ label: 'Start location', place: displayLocation(startLocation) || startLocation?.name || 'Auto-derived start', mode: null });
  rows.push({ label: 'Leg 1', place: displayLocation(destination) || destination?.name || draft.toLocationText || 'Destination pending', mode: draft.mode || 'plane' });
  const previewExtraLegs = (draft.extraLegs || []);
  previewExtraLegs.forEach((leg, i) => {
    const loc = locById[leg.locationId] || findLocationByText(locs, leg.locationText) || { name: leg.locationText };
    rows.push({ label: `Leg ${i + 2}`, place: displayLocation(loc) || loc?.name || 'Destination pending', mode: leg.modeFromPrevious || draft.mode || 'plane' });
  });
  const lastExtra = previewExtraLegs.length ? previewExtraLegs[previewExtraLegs.length - 1] : null;
  const lastExtraLoc = lastExtra ? (locById[lastExtra.locationId] || findLocationByText(locs, lastExtra.locationText) || { name: lastExtra.locationText }) : null;
  const endPlace = previewExtraLegs.length
    ? (displayLocation(lastExtraLoc) || lastExtraLoc?.name || 'End pending')
    : draft.roundTrip
      ? (displayLocation(startLocation) || startLocation?.name || 'Return to start')
      : (displayLocation(destination) || destination?.name || draft.toLocationText || 'Destination pending');
  rows.push({ label: 'End location', place: endPlace, mode: previewExtraLegs.length ? null : (draft.roundTrip ? draft.mode || 'plane' : null) });
  return <aside className="route-preview-card">
    <p className="eyebrow">Trip preview</p>
    <h3>{draft.label || destination?.name || 'New trip'}</h3>
    <div className="route-preview-list">
      {rows.map((r, i) => <div className="route-preview-row" key={`${r.label}-${i}`}>
        <span className="route-preview-icon">{r.mode ? modeIcon(r.mode) : '●'}</span>
        <div><strong>{r.label}</strong><small>{r.place}</small></div>
        <span className="route-preview-people">{travelerSummary(draft.travelers)}</span>
      </div>)}
    </div>
  </aside>;
}

function DateRangePopover({ draft, cursor, setCursor, phase, onClose, onSelectDay }) {
  const days = calendarDays(cursor.year, cursor.month);
  const monthName = new Date(cursor.year, cursor.month - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const startKey = dateKey(draft.year, draft.month, draft.day);
  const endKey = dateKey(draft.endYear, draft.endMonth, draft.endDay);
  function move(delta) {
    const d = new Date(cursor.year, cursor.month - 1 + delta, 1);
    setCursor({ year: d.getFullYear(), month: d.getMonth() + 1 });
  }
  return <div className="date-range-popover glass">
    <div className="date-range-head"><button type="button" onClick={() => move(-1)}>‹</button><strong>{monthName}</strong><button type="button" onClick={() => move(1)}>›</button></div>
    <p>{phase === 'start' ? 'Choose a start date' : 'Choose an end date'}</p>
    <div className="date-weekdays">{['S','M','T','W','T','F','S'].map(d => <span key={d}>{d}</span>)}</div>
    <div className="date-grid">{days.map((d, i) => d ? <button key={i} type="button" className={`${dateKey(cursor.year, cursor.month, d) === startKey ? 'is-start' : ''} ${dateKey(cursor.year, cursor.month, d) === endKey ? 'is-end' : ''}`} onClick={() => onSelectDay(d)}>{d}</button> : <span key={i}></span>)}</div>
    <div className="date-range-foot"><button type="button" onClick={onClose}>Done</button></div>
  </div>;
}

function AutocompleteField({ label, value, onChange, matches, onChoose, compact, prominent }) {
  return <label className={`autocomplete-field ${compact ? 'compact' : ''} ${prominent ? 'is-prominent' : ''}`}>{label}
    <input value={value} onChange={e => onChange(e.target.value)} placeholder="Start typing a destination" />
    {!!value && matches.length > 0 && <div className="autocomplete-menu">
      {matches.slice(0, 8).map(l => <button type="button" key={l.id} onClick={() => onChoose(l)}><strong>{l.name}</strong><small>{[l.region, l.country].filter(Boolean).join(', ')}</small></button>)}
    </div>}
  </label>;
}

function normalizeTrip(draft, trips, locations, homeBases) {
  if (!draft.year || !draft.month) throw new Error('Year and month are required before saving.');
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
    endYear: draft.endYear ? Number(draft.endYear) : null,
    endMonth: draft.endMonth ? Number(draft.endMonth) : null,
    endDay: draft.endDay ? Number(draft.endDay) : null,
    displayDate: formatDisplayDate(draft),
    displayEndDate: formatEndDisplayDate(draft),
    sortKey: draft.id && draft.sortKey && String(draft.sortKey).startsWith(bucketKey(draft)) ? draft.sortKey : buildSortKey(draft, count),
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

function buildYearOptions(locs, currentYear) {
  const thisYear = new Date().getFullYear();
  const years = [];
  for (let y = 2012; y <= thisYear + 5; y++) years.push(y);
  if (currentYear && !years.includes(Number(currentYear))) years.push(Number(currentYear));
  return years.sort((a,b) => b - a);
}
function toDateInputValue(year, month, day) {
  if (!year || !month || !day) return '';
  return `${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}
function datePartsFromInput(value, prefix = '') {
  if (!value) return prefix === 'end' ? { endYear: null, endMonth: null, endDay: null } : { year: new Date().getFullYear(), month: null, day: null };
  const [year, month, day] = value.split('-').map(Number);
  if (prefix === 'end') return { endYear: year, endMonth: month, endDay: day };
  return { year, month, day };
}
function formatEndDisplayDate(t) {
  if (!t.endYear) return '';
  return formatDisplayDate({ year: t.endYear, month: t.endMonth, day: t.endDay });
}
function tripAccent(trip) {
  const hasJ = trip.travelers?.includes('joey');
  const hasB = trip.travelers?.includes('bonnie');
  if (hasJ && hasB) return '#00e5ff';
  if (hasB) return '#ff4fd8';
  return '#ff8a00';
}


function modeIcon(mode) { return MODE_OPTIONS.find(m => m.id === mode)?.icon || '•'; }
function travelerSummary(travelers = []) { const hasJ = travelers.includes('joey'); const hasB = travelers.includes('bonnie'); return hasJ && hasB ? 'Joey + Bonnie' : hasB ? 'Bonnie' : 'Joey'; }
function formatDateRangeLabel(t) {
  const start = toDateInputValue(t.year, t.month, t.day);
  const end = toDateInputValue(t.endYear, t.endMonth, t.endDay);
  if (start && end) return `${new Date(start + 'T00:00:00').toLocaleDateString()} → ${new Date(end + 'T00:00:00').toLocaleDateString()}`;
  if (start) return new Date(start + 'T00:00:00').toLocaleDateString();
  return '';
}
function dateKey(year, month, day) {
  if (!year || !month || !day) return '';
  return `${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}
function calendarDays(year, month) {
  const first = new Date(year, month - 1, 1);
  const last = new Date(year, month, 0).getDate();
  const out = Array(first.getDay()).fill(null);
  for (let d = 1; d <= last; d++) out.push(d);
  return out;
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
