import { useEffect, useMemo, useRef, useState } from 'react';
import { colorGradient, normalizeHopperData, resolveTripVisual, segmentedCircleBackground } from '../utils/hopperUtils.js';

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
  year: new Date().getFullYear(), month: null, day: null, endYear: null, endMonth: null, endDay: null, label: '', travelers: [], mode: 'plane',
  roundTrip: true, returnMode: '', fromLocationId: null, toLocationId: '', toLocationText: '', notes: '', occasion: '', route: [], extraLegs: [], overrideFrom: false, trailStyle: 'solid', trailColorMode: 'members'
};

export default function AdminPanel({ trips, setTrips, locations, setLocations, homeBases, initialEditTripId, initialScroll, onScrollStore, onConsumedInitialEdit, viewType = 'expanded', onViewTypeChange, addTripNoun = 'Hop', hopperData, setHopperData, activeTripId, onPlayTrip }) {
  const [draft, setDraft] = useState(empty);
  const [modal, setModal] = useState(null); // 'add' | 'edit' | null
  const [modalClosing, setModalClosing] = useState(false);
  const [closing, setClosing] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [reorderMode, setReorderMode] = useState(false);
  const [orderDraft, setOrderDraft] = useState(() => sortTripsForEditor(trips));
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [formError, setFormError] = useState('');
  const [confirmRequest, setConfirmRequest] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem('journeylines.githubToken') || '');
  const [repo, setRepo] = useState(() => localStorage.getItem('journeylines.repo') || '');
  const [dragId, setDragId] = useState(null);
  const [dropId, setDropId] = useState(null);
  const studioListRef = useRef(null);
  const restoreScrollRef = useRef(null);
  const locs = useMemo(() => [...locations].sort((a,b) => a.name.localeCompare(b.name)), [locations]);
  const locById = useMemo(() => Object.fromEntries(locations.map(l => [l.id, l])), [locations]);
  const sortedTrips = useMemo(() => sortTripsForEditor(trips), [trips]);
  const normalizedHoppers = useMemo(() => normalizeHopperData(hopperData), [hopperData]);

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


  useEffect(() => {
    function handleOpenNewTrip() {
      openAdd();
    }
    window.addEventListener('globehoppers-open-new-trip', handleOpenNewTrip);
    return () => window.removeEventListener('globehoppers-open-new-trip', handleOpenNewTrip);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  function saveLocalToken(value) { setToken(value); localStorage.setItem('journeylines.githubToken', value); }
  function saveRepo(value) { setRepo(value); localStorage.setItem('journeylines.repo', value); }

  function openAdd() {
    window.dispatchEvent(new CustomEvent('globehoppers-pause-for-hop-modal'));
    setFormError('');
    setModalClosing(false);
    setEditingId(null);
    setDraft({ ...empty, travelers: [], year: new Date().getFullYear(), month: null, toLocationText: '' });
    setModal('add');
  }
  function openEdit(trip) {
    window.dispatchEvent(new CustomEvent('globehoppers-pause-for-hop-modal'));
    setFormError('');
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
    setFormError('');
    if (!modal) return;
    setModalClosing(true);
    window.setTimeout(() => {
      setModal(null);
      setModalClosing(false);
      setEditingId(null);
      setDraft(empty);
      window.dispatchEvent(new CustomEvent('globehoppers-resume-after-hop-modal'));
    }, 260);
  }

  function updateTraveler(id) {
    setFormError('');
    const set = new Set(draft.travelers || []);
    if (set.has(id)) set.delete(id); else set.add(id);
    const next = Array.from(set);
    setDraft({ ...draft, travelers: next });
  }

  function chooseDestination(location) {
    setFormError('');
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
      validateHopDraftForSave(draft);
      setBusy(true);
      const currentScroll = studioListRef.current?.scrollTop ?? null;
      const { trip, nextLocations } = normalizeTrip(draft, trips, locations, homeBases, normalizedHoppers);
      const nextTrips = editingId ? trips.map(t => t.id === editingId ? { ...t, ...trip, id: editingId } : t) : insertChronologically([...trips, trip]);
      if (currentScroll != null) restoreScrollRef.current = currentScroll;
      setTrips(nextTrips);
      if (nextLocations !== locations) setLocations(nextLocations);
      await commitData(nextTrips, nextLocations, editingId ? `Edit Hop: ${trip.label || trip.toLocationName || trip.id}` : `Add trip: ${trip.label || trip.toLocationName || trip.id}`);
      closeModal();
    } catch (err) {
      setFormError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }
  async function deleteTripFromModal() {
    if (!editingId) return;
    const label = draft.label || draft.toLocationText || editingId;
    setConfirmRequest({
      title: 'Delete hop?',
      message: `Delete ${label}? This cannot be undone.`,
      confirmLabel: 'Delete hop',
      onConfirm: async () => {
        try {
          setBusy(true);
          const currentScroll = studioListRef.current?.scrollTop ?? null;
          const nextTrips = trips.filter(t => t.id !== editingId);
          if (currentScroll != null) restoreScrollRef.current = currentScroll;
          setTrips(nextTrips);
          await commitData(nextTrips, locations, `Delete trip: ${label}`);
          closeModal();
        } catch (err) {
          setFormError(err.message || String(err));
        } finally {
          setBusy(false);
        }
      }
    });
  }

  function del(id) {
    const trip = trips.find(t => t.id === id);
    const label = trip?.label || trip?.toLocationName || trip?.toLocationId || 'this hop';
    setConfirmRequest({
      title: 'Delete hop?',
      message: `Delete ${label}? This cannot be undone.`,
      confirmLabel: 'Delete hop',
      onConfirm: async () => {
        try {
          setBusy(true);
          const nextTrips = trips.filter(t => t.id !== id);
          setTrips(nextTrips);
          await commitData(nextTrips, locations, `Delete trip: ${label}`);
        } catch (err) {
          setFormError(err.message || String(err));
        } finally {
          setBusy(false);
        }
      }
    });
  }
  function download() {
    const blob = new Blob([JSON.stringify(trips, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'trips.json'; a.click(); URL.revokeObjectURL(url);
  }
  async function commitData(nextTrips = trips, nextLocations = locations, message = 'Update travel history from GlobeHoppers') {
    if (!token || !repo) throw new Error('Enter a repo and fine-grained GitHub token in Repository Settings first.');
    const files = [
      { path: 'journeylines/src/data/trips.json', data: nextTrips },
      { path: 'journeylines/src/data/locations.json', data: nextLocations }
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
    if (!fromId || !toId || fromId === toId) return;
    const next = [...orderDraft];
    const from = next.findIndex(t => t.id === fromId);
    const to = next.findIndex(t => t.id === toId);
    if (from < 0 || to < 0) return;
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

  return <section className={`studio-shell ${closing ? 'is-closing' : ''}`} onWheelCapture={(e) => e.stopPropagation()} onPointerDownCapture={(e) => e.stopPropagation()}>
    <aside className={`studio-panel glass studio-panel--${viewType}`}>
      <div className="studio-header drawer-header-unified">
        <p className="eyebrow">GlobeHoppers Studio</p>
        <StudioViewTypeSelector value={viewType} onChange={onViewTypeChange} />
        <button className="studio-close drawer-close-button" onClick={requestCloseStudio}>Close</button>
        <h2>GlobeHopper Timeline</h2>
      </div>

      <div className="studio-actions-main">
        <button className="primary" onClick={openAdd}>Add {addTripNoun}</button>
        {!reorderMode && <button onClick={enterReorder}>Reorder</button>}
        {reorderMode && <><button className="primary" onClick={saveReorder} disabled={busy}>Save order</button><button onClick={() => setReorderMode(false)}>Cancel reorder</button></>}
      </div>

      <div ref={studioListRef} className={`studio-trip-list ${reorderMode ? 'is-reordering' : ''} studio-trip-list--${viewType}`} onWheel={(e) => e.stopPropagation()} onScroll={(e) => onScrollStore?.(e.currentTarget.scrollTop)}>
        {viewType === 'card' ? groupTripsByYear(reorderMode ? orderDraft : sortedTrips).map(group => <section className="timeline-year-section studio-year-section" key={group.year}>
          <h3>{group.year}</h3>
          <div className="timeline-card-grid studio-card-grid">
            {group.rows.map(trip => <StudioTripRow key={trip.id} trip={trip} viewType={viewType} reorderMode={reorderMode} dragId={dragId} setDragId={setDragId} dropId={dropId} setDropId={setDropId} moveTrip={moveTrip} locById={locById} onEdit={openEdit} onDelete={del} hopperData={normalizedHoppers} activeTripId={activeTripId} onPlayTrip={onPlayTrip} />)}
          </div>
        </section>) : (reorderMode ? orderDraft : sortedTrips).map(trip => <StudioTripRow key={trip.id} trip={trip} viewType={viewType} reorderMode={reorderMode} dragId={dragId} setDragId={setDragId} dropId={dropId} setDropId={setDropId} moveTrip={moveTrip} locById={locById} onEdit={openEdit} onDelete={del} hopperData={normalizedHoppers} activeTripId={activeTripId} onPlayTrip={onPlayTrip} />)}
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

    {confirmRequest && <ThemedConfirmPopup request={confirmRequest} busy={busy} onCancel={() => setConfirmRequest(null)} onConfirm={async () => { const action = confirmRequest.onConfirm; setConfirmRequest(null); await action?.(); }} />}

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
      addTripNoun={addTripNoun} normalizedHoppers={normalizedHoppers} formError={formError} setFormError={setFormError}
      onDelete={modal === 'edit' ? deleteTripFromModal : null}
      homeBases={homeBases}
    />}
  </section>;
}



function validateHopDraftForSave(draft = {}) {
  const missing = [];
  if (!draft.month) missing.push(['Month', 'Please choose a month']);
  if (!draft.travelers?.length && !(draft.guestHoppers || []).length) missing.push(['Hoppers', 'Please add at least one Hopper or Guest Hopper']);
  if (!draft.toLocationId && !draft.toLocationText?.trim()) missing.push(['Destination', 'Please choose a destination']);
  if (!missing.length) return;
  throw new Error(`Missing Required Fields:\n${missing.map(([field, action]) => `• ${field} - ${action}`).join('\n')}`);
}

function formatHumanList(items = []) {
  if (items.length <= 1) return items[0] || '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

function ThemedConfirmPopup({ request, busy, onCancel, onConfirm }) {
  return <div className="studio-confirm-backdrop" role="presentation" onClick={onCancel}>
    <div className="studio-confirm-popup glass" role="dialog" aria-modal="true" aria-labelledby="studio-confirm-title" onClick={(e) => e.stopPropagation()}>
      <p className="eyebrow">Please confirm</p>
      <h3 id="studio-confirm-title">{request.title || 'Confirm action'}</h3>
      <p>{request.message}</p>
      <div className="studio-confirm-actions">
        <button type="button" className="secondary" disabled={busy} onClick={onCancel}>Cancel</button>
        <button type="button" className="danger" disabled={busy} onClick={onConfirm}>{busy ? 'Working…' : (request.confirmLabel || 'Confirm')}</button>
      </div>
    </div>
  </div>;
}


function StudioTripRow({ trip, viewType, reorderMode, dragId, setDragId, dropId, setDropId, moveTrip, locById, onEdit, onDelete, hopperData, activeTripId, onPlayTrip }) {
  const playFromRow = () => { if (!reorderMode) onPlayTrip?.(trip.id); };
  const visual = resolveTripVisual(trip, hopperData || {});
  const colors = (visual.colors || []).filter(Boolean);
  const isMixed = !visual.isSquad && colors.length > 1;
  const accent = tripAccent(trip, hopperData);
  const accent2 = visual.accentColors?.[0] || colors[1] || accent;
  const accent3 = visual.accentColors?.[1] || colors[2] || 'transparent';
  const accent4 = visual.accentColors?.[2] || colors[3] || 'transparent';
  const isCurrent = activeTripId && trip.id === activeTripId;
  const isDragging = reorderMode && dragId === trip.id;
  const isDropTarget = reorderMode && dropId === trip.id && dragId && dragId !== trip.id;
  return <div
    className={`studio-trip-row studio-trip-row--${viewType} ${isMixed ? 'is-mixed' : ''} ${isCurrent ? 'is-active' : ''} ${isDragging ? 'is-dragging' : ''} ${isDropTarget ? 'is-drop-target' : ''}`}
    style={{ '--accent': accent, '--accent-2': accent2, '--accent-3': accent3, '--accent-4': accent4, '--accent-gradient': colorGradient(colors, accent) }}
    draggable={reorderMode}
    onClick={playFromRow}
    onContextMenu={(e) => { e.preventDefault(); if (!reorderMode) onEdit(trip); }}
    onDragStart={(e) => { setDragId(trip.id); try { e.dataTransfer.effectAllowed = 'move'; } catch {} }}
    onDragOver={e => { if (!reorderMode) return; e.preventDefault(); setDropId(trip.id); try { e.dataTransfer.dropEffect = 'move'; } catch {} }}
    onDragEnter={() => { if (reorderMode) setDropId(trip.id); }}
    onDragLeave={(e) => { if (e.currentTarget.contains(e.relatedTarget)) return; if (dropId === trip.id) setDropId(null); }}
    onDrop={() => { moveTrip(dragId, trip.id); setDragId(null); setDropId(null); }}
    onDragEnd={() => { setDragId(null); setDropId(null); }}
  >
    <span className="studio-trip-date">{formatTripDate(trip)}</span>
    <span className="studio-trip-main"><strong>{trip.label || trip.toLocationName || trip.toLocationId}</strong><small>{summarizeTrip(trip, locById, hopperData)}</small></span>
    <span className="studio-trip-buttons">
      {reorderMode ? <span className="drag-handle">↕</span> : viewType === 'card' ? null : <><button onClick={(e) => { e.stopPropagation(); onEdit(trip); }}>Edit</button><button onClick={(e) => { e.stopPropagation(); onDelete(trip.id); }}>Delete</button></>}
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

function TripModal({ mode, closing, draft, setDraft, busy, locs, locById, homeBases, onClose, onSave, onDelete, onTravelerToggle, onChooseDestination, onChooseFrom, onChooseExtraLeg, onSetExtraLeg, onAddLeg, onRemoveLeg, onSetReturnMode, onSetPreviewLegMode, addTripNoun = 'Hop', normalizedHoppers, formError, setFormError }) {
  const destinationMatches = filterLocations(locs, draft.toLocationText || '');
  const fromMatches = filterLocations(locs, draft.fromLocationText || '');
  const title = mode === 'add' ? `Add ${addTripNoun}` : draft.label || draft.toLocationText || 'Edit Hop';
  const currentHopSquad = activeDraftSquad(draft, normalizedHoppers || {});
  const currentHopSquadColor = currentHopSquad?.color || null;
  const currentDraftVisual = resolveTripVisual(draft, normalizedHoppers || {});
  const currentVisualColor = currentHopSquadColor || currentDraftVisual?.color || '#00e5ff';
  const currentCircleColors = (currentDraftVisual?.circleColors || currentDraftVisual?.memberColors || currentDraftVisual?.colors || []).filter(Boolean);
  const selectedTravelerCount = (draft.travelers?.length || 0) + ((draft.guestHoppers || []).length || 0);
  const defaultTrailColorMode = 'members';
  const effectiveTrailColorMode = draft.trailColorMode || defaultTrailColorMode;
  const effectiveTrailStyle = draft.trailStyle || 'solid';
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
  const [guestPopupOpen, setGuestPopupOpen] = useState(false);
  const [guestColorOpen, setGuestColorOpen] = useState(false);
  const [guestDraft, setGuestDraft] = useState({ id: '', name: '', colorName: 'gray', color: '#8e99a8' });
  const dateRangeRef = useRef(null);
  const bothHoppersSelected = draft.travelers?.includes('joey') && draft.travelers?.includes('bonnie');

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

  function openGuestPopup() {
    setGuestDraft({ id: `guest-${Date.now().toString(36)}`, name: '', colorName: 'gray', color: '#8e99a8' });
    setGuestColorOpen(false);
    setGuestPopupOpen(true);
  }
  function chooseGuestColor(name, customColor) {
    if (name === 'custom') {
      const color = normalizeHexColor(customColor || guestDraft.color || '#00e5ff');
      setGuestDraft(g => ({ ...g, colorName: 'custom', color }));
      return;
    }
    const c = (normalizedHoppers?.palette || []).find(x => x.name === name) || { name, color: guestDraft.color || '#00e5ff' };
    setGuestDraft(g => ({ ...g, colorName: c.name, color: c.color }));
  }
  function addGuestFromPopup() {
    setFormError('');
    if (!guestDraft.name.trim()) return;
    setDraft(d => ({ ...d, guestHoppers: [...(d.guestHoppers || []), { ...guestDraft, name: guestDraft.name.trim() }] }));
    setGuestPopupOpen(false);
  }
  function setTrailStyle(style) {
    setDraft(d => ({ ...d, trailStyle: style, trailColorMode: currentHopSquad && !(d.guestHoppers || []).length && style === 'solid' ? 'squad' : 'members' }));
  }
  function setTrailColorMode(mode) {
    setDraft(d => ({
      ...d,
      trailColorMode: mode,
      trailStyle: mode === 'squad' ? 'solid' : (d.trailStyle || 'solid')
    }));
  }

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
    {formError && <div className="studio-error-toast glass" role="alert">
      <strong>Almost there</strong>
      <span>{formError}</span>
      <button type="button" className="primary" onClick={() => setFormError('')}>OK</button>
    </div>}
    <div className={`studio-modal glass studio-modal--wide ${closing ? 'is-closing' : ''}`}>
      <div className="studio-modal-sticky">
        <div className="studio-modal-header studio-modal-header--with-actions">
          <div className="studio-title-block">
            <p className="eyebrow">{mode === 'add' ? `Add ${addTripNoun}` : 'Edit Hop'}</p>
            <h2>{title}</h2>
          </div>
          <div className="studio-modal-top-actions">
            {onDelete && <button className="danger" disabled={busy} onClick={onDelete}>Delete hop</button>}
            <button onClick={onClose}>Cancel</button>
            <button className="primary" disabled={busy} onClick={onSave}>{busy ? 'Saving…' : 'Save and commit'}</button>
          </div>
        </div>

        <div className="studio-form-grid studio-form-grid--sticky-fields studio-form-grid--dates">
          <label className="title-field">Hop title<input value={draft.label || ''} onChange={e => setDraft({...draft, label:e.target.value})} placeholder="Cabo Trip" /></label>
          <BubbleSelect label="Year" value={draft.year || ''} display={draft.year || 'Choose year'} options={yearOptions.map(y => ({ value: y, label: String(y) }))} open={yearPickerOpen} setOpen={setYearPickerOpen} onChoose={(value) => setDraft({...draft, year:Number(value)})} required variant="year" />
          <BubbleSelect label="Month" value={draft.month || ''} display={monthLabel(draft.month) || 'Choose month'} options={MONTH_OPTIONS.filter(m => m.value).map(m => ({ value: m.value, label: m.label }))} open={monthPickerOpen} setOpen={setMonthPickerOpen} onChoose={(value) => setDraft({...draft, month:Number(value), day:draft.day})} required variant="month" />
          <label className="date-range-field">Hop dates<button type="button" className="date-range-button" onClick={() => { setCalendarCursor({ year: Number(draft.year) || new Date().getFullYear(), month: Number(draft.month) || 1 }); setDateRangeOpen(v => !v); setRangePhase('start'); }}>{dateRangeLabel || 'Choose Hop Dates'}<span>▾</span></button>
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
            <div className="section-heading-inline">
              <h3>Hoppers</h3>
              {currentHopSquad && <span className="active-squad-badge" style={{ '--accent': currentHopSquadColor }}><span></span>{currentHopSquad.name}</span>}
            </div>
            <div className="pill-selectors">
              {((normalizedHoppers?.hoppers?.length ? normalizedHoppers.hoppers : [{ id:'joey', name:'Joey', color:'#ff8a00' }, { id:'bonnie', name:'Bonnie', color:'#ff4fd8' }])).map(t => {
                const selected = draft.travelers?.includes(t.id);
                const chipColor = selected && currentHopSquadColor ? currentHopSquadColor : t.color;
                return <button key={t.id} type="button" className={`traveler-pill ${selected ? 'is-selected' : ''} ${selected && currentHopSquad ? 'is-squad-active' : ''}`} style={{ '--accent': chipColor }} onClick={() => onTravelerToggle(t.id)}><span className="traveler-dot"></span>{t.name}</button>;
              })}
                {(draft.guestHoppers || []).map(g => <span key={g.id} className="traveler-pill guest-hopper-chip is-selected" style={{ '--accent': g.color }}><span className="traveler-dot"></span>{g.name}<button type="button" onClick={(e) => { e.stopPropagation(); setFormError(''); setDraft(d => ({ ...d, guestHoppers: (d.guestHoppers || []).filter(x => x.id !== g.id) })); }}>×</button></span>)}
                <button type="button" className="traveler-pill add-guest-hopper" onClick={openGuestPopup}>+ Add Guest Hopper</button>
                {guestPopupOpen && <div className="guest-hopper-popover glass">
                  <label>Name<input autoFocus value={guestDraft.name} placeholder="Name" onChange={e => setGuestDraft(g => ({ ...g, name: e.target.value }))} /></label>
                  <div className="guest-color-row"><span>Color</span><ColorPopover colors={normalizedHoppers?.palette || []} value={guestDraft.colorName} color={guestDraft.color} open={guestColorOpen} onToggle={() => setGuestColorOpen(v => !v)} onChoose={(name, customColor) => { chooseGuestColor(name, customColor); if (name !== 'custom') setGuestColorOpen(false); }} /></div>
                  <div className="guest-popover-actions"><button type="button" className="danger" onClick={() => setGuestPopupOpen(false)}>Delete</button><button type="button" className="secondary" onClick={() => setGuestPopupOpen(false)}>Cancel</button><button type="button" className="primary" onClick={addGuestFromPopup}>OK</button></div>
                </div>}
            </div>
          </section>

          <section className="studio-pick-section compact-section transport-triptype-row">
            <div className="transport-choice-group"><h3>Mode of Transportation</h3>
            <div className="mode-selectors">
              {MODE_OPTIONS.map(m => <button key={m.id} type="button" className={`mode-tile ${draft.mode === m.id ? 'is-selected' : ''}`} onClick={() => setDraft({...draft, mode:m.id})}><span>{m.icon}</span>{m.label}</button>)}
            </div></div>
            <div className="trip-type-selector"><h3>Hop type</h3>
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

        <div className="studio-modal-sidecol">
          <TripRoutePreview draft={draft} locById={locById} locs={locs} startLocation={effectiveStart} destination={effectiveDestination} onSetLegMode={onSetPreviewLegMode} hopperData={normalizedHoppers} />
          <TrailStylePanel
            draft={draft}
            currentHopSquad={currentHopSquad}
            currentDraftVisual={currentDraftVisual}
            selectedTravelerCount={selectedTravelerCount}
            effectiveTrailColorMode={effectiveTrailColorMode}
            effectiveTrailStyle={effectiveTrailStyle}
            onSetTrailStyle={setTrailStyle}
            onSetTrailColorMode={setTrailColorMode}
          />
        </div>

      </div>
    </div>
  </div>;
}

function activeDraftSquad(draft = {}, hopperData = {}) {
  const travelers = Array.isArray(draft.travelers) ? draft.travelers : [];
  const guests = Array.isArray(draft.guestHoppers) ? draft.guestHoppers : [];
  if (!travelers.length || guests.length) return null;
  const squads = Array.isArray(hopperData?.hopSquads) ? hopperData.hopSquads : [];
  const selectedKey = [...new Set(travelers.filter(Boolean))].sort().join('|');
  return squads.find(s => [...new Set((s.hopperIds || []).filter(Boolean))].sort().join('|') === selectedKey) || null;
}

function previewGroupLabel(draft = {}, visual = {}) {
  const permanentCount = Array.isArray(draft.travelers) ? draft.travelers.length : 0;
  const guestCount = Array.isArray(draft.guestHoppers) ? draft.guestHoppers.length : 0;
  if (visual?.isEmpty || permanentCount + guestCount === 0) return 'Required';
  if (visual?.isSquad) return 'Hop Squad';
  if (guestCount > 0 || permanentCount > 1) return 'Group hop';
  return 'Solo hop';
}

function previewDotBackground(colors = [], fallback = '#5d7288', glossy = false) {
  return segmentedCircleBackground(colors, fallback, glossy);
}

function TripRoutePreview({ draft, locById, locs, startLocation, destination, onSetLegMode, hopperData }) {
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
  const visual = resolveTripVisual(draft, hopperData || {});
  const noHoppers = !!visual.isEmpty;
  const mixedColors = (visual.colors || []).filter(Boolean);
  const accentColor = visual.accentColors?.[0] || mixedColors[1] || visual.color || '#5d7288';
  const accentColor3 = visual.accentColors?.[1] || mixedColors[2] || 'transparent';
  const accentColor4 = visual.accentColors?.[2] || mixedColors[3] || 'transparent';
  const isMixed = !visual.isSquad && mixedColors.length > 1;
  return <aside className={`route-preview-card ${noHoppers ? 'route-preview-card--empty' : ''} ${isMixed ? 'route-preview-card--mixed' : ''}`} style={{ '--trip-accent': visual.color || tripAccent(draft, hopperData), '--trip-accent-2': accentColor, '--trip-accent-3': accentColor3, '--trip-accent-4': accentColor4, '--trip-gradient': colorGradient(mixedColors, visual.color || '#5d7288') }}>
    <p className="eyebrow">Hop preview</p>
    <div className="route-preview-title-row">
      <h3>{draft.label || destination?.name || 'Add Hop'}</h3>
      <b className={`route-preview-title-dot ${isMixed ? 'is-group-dot' : ''}`} style={{ background: noHoppers ? 'transparent' : previewDotBackground(visual.circleColors || mixedColors, visual.color, true) }}></b>
    </div>
    <div className="route-preview-meta">
      <span>{formatDateRangeLabel(draft) || (draft.year ? [monthLabel(draft.month), draft.year].filter(Boolean).join(' ') : 'Dates pending')}</span>
      <span>{visual.name} · {previewGroupLabel(draft, visual)}</span>
      {(draft.notes || draft.occasion) && <span>{draft.notes || draft.occasion}</span>}
    </div>
    <div className="route-preview-list">
      {rows.map((r, i) => <div className={`route-preview-row ${isMixed ? 'is-mixed' : ''}`} style={{ '--row-gradient': colorGradient(mixedColors, visual.color || '#5d7288'), '--row-accent': visual.color || '#5d7288', '--row-accent-2': accentColor }} key={`${r.label}-${i}`}>
        <PreviewModeButton mode={r.mode} target={r.target} onSetLegMode={onSetLegMode} />
        <div><strong>{r.label}</strong><small>{r.place}</small></div>
        <span className="route-preview-people">{visual.name}</span>
      </div>)}
    </div>
  </aside>;
}

function TrailStylePanel({ draft, currentHopSquad, currentDraftVisual, selectedTravelerCount, effectiveTrailColorMode, effectiveTrailStyle, onSetTrailStyle, onSetTrailColorMode }) {
  const squadMemberColors = (currentDraftVisual?.squadMemberColors || currentDraftVisual?.memberColors || []).filter(Boolean);
  const squadColor = currentHopSquad?.color || currentDraftVisual?.color;
  const memberColors = (squadMemberColors.length ? squadMemberColors : (currentDraftVisual?.circleColors || currentDraftVisual?.colors || []).filter(Boolean));
  const availableColorCount = memberColors.length || selectedTravelerCount;
  const showMultiOptions = availableColorCount > 1;
  const styleOptions = [
    { id: 'solid', label: 'Solid Trail', disabled: false, colors: [squadColor || currentDraftVisual?.color || '#5d7288'].filter(Boolean), colorMode: currentHopSquad ? 'squad' : 'members' },
    { id: 'stripe', label: 'Stripe Trail', disabled: !showMultiOptions, colors: memberColors, colorMode: 'members' },
    { id: 'ribbon', label: 'Ribbon Trail', disabled: !showMultiOptions, colors: memberColors, colorMode: 'members' },
    { id: 'spiral', label: 'Spiral Trail', disabled: !showMultiOptions, colors: memberColors, colorMode: 'members' }
  ];
  return <section className="trail-style-panel compact-section">
    <div className="section-heading-inline">
      <h3>Trail style</h3>
      <span className="trail-style-summary">{showMultiOptions ? `${availableColorCount} colors available` : 'Solo trail'}</span>
    </div>
    <div className="trail-style-options">
      {styleOptions.map(option => <button key={option.id} type="button" disabled={option.disabled} aria-disabled={option.disabled ? 'true' : 'false'} className={`trail-style-option ${effectiveTrailStyle === option.id ? 'is-selected' : ''} ${option.disabled ? 'is-disabled' : ''}`} onClick={() => { if (!option.disabled) onSetTrailStyle(option.id); }}>
        <span className={`trail-style-swatch trail-style-swatch--${option.id}`} style={{ '--trail-preview': colorGradient(option.colors, currentDraftVisual?.color || '#5d7288'), '--trail-color': (option.colors || [])[0] || currentHopSquad?.color || currentDraftVisual?.color || '#5d7288', '--trail-member-count': Math.max(1, (option.colors || []).length || selectedTravelerCount || 1) }}></span>
        <strong>{option.label}</strong>
      </button>)}
    </div>
  </section>;
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

function normalizeTrip(draft, trips, locations, homeBases, hopperData = {}) {
  if (!draft.year || !draft.month) throw new Error('Year and month are required before saving.');
  if (!draft.travelers?.length && !(draft.guestHoppers || []).length) throw new Error('Select at least one Hopper or Guest Hopper before saving.');
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
  const derivedTrailColorMode = draft.trailColorMode || (activeDraftSquad(draft, hopperData || {}) && !((draft.guestHoppers || []).length) && (draft.trailStyle || 'solid') === 'solid' ? 'squad' : 'members');
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
    sortKey: draft.id && draft.sortKey ? draft.sortKey : buildNewTripSortKey(draft, trips, count),
    label,
    travelers: draft.travelers || [],
    guestHoppers: draft.guestHoppers || [],
    mode: draft.mode || 'plane',
    roundTrip: !!draft.roundTrip,
    returnMode: draft.roundTrip ? (draft.returnMode || draft.mode || 'plane') : '',
    fromLocationId,
    toLocationId,
    route,
    notes: draft.notes || '',
    occasion: draft.occasion || '',
    trailStyle: draft.trailStyle || 'solid',
    trailColorMode: derivedTrailColorMode
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
function tripAccent(trip, hopperData) {
  return resolveTripVisual(trip, hopperData || {}).color || '#5d7288';
}


function ColorPopover({ colors = [], value, color, open, onToggle, onChoose }) {
  const currentColor = normalizeHexColor(color || '#00e5ff');
  const [customOpen, setCustomOpen] = useState(false);
  const [draftColor, setDraftColor] = useState(currentColor);
  useEffect(() => {
    if (open) {
      setCustomOpen(false);
      setDraftColor(currentColor);
    }
  }, [open, currentColor]);

  const draft = hexToRgbDraft(draftColor);
  const hue = rgbToHslDraft(draft.r, draft.g, draft.b).h;
  const hueColor = rgbHueColor(draft.r, draft.g, draft.b);

  function openCustomPicker() {
    setDraftColor(currentColor);
    setCustomOpen(true);
  }

  function cancelCustom() {
    setDraftColor(currentColor);
    setCustomOpen(false);
  }

  function applyCustom() {
    const clean = normalizeHexColor(draftColor);
    onChoose?.('custom', clean);
    setCustomOpen(false);
    onToggle?.();
  }

  function setDraftRgb(part, value) {
    const next = { ...draft, [part]: clampRgb(value) };
    setDraftColor(rgbToHexDraft(next.r, next.g, next.b));
  }

  function setHueFromInput(e) {
    const nextHue = Number(e.target.value) || 0;
    const currentHsv = rgbToHsvDraft(draft.r, draft.g, draft.b);
    const rgb = hsvToRgbDraft(nextHue / 360, currentHsv.s || 0.75, currentHsv.v || 0.85);
    setDraftColor(rgbToHexDraft(rgb.r, rgb.g, rgb.b));
  }

  function chooseFromField(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / Math.max(1, rect.height)));
    const rgb = hsvToRgbDraft(hue, x, 1 - y);
    setDraftColor(rgbToHexDraft(rgb.r, rgb.g, rgb.b));
  }

  return <span className="color-popover">
    <button type="button" className="color-popover__trigger" style={{ '--swatch': currentColor }} onClick={onToggle} title="Choose color" />
    {open && <span className="color-popover__menu glass color-popover__menu--custom">
      {colors.map(c => <button key={c.name} type="button" className={value === c.name ? 'is-selected' : ''} style={{ '--swatch': c.color }} title={c.label || c.name} onClick={() => onChoose?.(c.name, c.color)} />)}
      <button type="button" className={value === 'custom' ? 'custom-rainbow-swatch is-selected' : 'custom-rainbow-swatch'} style={{ '--custom-swatch': value === 'custom' ? currentColor : 'transparent' }} title="Custom color" onClick={openCustomPicker} />
      {customOpen && <span className="custom-color-panel glass">
        <span
          className="custom-color-field"
          style={{ '--hue-color': hueColor }}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture?.(e.pointerId); chooseFromField(e); }}
          onPointerMove={(e) => { if (e.buttons) chooseFromField(e); }}
        >
          <span className="custom-color-field-cursor" style={{ left: `${Math.max(0, Math.min(1, rgbToHsvDraft(draft.r, draft.g, draft.b).s)) * 100}%`, top: `${(1 - Math.max(0, Math.min(1, rgbToHsvDraft(draft.r, draft.g, draft.b).v))) * 100}%` }} />
        </span>
        <span className="custom-color-row">
          <span className="custom-color-preview" style={{ '--swatch': draftColor }} />
          <input className="custom-hue-slider" type="range" min="0" max="360" value={Math.round(hue * 360)} onChange={setHueFromInput} />
        </span>
        <span className="custom-rgb-row">
          <label><input value={draft.r} onChange={(e) => setDraftRgb('r', e.target.value)} /><b>R</b></label>
          <label><input value={draft.g} onChange={(e) => setDraftRgb('g', e.target.value)} /><b>G</b></label>
          <label><input value={draft.b} onChange={(e) => setDraftRgb('b', e.target.value)} /><b>B</b></label>
        </span>
        <span className="custom-color-actions">
          <button type="button" className="custom-color-cancel" onClick={cancelCustom}>Cancel</button>
          <button type="button" className="custom-color-ok" onClick={applyCustom}>OK</button>
        </span>
      </span>}
    </span>}
  </span>;
}


function hexToRgbDraft(hex = '#00e5ff') {
  const clean = normalizeHexColor(hex).slice(1);
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16)
  };
}
function clampRgb(value) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(255, n));
}
function rgbToHexDraft(r, g, b) {
  return '#' + [r, g, b].map(v => clampRgb(v).toString(16).padStart(2, '0')).join('');
}
function rgbHueColor(r, g, b) {
  const h = rgbToHslDraft(r, g, b).h;
  const rgb = hslToRgbDraft(h, 0.82, 0.52);
  return rgbToHexDraft(rgb.r, rgb.g, rgb.b);
}
function rgbToHsvDraft(r, g, b) {
  r = clampRgb(r) / 255; g = clampRgb(g) / 255; b = clampRgb(b) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)); break;
      case g: h = ((b - r) / d + 2); break;
      default: h = ((r - g) / d + 4); break;
    }
    h /= 6;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}
function hsvToRgbDraft(h, s, v) {
  h = ((Number(h) || 0) % 1 + 1) % 1;
  s = Math.max(0, Math.min(1, Number(s) || 0));
  v = Math.max(0, Math.min(1, Number(v) || 0));
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let r, g, b;
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    default: r = v; g = p; b = q; break;
  }
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

function rgbToHslDraft(r, g, b) {
  r = clampRgb(r) / 255; g = clampRgb(g) / 255; b = clampRgb(b) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)); break;
      case g: h = ((b - r) / d + 2); break;
      default: h = ((r - g) / d + 4); break;
    }
    h /= 6;
  }
  return { h, s, l };
}
function hslToRgbDraft(h, s, l) {
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

function normalizeHexColor(value = '#00e5ff') {
  const raw = String(value || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(raw)) return '#' + raw.slice(1).split('').map(ch => ch + ch).join('').toLowerCase();
  return '#00e5ff';
}

function monthLabel(month) { return MONTH_OPTIONS.find(m => Number(m.value) === Number(month))?.label || ''; }
function modeIcon(mode) { return MODE_OPTIONS.find(m => m.id === mode)?.icon || '•'; }
function travelerSummary(travelers = [], guestHoppers = [], hopperData = {}) {
  return resolveTripVisual({ travelers, guestHoppers }, hopperData || {}).name || 'No hoppers selected';
}
function groupNameForHoppers(travelers = [], guestHoppers = [], visual = {}) {
  const permanentCount = Array.isArray(travelers) ? travelers.length : 0;
  const guestCount = Array.isArray(guestHoppers) ? guestHoppers.length : 0;
  if (visual?.isEmpty || permanentCount + guestCount === 0) return 'Required';
  if (visual?.isSquad) return 'Hop Squad';
  return (guestCount > 0 || permanentCount > 1) ? 'Group hop' : 'Solo hop';
}
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

function buildNewTripSortKey(draft, trips, count) {
  const manualNums = (trips || [])
    .map(t => String(t.sortKey || '').match(/^manual-(\d+)/)?.[1])
    .filter(Boolean)
    .map(Number);
  if (manualNums.length) {
    const next = Math.max(...manualNums) + 1;
    return `manual-${String(next).padStart(5,'0')}-${bucketKey(draft)}`;
  }
  return buildSortKey(draft, count);
}
function insertChronologically(trips) { return sortTripsForEditor(trips).map((t, i) => ({ ...t, sortKey: t.sortKey || buildSortKey(t, i + 1) })); }
function applyBucketOrder(rows) {
  return rows.map((t, i) => ({
    ...t,
    sortKey: `manual-${String(i + 1).padStart(5,'0')}-${bucketKey(t)}`
  }));
}
function bucketKey(t) { return `${t.year}-${String(t.month || 13).padStart(2,'0')}-${String(t.day || 99).padStart(2,'0')}`; }
function buildSortKey(t, n) { return `${bucketKey(t)}-${String(n).padStart(3,'0')}`; }
function sortTripsForEditor(rows) { return [...rows].sort((a,b) => String(a.sortKey || buildSortKey(a, 999)).localeCompare(String(b.sortKey || buildSortKey(b, 999)))); }
function activeHomeBaseId(homeBases, trip) { const key = `${trip.year}-${String(trip.month || 1).padStart(2,'0')}`; return (homeBases || []).find(h => h.start <= key && (!h.end || h.end >= key))?.locationId || 'melbourne-fl'; }
function formatDisplayDate(t) { if (t.month && t.day) return new Date(t.year, t.month - 1, t.day).toLocaleDateString(undefined, { month:'long', day:'numeric', year:'numeric' }); if (t.month) return new Date(t.year, t.month - 1, 1).toLocaleDateString(undefined, { month:'long', year:'numeric' }); return String(t.year); }
function formatTripDate(t) { return t.displayDate || formatDisplayDate(t); }
function displayLocation(l) { return l ? [l.name, l.region && regionShort(l.region), l.country !== 'United States' ? l.country : ''].filter(Boolean).join(', ') : ''; }
function displayNameFromLocation(l) { return l?.name || ''; }
function summarizeTrip(t, locById, hopperData) { const to = locById[t.toLocationId]; const people = resolveTripVisual(t, hopperData || {}).name || 'No hoppers'; return `${MODE_OPTIONS.find(m => m.id === t.mode)?.label || t.mode} · ${people} · ${displayLocation(to) || t.toLocationName || t.toLocationId || 'Unmapped destination'}`; }
function filterLocations(locs, q) { const needle = String(q || '').toLowerCase().trim(); if (!needle) return locs.slice(0, 6); return locs.filter(l => `${l.name} ${l.region} ${l.country} ${l.id}`.toLowerCase().includes(needle)); }
function findLocationByText(locs, text) { const q = String(text || '').toLowerCase().trim(); return locs.find(l => [l.id, l.name, displayLocation(l)].some(v => String(v).toLowerCase() === q)) || locs.find(l => displayLocation(l).toLowerCase().includes(q) || q.includes(l.name.toLowerCase())); }
function createPlaceholderLocation(text) { const name = String(text || 'New destination').split(',')[0].trim(); return { id: slug(text || name), name, region: '', country: '', continent: '', lat: 0, lon: 0, needsGeocoding: true }; }
function regionShort(region) { const map = { California:'CA', Florida:'FL', Georgia:'GA', Illinois:'IL', 'New York':'NY', Texas:'TX', Nevada:'NV', Arizona:'AZ', Colorado:'CO', Tennessee:'TN', Kentucky:'KY', Washington:'WA', Massachusetts:'MA', Michigan:'MI', 'North Carolina':'NC', 'South Carolina':'SC', Pennsylvania:'PA', Maryland:'MD', Hawaii:'HI' }; return map[region] || region; }
function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') || `location-${Date.now()}`; }
function githubHeaders(token) { return { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }; }
function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function toBase64(str) { return btoa(unescape(encodeURIComponent(str))); }
