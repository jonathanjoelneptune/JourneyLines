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
  roundTrip: true, returnMode: '', fromLocationId: null, toLocationId: '', toLocationText: '', notes: '', occasion: '', route: [], extraLegs: [], overrideFrom: false
};

export default function AdminPanel({ trips, setTrips, locations, setLocations, homeBases, initialEditTripId, initialScroll, onScrollStore, onConsumedInitialEdit, viewType = 'expanded', onViewTypeChange }) {
  const [draft, setDraft] = useState(empty);
  const [modal, setModal] = useState(null); // 'add' | 'edit' | null
  const [modalClosing, setModalClosing] = useState(false);
  const [closing, setClosing] = useState(false);
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

  function previewMapLocation(location) {
    if (!location || location.lon == null || location.lat == null) return;
    window.dispatchEvent(new CustomEvent('globehoppers-preview-location', { detail: { lon: location.lon, lat: location.lat, name: displayLocation(location) || location.name } }));
  }

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

  useEffect(() => {
    if (!studioListRef.current) return;
    requestAnimationFrame(() => {
      if (studioListRef.current) studioListRef.current.scrollTop = initialScroll || 0;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    function handleRequestClose() {
      requestCloseStudio();
    }
    window.addEventListener('globehoppers-request-close-studio', handleRequestClose);
    return () => window.removeEventListener('globehoppers-request-close-studio', handleRequestClose);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closing]);


  function saveLocalToken(value) { setToken(value); localStorage.setItem('journeylines.githubToken', value); }
  function saveRepo(value) { setRepo(value); localStorage.setItem('journeylines.repo', value); }

  function openAdd() {
    setModalClosing(false);
    setEditingId(null);
    setDraft({ ...empty, year: new Date().getFullYear(), month: null, toLocationText: '' });
    setModal('add');
  }
  function openEdit(trip) {
    setModalClosing(false);
    const route = Array.isArray(trip.route) ? trip.route : [];
    const hasRoute = route.length > 1;
    const routeStart = hasRoute ? route[0] : null;
    const routeDestination = hasRoute ? route[1] : null;
    const routeEnd = hasRoute ? route[route.length - 1] : null;
    const returnsToStart = !!(trip.roundTrip && routeStart?.locationId && routeEnd?.locationId === routeStart.locationId && route.length > 2);
    const extraRouteStops = hasRoute ? route.slice(2, returnsToStart ? -1 : undefined) : [];
    const to = locById[routeDestination?.locationId || trip.toLocationId];
    const derivedReturnMode = returnsToStart ? (routeEnd?.modeFromPrevious || trip.returnMode || trip.mode || 'plane') : (trip.returnMode || trip.mode || 'plane');
    setEditingId(trip.id);
    setDraft({
      ...empty,
      ...trip,
      returnMode: derivedReturnMode,
      overrideFrom: !!trip.fromLocationId || !!route.length,
      fromLocationId: routeStart?.locationId || trip.fromLocationId || null,
      fromLocationText: routeStart?.locationId ? displayLocation(locById[routeStart.locationId]) : '',
      toLocationId: routeDestination?.locationId || trip.toLocationId || '',
      toLocationText: to ? displayLocation(to) : (trip.toLocationName || trip.label || ''),
      extraLegs: extraRouteStops.map(r => ({ locationId: r.locationId || '', locationText: displayLocation(locById[r.locationId]) || '', modeFromPrevious: r.modeFromPrevious || trip.mode || 'plane' }))
    });
    setModal('edit');
  }
  function closeModal() {
    if (!modal) return;
    setModalClosing(true);
    window.setTimeout(() => {
      setModal(null);
      setModalClosing(false);
      setEditingId(null);
      setDraft(empty);
    }, 260);
  }

  function updateTraveler(id) {
    const set = new Set(draft.travelers || []);
    if (set.has(id)) set.delete(id); else set.add(id);
    const next = Array.from(set);
    setDraft({ ...draft, travelers: next });
  }

  function chooseDestination(location) {
    setDraft({ ...draft, toLocationId: location.id, toLocationText: displayLocation(location), label: draft.label || location.name });
    previewMapLocation(location);
  }
  function chooseFrom(location) {
    setDraft({ ...draft, fromLocationId: location.id, fromLocationText: displayLocation(location), overrideFrom: true });
    previewMapLocation(location);
  }
  function chooseExtraLeg(index, location) {
    const extraLegs = [...(draft.extraLegs || [])];
    extraLegs[index] = { ...extraLegs[index], locationId: location.id, locationText: displayLocation(location) };
    setDraft({ ...draft, extraLegs });
    previewMapLocation(location);
  }
  function setExtraLeg(index, patch) {
    const extraLegs = [...(draft.extraLegs || [])];
    extraLegs[index] = { ...extraLegs[index], ...patch };
    setDraft({ ...draft, extraLegs });
  }
  function addLeg() { setDraft({ ...draft, extraLegs: [...(draft.extraLegs || []), { locationId: '', locationText: '', modeFromPrevious: draft.mode || 'plane' }] }); }
  function removeLeg(index) { setDraft({ ...draft, extraLegs: (draft.extraLegs || []).filter((_, i) => i !== index) }); }
  function setReturnMode(mode) { setDraft({ ...draft, returnMode: mode }); }
  function setPreviewLegMode(target, mode) {
    if (target === 'main') setDraft({ ...draft, mode, returnMode: draft.returnMode || mode });
    else if (target === 'return') setDraft({ ...draft, returnMode: mode });
    else if (typeof target === 'number') setExtraLeg(target, { modeFromPrevious: mode });
  }

  async function saveTripFromModal() {
    try {
      setBusy(true);
      if (!draft.year || !draft.month) throw new Error('Year and month are required before saving.');
      if (!draft.travelers?.length) throw new Error('Select at least one traveler before saving.');
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
  async function deleteTripFromModal() {
    if (!editingId) return;
    const label = draft.label || draft.toLocationText || editingId;
    if (!confirm(`Delete ${label}?`)) return;
    try {
      setBusy(true);
      const currentScroll = studioListRef.current?.scrollTop ?? null;
      const nextTrips = trips.filter(t => t.id !== editingId);
      if (currentScroll != null) restoreScrollRef.current = currentScroll;
      setTrips(nextTrips);
      await commitData(nextTrips, locations, `Delete trip: ${label}`);
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
  function requestCloseStudio() {
    if (closing) return;
    setClosing(true);
    window.setTimeout(() => window.dispatchEvent(new CustomEvent('globehoppers-close-studio')), 420);
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

  return <section className={`studio-shell ${closing ? 'is-closing' : ''}`}>
    <aside className={`studio-panel glass studio-panel--${viewType}`}>
      <div className="studio-header drawer-header-unified">
        <p className="eyebrow">GlobeHoppers Studio</p>
        <StudioViewTypeSelector value={viewType} onChange={onViewTypeChange} />
        <button className="studio-close drawer-close-button" onClick={requestCloseStudio}>Close</button>
        <h2>Edit Travel History</h2>
      </div>

      <div className="studio-actions-main">
        <button className="primary" onClick={openAdd}>New Trip</button>
        {!reorderMode && <button onClick={enterReorder}>Reorder</button>}
        {reorderMode && <><button className="primary" onClick={saveReorder} disabled={busy}>Save order</button><button onClick={() => setReorderMode(false)}>Cancel reorder</button></>}
      </div>

      <div ref={studioListRef} className={`studio-trip-list ${reorderMode ? 'is-reordering' : ''} studio-trip-list--${viewType}`} onScroll={(e) => onScrollStore?.(e.currentTarget.scrollTop)}>
        {viewType === 'card' ? groupTripsByYear(reorderMode ? orderDraft : sortedTrips).map(group => <section className="timeline-year-section studio-year-section" key={group.year}>
          <h3>{group.year}</h3>
          <div className="timeline-card-grid studio-card-grid">
            {group.rows.map(trip => <StudioTripRow key={trip.id} trip={trip} viewType={viewType} reorderMode={reorderMode} dragId={dragId} setDragId={setDragId} moveTrip={moveTrip} locById={locById} onEdit={openEdit} onDelete={del} />)}
          </div>
        </section>) : (reorderMode ? orderDraft : sortedTrips).map(trip => <StudioTripRow key={trip.id} trip={trip} viewType={viewType} reorderMode={reorderMode} dragId={dragId} setDragId={setDragId} moveTrip={moveTrip} locById={locById} onEdit={openEdit} onDelete={del} />)}
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
      closing={modalClosing}
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
      onSetReturnMode={setReturnMode}
      onSetPreviewLegMode={setPreviewLegMode}
      onDelete={modal === 'edit' ? deleteTripFromModal : null}
      homeBases={homeBases}
    />}
  </section>;
}



function StudioTripRow({ trip, viewType, reorderMode, dragId, setDragId, moveTrip, locById, onEdit, onDelete }) {
  const openIfCard = () => { if (!reorderMode && viewType === 'card') onEdit(trip); };
  return <div
    className={`studio-trip-row studio-trip-row--${viewType}`}
    style={{ '--accent': tripAccent(trip) }}
    draggable={reorderMode}
    onClick={openIfCard}
    onContextMenu={(e) => { e.preventDefault(); if (!reorderMode) onEdit(trip); }}
    onDragStart={() => setDragId(trip.id)}
    onDragOver={e => e.preventDefault()}
    onDrop={() => { moveTrip(dragId, trip.id); setDragId(null); }}
  >
    <span className="studio-trip-date">{formatTripDate(trip)}</span>
    <span className="studio-trip-main"><strong>{trip.label || trip.toLocationName || trip.toLocationId}</strong><small>{summarizeTrip(trip, locById)}</small></span>
    <span className="studio-trip-buttons">
      {reorderMode ? <span className="drag-handle">↕</span> : viewType === 'card' ? null : <><button onClick={() => onEdit(trip)}>Edit</button><button onClick={() => onDelete(trip.id)}>Delete</button></>}
    </span>
  </div>;
}

function StudioViewTypeSelector({ value, onChange }) {
  return <div className="view-type-selector" role="group" aria-label="Travel history view type">
    {[['expanded','Expanded'], ['compact','Compact'], ['card','Card']].map(([id, label]) => <button key={id} type="button" className={value === id ? 'is-selected' : ''} onClick={() => onChange?.(id)}>{label}</button>)}
  </div>;
}

function groupTripsByYear(trips = []) {
  const groups = [];
  const byYear = new Map();
  for (const trip of trips) {
    const year = String(trip.year || 'Trips');
    if (!byYear.has(year)) { const group = { year, rows: [] }; byYear.set(year, group); groups.push(group); }
    byYear.get(year).rows.push(trip);
  }
  return groups;
}

function BubbleSelect({ label, value, display, options, open, setOpen, onChoose, required, variant }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event) {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    }
    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [open, setOpen]);
  return <label ref={ref} className={`bubble-select-field ${variant ? `bubble-select-field--${variant}` : ''}`}>{label}{required && <span className="required-dot">Required</span>}
    <button type="button" className={`bubble-select-button ${!value ? 'needs-choice' : ''}`} onClick={() => setOpen(!open)}>
      {display}<span>▾</span>
    </button>
    {open && <div className={`bubble-select-popover glass ${variant ? `bubble-select-popover--${variant}` : ''}`}>
      {options.map(option => <button key={option.value} type="button" className={String(value) === String(option.value) ? 'is-selected' : ''} onClick={() => { onChoose(option.value); setOpen(false); }}>{option.label}</button>)}
    </div>}
  </label>;
}

function TripModal({ mode, closing, draft, setDraft, busy, locs, locById, homeBases, onClose, onSave, onDelete, onTravelerToggle, onChooseDestination, onChooseFrom, onChooseExtraLeg, onSetExtraLeg, onAddLeg, onRemoveLeg, onSetReturnMode, onSetPreviewLegMode }) {
  const destinationMatches = filterLocations(locs, draft.toLocationText || '');
  const fromMatches = filterLocations(locs, draft.fromLocationText || '');
  const title = mode === 'add' ? 'Trip details' : draft.label || draft.toLocationText || 'Edit trip';
  const defaultFromId = activeHomeBaseId(homeBases, draft);
  const defaultFrom = locById[defaultFromId];
  const effectiveStart = draft.overrideFrom ? (locById[draft.fromLocationId] || findLocationByText(locs, draft.fromLocationText) || { name: draft.fromLocationText || 'Override start' }) : defaultFrom;
  const effectiveDestination = locById[draft.toLocationId] || findLocationByText(locs, draft.toLocationText) || (draft.toLocationText ? { name: draft.toLocationText } : null);
  const yearOptions = buildYearOptions(locs, draft.year);
  const dateRangeLabel = formatDateRangeLabel(draft);
  const [dateRangeOpen, setDateRangeOpen] = useState(false);
  const [rangePhase, setRangePhase] = useState('start');
  const [calendarCursor, setCalendarCursor] = useState(() => ({ year: Number(draft.year) || new Date().getFullYear(), month: Number(draft.month) || new Date().getMonth() + 1 }));
  const [yearPickerOpen, setYearPickerOpen] = useState(false);
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const dateRangeRef = useRef(null);
  const bothTravelersSelected = draft.travelers?.includes('joey') && draft.travelers?.includes('bonnie');

  useEffect(() => {
    if (!dateRangeOpen) return;
    function handlePointerDown(event) {
      if (dateRangeRef.current && !dateRangeRef.current.contains(event.target) && !event.target.closest?.('.date-range-field')) {
        setDateRangeOpen(false);
      }
    }
    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [dateRangeOpen]);

  useEffect(() => {
    if (!draft.year && !draft.month) return;
    setCalendarCursor({
      year: Number(draft.year) || new Date().getFullYear(),
      month: Number(draft.month) || 1
    });
  }, [draft.year, draft.month]);

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

  return <div className={`studio-modal-backdrop ${closing ? 'is-closing' : ''}`}>
    <div className={`studio-modal glass studio-modal--wide ${closing ? 'is-closing' : ''}`}>
      <div className="studio-modal-sticky">
        <div className="studio-modal-header studio-modal-header--with-actions">
          <div className="studio-title-block">
            <p className="eyebrow">{mode === 'add' ? 'New Trip' : 'Edit Trip'}</p>
            <h2>{title}</h2>
          </div>
          <div className="studio-modal-top-actions">
            {onDelete && <button className="danger" disabled={busy} onClick={onDelete}>Delete trip</button>}
            <button onClick={onClose}>Cancel</button>
            <button className="primary" disabled={busy} onClick={onSave}>{busy ? 'Saving…' : 'Save and commit'}</button>
          </div>
        </div>

        <div className="studio-form-grid studio-form-grid--sticky-fields studio-form-grid--dates">
          <label className="title-field">Trip title<input value={draft.label || ''} onChange={e => setDraft({...draft, label:e.target.value})} placeholder="Cabo Trip" /></label>
          <BubbleSelect label="Year" value={draft.year || ''} display={draft.year || 'Choose year'} options={yearOptions.map(y => ({ value: y, label: String(y) }))} open={yearPickerOpen} setOpen={setYearPickerOpen} onChoose={(value) => setDraft({...draft, year:Number(value)})} required variant="year" />
          <BubbleSelect label="Month" value={draft.month || ''} display={monthLabel(draft.month) || 'Choose month'} options={MONTH_OPTIONS.filter(m => m.value).map(m => ({ value: m.value, label: m.label }))} open={monthPickerOpen} setOpen={setMonthPickerOpen} onChoose={(value) => setDraft({...draft, month:Number(value), day:draft.day})} required variant="month" />
          <label className="date-range-field">Trip dates<button type="button" className="date-range-button" onClick={() => { setCalendarCursor({ year: Number(draft.year) || new Date().getFullYear(), month: Number(draft.month) || 1 }); setDateRangeOpen(v => !v); setRangePhase('start'); }}>{dateRangeLabel || 'Choose Trip Dates'}<span>▾</span></button>
            {dateRangeOpen && <DateRangePopover
              popoverRef={dateRangeRef}
              draft={draft}
              cursor={calendarCursor}
              setCursor={setCalendarCursor}
              phase={rangePhase}
              onClose={() => setDateRangeOpen(false)}
              onSelectDay={selectCalendarDay}
            />}
          </label>
        </div>
      </div>

      <div className="studio-modal-scroll-content studio-modal-layout">
        <div className="studio-modal-maincol">
          <section className="studio-pick-section compact-section travelers-section">
            <h3>Travelers</h3>
            <div className="pill-selectors">
              {TRAVELER_OPTIONS.map(t => { const selected = draft.travelers?.includes(t.id); const accent = selected && bothTravelersSelected ? '#00e5ff' : t.color; return <button key={t.id} type="button" className={`traveler-pill ${selected ? 'is-selected' : ''}`} style={{ '--accent': accent }} onClick={() => onTravelerToggle(t.id)}><span className="traveler-dot"></span>{t.label}</button>; })}
            </div>
          </section>

          <section className="studio-pick-section compact-section transport-triptype-row">
            <div className="transport-choice-group"><h3>Mode of Transportation</h3>
            <div className="mode-selectors">
              {MODE_OPTIONS.map(m => <button key={m.id} type="button" className={`mode-tile ${draft.mode === m.id ? 'is-selected' : ''}`} onClick={() => setDraft({...draft, mode:m.id})}><span>{m.icon}</span>{m.label}</button>)}
            </div></div>
            <div className="trip-type-selector"><h3>Trip type</h3>
              <div className="trip-type-options">
                <button type="button" className={`trip-type-tile ${draft.roundTrip ? 'is-selected' : ''}`} onClick={() => setDraft({...draft, roundTrip: true})}><span>↩</span> Round Trip</button>
                <button type="button" className={`trip-type-tile ${!draft.roundTrip ? 'is-selected' : ''}`} onClick={() => setDraft({...draft, roundTrip: false})}><span>→</span> One Way</button>
              </div>
            </div>
          </section>

          <section className="studio-pick-section route-section compact-section">
            <h3>Route</h3>
            <div className="route-form">
              <div className="default-start-row">
                {!draft.overrideFrom ? <div className="default-start-card">
                  <span>Start location</span>
                  <strong>{displayLocation(defaultFrom) || 'Current home base'}</strong>
                  <small>Auto-derived from trip date and active home base</small>
                </div> : <div className="default-start-card override-start-card">
                  <AutocompleteField compact prominent label="Start Location" value={draft.fromLocationText || displayLocation(locById[draft.fromLocationId]) || ''} onChange={v => setDraft({...draft, fromLocationText:v, fromLocationId:''})} matches={fromMatches} onChoose={onChooseFrom} />
                </div>}
                <label className="check premium-check override-check"><input type="checkbox" checked={!!draft.overrideFrom} onChange={e => setDraft({...draft, overrideFrom:e.target.checked, fromLocationId:e.target.checked ? draft.fromLocationId : null})}/> Override start location</label>
              </div>
              <AutocompleteField prominent label="Destination" value={draft.toLocationText || ''} onChange={v => setDraft({...draft, toLocationText:v, toLocationId:''})} matches={destinationMatches} onChoose={onChooseDestination} />
              <div className="legs-block">
                <div className="legs-header"><strong>Additional legs</strong><button className="add-leg-button" type="button" onClick={onAddLeg}><span>＋</span> Add Leg</button></div>
                {(draft.extraLegs || []).map((leg, index) => <div className="leg-row" key={index}>
                  <select value={leg.modeFromPrevious || draft.mode || 'plane'} onChange={e => onSetExtraLeg(index, { modeFromPrevious: e.target.value })}>{MODE_OPTIONS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
                  <AutocompleteField compact label={`Leg ${index + 2} destination`} value={leg.locationText || displayLocation(locById[leg.locationId]) || ''} onChange={v => onSetExtraLeg(index, { locationText: v, locationId: '' })} matches={filterLocations(locs, leg.locationText || '')} onChoose={loc => onChooseExtraLeg(index, loc)} />
                  <button type="button" onClick={() => onRemoveLeg(index)}>Remove</button>
                </div>)}
              </div>
              {draft.roundTrip && <div className="return-mode-card">
                <div>
                  <span>Return home method</span>
                  <small>Defaults to Leg 1, but can be changed for chained trips.</small>
                </div>
                <div className="return-mode-options">
                  {MODE_OPTIONS.map(m => <button key={m.id} type="button" className={(draft.returnMode || draft.mode || 'plane') === m.id ? 'is-selected' : ''} onClick={() => onSetReturnMode(m.id)}><span>{m.icon}</span>{m.label}</button>)}
                </div>
              </div>}
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

        <TripRoutePreview draft={draft} locById={locById} locs={locs} startLocation={effectiveStart} destination={effectiveDestination} onSetLegMode={onSetPreviewLegMode} />

      </div>
    </div>
  </div>;
}

function TripRoutePreview({ draft, locById, locs, startLocation, destination, onSetLegMode }) {
  const rows = [];
  rows.push({ label: 'Start location', place: displayLocation(startLocation) || startLocation?.name || 'Auto-derived start', mode: null, target: null });
  rows.push({ label: 'Leg 1', place: displayLocation(destination) || destination?.name || draft.toLocationText || 'Destination pending', mode: draft.mode || 'plane', target: 'main' });
  const previewExtraLegs = (draft.extraLegs || []);
  previewExtraLegs.forEach((leg, i) => {
    const loc = locById[leg.locationId] || findLocationByText(locs, leg.locationText) || { name: leg.locationText };
    rows.push({ label: `Leg ${i + 2}`, place: displayLocation(loc) || loc?.name || 'Destination pending', mode: leg.modeFromPrevious || draft.mode || 'plane', target: i });
  });
  const lastExtra = previewExtraLegs.length ? previewExtraLegs[previewExtraLegs.length - 1] : null;
  const lastExtraLoc = lastExtra ? (locById[lastExtra.locationId] || findLocationByText(locs, lastExtra.locationText) || { name: lastExtra.locationText }) : null;
  const endPlace = draft.roundTrip
    ? (displayLocation(startLocation) || startLocation?.name || 'Return to start')
    : previewExtraLegs.length
      ? (displayLocation(lastExtraLoc) || lastExtraLoc?.name || 'End pending')
      : (displayLocation(destination) || destination?.name || draft.toLocationText || 'Destination pending');
  if (draft.roundTrip) {
    rows.push({ label: 'Return home', place: endPlace, mode: draft.returnMode || draft.mode || 'plane', target: 'return' });
  }
  rows.push({ label: 'End location', place: endPlace, mode: null, target: null, pin: true });
  return <aside className="route-preview-card" style={{ '--trip-accent': tripAccent(draft) }}>
    <p className="eyebrow">Trip preview</p>
    <h3>{draft.label || destination?.name || 'New trip'}</h3>
    <div className="route-preview-meta">
      <span>{formatDateRangeLabel(draft) || (draft.year ? [monthLabel(draft.month), draft.year].filter(Boolean).join(' ') : 'Dates pending')}</span>
      <span><b></b>{travelerSummary(draft.travelers)} · {groupNameForTravelers(draft.travelers)}</span>
      {(draft.notes || draft.occasion) && <span>{draft.notes || draft.occasion}</span>}
    </div>
    <div className="route-preview-list">
      {rows.map((r, i) => <div className="route-preview-row" key={`${r.label}-${i}`}>
        <PreviewModeButton mode={r.mode} target={r.target} onSetLegMode={onSetLegMode} />
        <div><strong>{r.label}</strong><small>{r.place}</small></div>
        <span className="route-preview-people">{travelerSummary(draft.travelers)}</span>
      </div>)}
    </div>
  </aside>;
}

function PreviewModeButton({ mode, target, onSetLegMode }) {
  if (!mode || target == null) return <span className="route-preview-icon route-preview-pin" title="Location marker">📍</span>;
  const currentIndex = Math.max(0, MODE_OPTIONS.findIndex(m => m.id === mode));
  const current = MODE_OPTIONS[currentIndex] || MODE_OPTIONS[0];
  function cycle() {
    const next = MODE_OPTIONS[(currentIndex + 1) % MODE_OPTIONS.length]?.id || 'plane';
    onSetLegMode?.(target, next);
  }
  return <button type="button" className="route-preview-icon route-preview-icon-button" title={`Change ${current.label} leg mode`} onClick={cycle}>
    <span>{current.icon}</span>
  </button>;
}

function DateRangePopover({ popoverRef, draft, cursor, setCursor, phase, onClose, onSelectDay }) {
  const days = calendarDays(cursor.year, cursor.month);
  const monthName = new Date(cursor.year, cursor.month - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const startKey = dateKey(draft.year, draft.month, draft.day);
  const endKey = dateKey(draft.endYear, draft.endMonth, draft.endDay);
  function move(delta) {
    const d = new Date(cursor.year, cursor.month - 1 + delta, 1);
    setCursor({ year: d.getFullYear(), month: d.getMonth() + 1 });
  }
  return <div ref={popoverRef} className="date-range-popover glass">
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
  if (!draft.travelers?.length) throw new Error('Select at least one traveler before saving.');
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
    if (draft.roundTrip && homeId && route[route.length - 1]?.locationId !== homeId) {
      const returnMode = draft.returnMode || draft.mode || 'plane';
      route.push({ locationId: homeId, modeFromPrevious: returnMode });
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
    travelers: draft.travelers || [],
    mode: draft.mode || 'plane',
    roundTrip: !!draft.roundTrip,
    returnMode: draft.roundTrip ? (draft.returnMode || draft.mode || 'plane') : '',
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
  for (let y = 2012; y <= thisYear; y++) years.push(y);
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
  if (hasJ) return '#ff8a00';
  return '#5d7288';
}


function monthLabel(month) { return MONTH_OPTIONS.find(m => Number(m.value) === Number(month))?.label || ''; }
function modeIcon(mode) { return MODE_OPTIONS.find(m => m.id === mode)?.icon || '•'; }
function travelerSummary(travelers = []) { const hasJ = travelers.includes('joey'); const hasB = travelers.includes('bonnie'); if (!hasJ && !hasB) return 'No travelers selected'; return hasJ && hasB ? 'Joey + Bonnie' : hasB ? 'Bonnie' : 'Joey'; }
function groupNameForTravelers(travelers = []) { const hasJ = travelers.includes('joey'); const hasB = travelers.includes('bonnie'); if (!hasJ && !hasB) return 'Required'; return hasJ && hasB ? 'Group: Joey + Bonnie' : 'Solo trip'; }
function formatDateRangeLabel(t) {
  const start = toDateInputValue(t.year, t.month, t.day);
  const end = toDateInputValue(t.endYear, t.endMonth, t.endDay);
  const fmt = { month: 'long', day: 'numeric', year: 'numeric' };
  if (start && end) return `${new Date(start + 'T00:00:00').toLocaleDateString(undefined, fmt)} → ${new Date(end + 'T00:00:00').toLocaleDateString(undefined, fmt)}`;
  if (start) return new Date(start + 'T00:00:00').toLocaleDateString(undefined, fmt);
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
