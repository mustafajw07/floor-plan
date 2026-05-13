import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Stage, Layer, Line, Circle, Image as KonvaImage, Text } from 'react-konva';
import useImage from 'use-image';
import { Modal, Button, Form } from 'react-bootstrap';

const SPACE_TYPES = ['Office', 'Meeting Room', 'Conference Room', 'Classroom', 'Washroom', 'Pantry', 'Lobby', 'Reception', 'Storage', 'Server Room', 'Other'];
const SNAP_PX    = 18;   // screen-space px to snap-close a polygon
const PASTE_OFFSET = 20; // px offset applied to pasted copies
const MAX_HISTORY  = 50; // max undo steps

// ── Pure helpers ─────────────────────────────────────────────────────────────
const hexToRgba = (hex, alpha) => {
  const c = hex.replace('#', '');
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
};

const centroid = (pts) => {
  const n = pts.length / 2;
  let cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i += 2) { cx += pts[i]; cy += pts[i + 1]; }
  return { x: cx / n, y: cy / n };
};

const shiftPoints = (pts, dx, dy) =>
  pts.map((v, i) => (i % 2 === 0 ? v + dx : v + dy));

function SmartWorkspace({
  imageSrc, imageWidth, imageHeight,
  spaces, setSpaces,
  departments,
  mode,
  processResult,
  pageLabel,
  pageId,
  savedPreviewUrl,
  onSavePreview,
}) {
  const [imgEl, imgStatus] = useImage(imageSrc || '');
  const containerRef = useRef(null);
  const stageRef     = useRef(null);

  // Canvas sizing — stageSize is derived from scale, not stored in state
  const [scale,    setScale]    = useState(1);
  const [fitScale, setFitScale] = useState(1); // auto-fit scale (without user zoom)
  const stageSize = useMemo(() => ({
    width:  Math.round(imageWidth  * scale),
    height: Math.round(imageHeight * scale),
  }), [imageWidth, imageHeight, scale]);

  // Drawing
  const [tool,    setTool]    = useState('pointer'); // 'pointer' | 'draw'
  const [drawPts, setDrawPts] = useState([]);
  const [hoverPt, setHoverPt] = useState(null);

  // Multi-selection
  const [selectedIds,  setSelectedIds]  = useState(new Set());
  const [editingSpace, setEditingSpace] = useState(null);
  const [showModal,    setShowModal]    = useState(false);

  // Quick-paint (assign mode)
  const [activeDept, setActiveDept] = useState(null);

  // Toast
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);

  // Undo / Redo — stack stored in ref; historySize stored in state purely to trigger re-renders for toolbar
  const historyStackRef = useRef([spaces]);
  const historyIdxRef   = useRef(0);
  const [historySize, setHistorySize] = useState({ idx: 0, len: 1 });

  // Clipboard for copy/paste
  const clipboardRef = useRef([]);

  // Export preview
  const [showPreview, setShowPreview]           = useState(false);
  const [previewDataUrl, setPreviewDataUrl]     = useState(null);
  const [previewGenerating, setPreviewGenerating] = useState(false);

  // Throttle refs (used inline — no hook needed for these)
  const previewThrottleRef = useRef(0); // prevent rapid repeated toDataURL calls
  const scrollThrottleRef  = useRef(0); // cap zoom-scroll to ~60fps
  const dragThrottleRef    = useRef({}); // per-vertex drag rate limit

  // Accordion / panel visibility
  const [sidebarOpen,  setSidebarOpen]  = useState(true);
  const [paintOpen,    setPaintOpen]    = useState(true);
  const [roomsOpen,    setRoomsOpen]    = useState(true);
  const [coverageOpen, setCoverageOpen] = useState(true);
  const [bannerOpen,   setBannerOpen]   = useState(true);
  const [progressOpen, setProgressOpen] = useState(true);

  // Always-fresh ref to spaces — avoids stale closures in event handlers
  const spacesRef = useRef(spaces);
  useEffect(() => { spacesRef.current = spaces; }, [spaces]);

  // Always-fresh ref to selectedIds
  const selectedIdsRef = useRef(selectedIds);
  useEffect(() => { selectedIdsRef.current = selectedIds; }, [selectedIds]);

  // Refs that let heavy callbacks stay stable without listing fast-changing state in deps
  const toolRef    = useRef(tool);
  const drawPtsRef = useRef(drawPts);
  const hoverPtRef = useRef(null);
  const scaleRef   = useRef(scale);
  useEffect(() => { toolRef.current    = tool;    }, [tool]);
  useEffect(() => { drawPtsRef.current = drawPts; }, [drawPts]);
  useEffect(() => { scaleRef.current   = scale;   }, [scale]);

  // helper to sync the render-trigger state after any history mutation
  const syncHistoryState = useCallback(() => {
    setHistorySize({ idx: historyIdxRef.current, len: historyStackRef.current.length });
  }, []);

  // ── Toast ─────────────────────────────────────────────────────────────────
  const fireToast = useCallback((msg, type = 'success') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ msg, type });
    toastTimerRef.current = setTimeout(() => setToast(null), 2800);
  }, []);

  useEffect(() => () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current); }, []);

  // ── History ────────────────────────────────────────────────────────────────
  const pushHistory = useCallback((newSpaces) => {
    const idx  = historyIdxRef.current;
    const base = historyStackRef.current.slice(0, idx + 1);
    if (base.length >= MAX_HISTORY) base.shift();
    historyStackRef.current = [...base, newSpaces];
    historyIdxRef.current   = historyStackRef.current.length - 1;
    syncHistoryState();
  }, [syncHistoryState]);

  // Reset history whenever a new AI result is loaded
  useEffect(() => {
    historyStackRef.current = [spaces];
    historyIdxRef.current   = 0;
    syncHistoryState();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processResult]); // intentionally depends on processResult only

  const commitSpaces = useCallback((newSpaces) => {
    setSpaces(newSpaces);
    pushHistory(newSpaces);
  }, [setSpaces, pushHistory]);

  const undo = useCallback(() => {
    const idx = historyIdxRef.current;
    if (idx <= 0) { fireToast('Nothing to undo', 'warning'); return; }
    historyIdxRef.current = idx - 1;
    setSpaces(historyStackRef.current[idx - 1]);
    syncHistoryState();
    fireToast('Undone', 'info');
  }, [setSpaces, fireToast, syncHistoryState]);

  const redo = useCallback(() => {
    const idx = historyIdxRef.current;
    if (idx >= historyStackRef.current.length - 1) { fireToast('Nothing to redo', 'warning'); return; }
    historyIdxRef.current = idx + 1;
    setSpaces(historyStackRef.current[idx + 1]);
    syncHistoryState();
    fireToast('Redone', 'info');
  }, [setSpaces, fireToast, syncHistoryState]);

  // ── Canvas sizing ──────────────────────────────────────────────────────────
  // Tracks whether we have already set the initial fit-scale for the current
  // image.  recalc resets scale only on first call (image load); subsequent
  // calls from ResizeObserver only update fitScale so user zoom is preserved.
  const initializedRef = useRef(false);

  const recalc = useCallback(() => {
    if (!containerRef.current || !imgEl) return;
    // clientWidth excludes scrollbar — avoids feedback loop when stage grows
    const cw = containerRef.current.clientWidth || 800;
    const s  = Math.min(cw / imageWidth, 2);
    setFitScale(s);
    if (!initializedRef.current) {
      initializedRef.current = true;
      setScale(s);
    }
  }, [imgEl, imageWidth]);

  useEffect(() => {
    // New image → reset so the next recalc call snaps scale back to fit
    initializedRef.current = false;
    recalc();
    if (!containerRef.current) return;
    const ro = new ResizeObserver(recalc);
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [recalc]);

  // ── Zoom controls ──────────────────────────────────────────────────────────
  const zoomIn    = useCallback(() => setScale(s => Math.min(4.0, +(s * 1.25).toFixed(6))), []);
  const zoomOut   = useCallback(() => setScale(s => Math.max(0.05, +(s / 1.25).toFixed(6))), []);
  const zoomReset = useCallback(() => setScale(fitScale), [fitScale]);
  const zoomPct   = Math.round(scale / (fitScale || 1) * 100);

  // Ctrl/Cmd + Scroll to zoom on the canvas container
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      // Throttle scroll zoom to ~60fps to avoid thrashing React state
      const now = Date.now();
      if (now - scrollThrottleRef.current < 16) return;
      scrollThrottleRef.current = now;
      const factor = e.deltaY < 0 ? 1.1 : (1 / 1.1);
      setScale(prev => Math.min(4.0, Math.max(0.05, +(prev * factor).toFixed(6))));
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  // Reset tool/selection on mode change
  useEffect(() => {
    setTool('pointer');
    setDrawPts([]);
    setActiveDept(null);
    setSelectedIds(new Set());
  }, [mode]);

  // ── Dept helpers (memoised) ────────────────────────────────────────────────
  const deptMap = useMemo(() => {
    const m = {};
    departments.forEach(d => { m[d.id] = d; });
    return m;
  }, [departments]);

  const deptFill = useCallback((id) => {
    if (!id) return 'rgba(100,100,100,0.08)';
    const d = deptMap[id];
    return d ? hexToRgba(d.color, 0.42) : 'rgba(100,100,100,0.08)';
  }, [deptMap]);

  const deptColor = useCallback((id) => {
    if (!id) return '#a0aec0';
    return deptMap[id]?.color ?? '#a0aec0';
  }, [deptMap]);

  const deptStroke = useCallback((space, isSelected) => {
    if (isSelected) return '#4f46e5';
    return space.source === 'ai' ? '#3b82f6' : '#e11d48';
  }, []);

  // ── Coord helper ───────────────────────────────────────────────────────────
  const screenToImg = useCallback(() => {
    if (!stageRef.current) return null;
    const p = stageRef.current.getPointerPosition();
    return p ? { x: p.x / scaleRef.current, y: p.y / scaleRef.current } : null;
  }, []); // completely stable — reads scale via scaleRef

  // ── Copy / Paste / Delete ──────────────────────────────────────────────────
  const handleCopy = useCallback(() => {
    const ids = selectedIdsRef.current;
    if (ids.size === 0) { fireToast('Select rooms to copy first', 'warning'); return; }
    clipboardRef.current = spacesRef.current.filter(s => ids.has(s.id));
    fireToast(`Copied ${clipboardRef.current.length} room${clipboardRef.current.length !== 1 ? 's' : ''}`);
  }, [fireToast]);

  const handlePaste = useCallback(() => {
    if (clipboardRef.current.length === 0) { fireToast('Nothing to paste', 'warning'); return; }
    const pasted = clipboardRef.current.map(s => ({
      ...s,
      id:     `manual_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      points: shiftPoints(s.points, PASTE_OFFSET, PASTE_OFFSET),
      source: 'manual',
    }));
    const newSpaces = [...spacesRef.current, ...pasted];
    commitSpaces(newSpaces);
    setSelectedIds(new Set(pasted.map(s => s.id)));
    fireToast(`Pasted ${pasted.length} room${pasted.length !== 1 ? 's' : ''}`);
  }, [commitSpaces, fireToast]);

  const handleDeleteSelected = useCallback(() => {
    const ids = selectedIdsRef.current;
    if (ids.size === 0) return;
    const count = ids.size;
    commitSpaces(spacesRef.current.filter(s => !ids.has(s.id)));
    setSelectedIds(new Set());
    fireToast(`Deleted ${count} room${count !== 1 ? 's' : ''}. Ctrl+Z to undo.`, 'warning');
  }, [commitSpaces, fireToast]);

  // Arrow-key nudge: 1 px normally, 10 px with Shift held
  const handleArrowMove = useCallback((dx, dy) => {
    const ids = selectedIdsRef.current;
    if (ids.size === 0) return;
    commitSpaces(spacesRef.current.map(s =>
      ids.has(s.id) ? { ...s, points: shiftPoints(s.points, dx, dy) } : s
    ));
  }, [commitSpaces]);

  // ── Keyboard shortcuts (single listener, reads latest via refs) ────────────
  useEffect(() => {
    const onKeyDown = (e) => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      // Don't intercept when modal is open (modal has its own form)
      if (document.querySelector('.modal.show')) return;

      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && !e.shiftKey && e.key === 'z')  { e.preventDefault(); undo(); return; }
      if (ctrl && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); redo(); return; }
      if (ctrl && e.key === 'c') { e.preventDefault(); handleCopy(); return; }
      if (ctrl && e.key === 'v') { e.preventDefault(); handlePaste(); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); handleDeleteSelected(); return; }
      if (e.key === 'Escape') { setDrawPts([]); setSelectedIds(new Set()); return; }

      // Arrow keys — nudge selected shapes (Shift = 10 px, plain = 1 px)
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        if (selectedIdsRef.current.size === 0) return;
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        if (e.key === 'ArrowLeft')  handleArrowMove(-step, 0);
        if (e.key === 'ArrowRight') handleArrowMove(step, 0);
        if (e.key === 'ArrowUp')    handleArrowMove(0, -step);
        if (e.key === 'ArrowDown')  handleArrowMove(0, step);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, redo, handleCopy, handlePaste, handleDeleteSelected, handleArrowMove]);

  // ── Stage events ───────────────────────────────────────────────────────────
  const handleStageClick = (e) => {
    if (tool === 'draw' && mode === 'edit') {
      const pos = screenToImg();
      if (!pos) return;
      if (drawPts.length >= 6) {
        const [fx, fy] = drawPts;
        if (Math.hypot(pos.x - fx, pos.y - fy) < SNAP_PX / scale) {
          const ns = {
            id: `manual_${Date.now()}`,
            name: '', type: 'Office', department_id: '',
            points: [...drawPts], source: 'manual',
          };
          setEditingSpace(ns);
          setDrawPts([]);
          setShowModal(true);
          setTool('pointer');
          return;
        }
      }
      setDrawPts(prev => [...prev, pos.x, pos.y]);
      return;
    }
    if (e.target === e.target.getStage()) setSelectedIds(new Set());
  };

  const handleMouseMove = () => {
    if (tool !== 'draw') { setHoverPt(null); return; }
    const pos = screenToImg();
    if (pos) setHoverPt(pos);
  };

  const handleShapeClick = useCallback((e, space) => {
    if (toolRef.current === 'draw') return;
    e.cancelBubble = true;
    const shiftHeld = e.evt?.shiftKey;

    if (mode === 'assign') {
      if (activeDept) {
        const hadDept = !!space.department_id;
        commitSpaces(spacesRef.current.map(s =>
          s.id === space.id ? { ...s, department_id: activeDept.id } : s
        ));
        fireToast(
          hadDept
            ? `"${space.name || 'Room'}" reassigned → ${activeDept.name}`
            : `"${space.name || 'Room'}" → ${activeDept.name}`
        );
      } else {
        setEditingSpace(space);
        setShowModal(true);
      }
      return;
    }

    // Shift+click → toggle in multi-selection
    if (shiftHeld) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.has(space.id) ? next.delete(space.id) : next.add(space.id);
        return next;
      });
      return;
    }

    // Single click: already sole-selected → open modal; else select
    if (selectedIds.size === 1 && selectedIds.has(space.id)) {
      setEditingSpace(space);
      setShowModal(true);
    } else {
      setSelectedIds(new Set([space.id]));
    }
  }, [mode, commitSpaces, fireToast]); // reads tool/selectedIds via refs

  // ── Polygon drag: move all selected shapes together ────────────────────────────
  const handlePolygonDragEnd = useCallback((e, spaceId) => {
    const node = e.target;
    const dx   = node.x() / scaleRef.current;
    const dy   = node.y() / scaleRef.current;
    node.position({ x: 0, y: 0 });
    // If dragged shape is part of the selection, move all selected; otherwise just this one
    const idsToMove = selectedIdsRef.current.has(spaceId) ? selectedIdsRef.current : new Set([spaceId]);
    commitSpaces(spacesRef.current.map(s =>
      idsToMove.has(s.id) ? { ...s, points: shiftPoints(s.points, dx, dy) } : s
    ));
    fireToast('Position updated');
  }, [commitSpaces, fireToast]);

  // ── Modal ──────────────────────────────────────────────────────────────────
  const handleSave = (e) => {
    e.preventDefault();
    const fd   = new FormData(e.target);
    const name = (fd.get('name') ?? '').trim();
    if (mode === 'edit' && !name) {
      fireToast('Space name cannot be empty', 'error');
      return;
    }
    const updated = {
      ...editingSpace,
      name:          mode === 'edit' ? name : editingSpace.name,
      type:          fd.get('type')          ?? editingSpace.type,
      department_id: fd.get('department_id') ?? editingSpace.department_id,
    };
    const cur = spacesRef.current;
    const idx = cur.findIndex(s => s.id === updated.id);
    commitSpaces(idx >= 0 ? cur.map((s, i) => (i === idx ? updated : s)) : [...cur, updated]);
    closeModal();
    fireToast(mode === 'assign' ? 'Department assigned!' : 'Space saved!');
  };

  const handleDeleteFromModal = () => {
    if (!editingSpace) return;
    commitSpaces(spacesRef.current.filter(s => s.id !== editingSpace.id));
    setSelectedIds(prev => { const n = new Set(prev); n.delete(editingSpace.id); return n; });
    closeModal();
    fireToast('Space deleted. Ctrl+Z to undo.', 'warning');
  };

  const closeModal = useCallback(() => { setShowModal(false); setEditingSpace(null); }, []);

  // ── Export / Preview ────────────────────────────────────────────────────────
  const openPreview = () => {
    if (!stageRef.current || previewGenerating) return;
    // Throttle: block rapid repeated exports (2 s window)
    const now = Date.now();
    if (now - previewThrottleRef.current < 2000) {
      fireToast('Please wait before exporting again', 'warning');
      return;
    }
    previewThrottleRef.current = now;
    setPreviewGenerating(true);
    // rAF lets React render the loading state before the blocking toDataURL call
    requestAnimationFrame(() => {
      try {
        const uri = stageRef.current.toDataURL({ pixelRatio: 2 });
        setPreviewDataUrl(uri);
        setShowPreview(true);
        if (onSavePreview && pageId) {
          onSavePreview(uri, pageId);
        }
      } finally {
        setPreviewGenerating(false);
      }
    });
  };

  const downloadPreview = useCallback(() => {
    if (!previewDataUrl) return;
    const a = document.createElement('a');
    const name = pageLabel
      ? `floorplan-${pageLabel.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.png`
      : 'floorplan-allocation.png';
    a.href = previewDataUrl;
    a.download = name;
    a.click();
    fireToast('PNG exported!');
    setShowPreview(false);
  }, [previewDataUrl, pageLabel, fireToast]);

  // ── Derived values ─────────────────────────────────────────────────────────
  const livePts = useMemo(
    () => hoverPt && drawPts.length >= 2 ? [...drawPts, hoverPt.x, hoverPt.y] : drawPts,
    [hoverPt, drawPts],
  );
  const { assigned, pctDone } = useMemo(() => {
    const a = spaces.filter(s => s.department_id).length;
    return { assigned: a, pctDone: spaces.length ? Math.round(a / spaces.length * 100) : 0 };
  }, [spaces]);
  // Pre-compute per-department counts once per spaces change; avoids O(n·m) filter in render
  const coverageStats = useMemo(() => {
    const counts = {};
    spaces.forEach(s => {
      if (s.department_id) counts[s.department_id] = (counts[s.department_id] || 0) + 1;
    });
    return { counts, unassigned: spaces.filter(s => !s.department_id).length };
  }, [spaces]);
  const canUndo  = historySize.idx > 0;
  const canRedo  = historySize.idx < historySize.len - 1;

  return (
    <div>

      {/* ── Assignment progress bar ── */}
      {mode === 'assign' && spaces.length > 0 && (
        <div className="top-accordion mb-3">
          <div className="top-accordion-header" onClick={() => setProgressOpen(v => !v)}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1 }}>
              <span style={{ fontSize: '0.82rem', fontWeight: 600, whiteSpace: 'nowrap' }}>{assigned} / {spaces.length} assigned</span>
              <div className="assign-progress-bar-bg" style={{ flex: 1 }}>
                <div className="assign-progress-bar" style={{ width: `${pctDone}%` }} />
              </div>
              <span style={{ fontSize: '0.82rem', color: 'var(--muted)', minWidth: 32 }}>{pctDone}%</span>
            </span>
            <span className={`accordion-chevron ${progressOpen ? 'open' : ''}`}>&#8250;</span>
          </div>
          <div className={`accordion-wrap ${progressOpen ? 'open' : ''}`}>
            <div className="accordion-inner" style={{ padding: '0.4rem 0.875rem', fontSize: '0.78rem', color: 'var(--muted)' }}>
              Click a department on the right then click rooms to assign, or click a room directly.
            </div>
          </div>
        </div>
      )}

      <div className="canvas-layout">

        {/* ══ Canvas Panel ══════════════════════════════════════════════════ */}
        <div className="canvas-panel">

          {/* ── Toolbar ── */}
          <div className="canvas-toolbar">
            {mode === 'edit' && (
              <>
                {/* Undo / Redo */}
                <button className="tool-btn" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">↩ Undo</button>
                <button className="tool-btn" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)">↪ Redo</button>

                <span style={{ borderLeft: '1px solid var(--border)', height: 20, margin: '0 4px' }} />

                <button
                  className={`tool-btn ${tool === 'pointer' ? 'active' : ''}`}
                  onClick={() => { setTool('pointer'); setDrawPts([]); }}
                  title="Select / reshape (Shift+click for multi-select)"
                >↖ Select</button>
                <button
                  className={`tool-btn ${tool === 'draw' ? 'active' : ''}`}
                  onClick={() => { setTool('draw'); setSelectedIds(new Set()); }}
                  title="Draw a new polygon room"
                >✏ Draw Room</button>

                {/* Cancel in-progress draw */}
                {drawPts.length > 0 && (
                  <button className="tool-btn danger-btn" onClick={() => setDrawPts([])} title="Cancel draw (Esc)">
                    ✕ Cancel
                  </button>
                )}

                {/* Draw hint */}
                {tool === 'draw' && drawPts.length >= 2 && (
                  <span className="tool-hint">
                    {drawPts.length < 6 ? 'Click to add points' : 'Click ● to close polygon'}
                  </span>
                )}

                {/* Multi / single selection actions */}
                {tool === 'pointer' && selectedIds.size > 0 && (
                  <>
                    <button className="tool-btn" onClick={handleCopy} title="Copy selected (Ctrl+C)">⎘ Copy</button>
                    <button className="tool-btn danger-btn" onClick={handleDeleteSelected} title="Delete selected (Delete key)">
                      🗑 Delete{selectedIds.size > 1 ? ` (${selectedIds.size})` : ''}
                    </button>
                    <span className="tool-hint">
                      {selectedIds.size > 1
                        ? `${selectedIds.size} selected · drag to move all · Shift+click to deselect`
                        : 'Drag to move · drag ● to reshape · click again to edit · Shift+click to add'}
                    </span>
                  </>
                )}

                {tool === 'pointer' && selectedIds.size === 0 && drawPts.length === 0 && (
                  <span className="tool-hint">Click to select · Shift+click multi-select · Ctrl+C/V copy/paste</span>
                )}
              </>
            )}

            {mode === 'assign' && (
              <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                {activeDept
                  ? <>🖌 Painting with <strong>{activeDept.name}</strong> — click any room</>
                  : <>Select a department on the right, or click a room to assign</>}
              </span>
            )}

            {/* ── Zoom controls ── */}
            <span style={{ borderLeft: '1px solid var(--border)', height: 20, margin: '0 4px' }} />
            <button className="tool-btn" onClick={zoomOut} title="Zoom out (Ctrl+Scroll)">−</button>
            <span style={{ fontSize: '0.75rem', color: 'var(--muted)', minWidth: 38, textAlign: 'center', userSelect: 'none', fontVariantNumeric: 'tabular-nums' }}>{zoomPct}%</span>
            <button className="tool-btn" onClick={zoomIn}  title="Zoom in (Ctrl+Scroll)">+</button>
            <button className="tool-btn" onClick={zoomReset} title="Reset zoom to fit">⊡ Fit</button>
            <input
              type="range"
              min="25" max="400" step="5"
              value={Math.min(400, Math.max(25, zoomPct))}
              onChange={e => setScale(Math.max(0.1, fitScale * Number(e.target.value) / 100))}
              className="zoom-slider"
              title={`Scale: ${zoomPct}%`}
            />
            <div style={{ flex: 1 }} />
            <button className="tool-btn" onClick={openPreview} disabled={previewGenerating} title="Preview & Export as PNG">
              {previewGenerating ? <><span className="spinner-border spinner-border-sm me-1" role="status" /> Generating…</> : '⬇ Export PNG'}
            </button>
          </div>

          {/* ── Konva Stage ── */}
          <div ref={containerRef} className="stage-container">
            {imgStatus === 'loading' && (
              <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--muted)' }}>
                <div className="spinner-border spinner-border-sm me-2" />Loading image…
              </div>
            )}
            {imgStatus === 'failed' && (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)', fontSize: '0.85rem' }}>
                ⚠️ Image could not be loaded — room outlines are still editable below
              </div>
            )}
            <Stage
              ref={stageRef}
              width={stageSize.width}
              height={stageSize.height}
              onClick={handleStageClick}
              onMouseMove={handleMouseMove}
              style={{
                cursor: tool === 'draw' ? 'crosshair' : 'default',
                display: imgStatus === 'loading' ? 'none' : 'block',
              }}
            >
              <Layer scaleX={scale} scaleY={scale}>

                {imgEl && <KonvaImage image={imgEl} x={0} y={0} opacity={0.88} />}

                {spaces.map(s => {
                  const isSel   = selectedIds.has(s.id);
                  const c       = centroid(s.points);
                  const canDrag = mode === 'edit' && tool === 'pointer';

                  return (
                    <React.Fragment key={s.id}>
                      <Line
                        points={s.points}
                        fill={deptFill(s.department_id)}
                        stroke={deptStroke(s, isSel)}
                        strokeWidth={(isSel ? 2.5 : 1.5) / scale}
                        closed
                        shadowColor={isSel ? '#4f46e5' : 'transparent'}
                        shadowBlur={isSel ? 8 / scale : 0}
                        shadowOpacity={0.45}
                        draggable={canDrag && isSel}
                        onDragEnd={(e) => handlePolygonDragEnd(e, s.id)}
                        onClick={(e) => handleShapeClick(e, s)}
                        onTap={(e)    => handleShapeClick(e, s)}
                        onMouseEnter={(e) => {
                          if (tool !== 'draw')
                            e.target.getStage().container().style.cursor =
                              canDrag && isSel ? 'move' : 'pointer';
                        }}
                        onMouseLeave={(e) => {
                          e.target.getStage().container().style.cursor =
                            tool === 'draw' ? 'crosshair' : 'default';
                        }}
                      />

                      {s.name && (
                        <Text
                          x={c.x}
                          y={c.y}
                          text={s.name}
                          fontSize={11 / scale}
                          fontStyle="bold"
                          fill={isSel ? '#4f46e5' : '#1e293b'}
                          align="center"
                          offsetX={(s.name.length * 3.2) / scale}
                          listening={false}
                        />
                      )}

                      {/* Vertex reshape handles — only when exactly one shape is selected */}
                      {isSel && selectedIds.size === 1 && canDrag && s.points.map((_, vi) => {
                        if (vi % 2 !== 0) return null;
                        const vIdx = vi / 2;
                        return (
                          <Circle
                            key={`v-${s.id}-${vIdx}`}
                            x={s.points[vi]}
                            y={s.points[vi + 1]}
                            radius={6 / scale}
                            fill="#ffffff"
                            stroke="#4f46e5"
                            strokeWidth={2 / scale}
                            draggable
                            onDragMove={(e) => {
                              // Throttle vertex drag state updates to ~30fps to avoid
                              // flooding React with redraws on every mouse-move event
                              const key = `${s.id}-${vi}`;
                              const now = Date.now();
                              if (now - (dragThrottleRef.current[key] ?? 0) < 33) return;
                              dragThrottleRef.current[key] = now;
                              const nx = e.target.x();
                              const ny = e.target.y();
                              const nextSpaces = spacesRef.current.map(sp => {
                                if (sp.id !== s.id) return sp;
                                const pts = [...sp.points];
                                pts[vi]     = nx;
                                pts[vi + 1] = ny;
                                return { ...sp, points: pts };
                              });
                              setSpaces(nextSpaces);
                            }}
                            onDragEnd={() => pushHistory(spacesRef.current)}
                            onMouseEnter={(e) => {
                              e.target.getStage().container().style.cursor = 'crosshair';
                            }}
                            onMouseLeave={(e) => {
                              e.target.getStage().container().style.cursor = 'move';
                            }}
                          />
                        );
                      })}
                    </React.Fragment>
                  );
                })}

                {/* In-progress draw preview */}
                {livePts.length >= 4 && (
                  <Line
                    points={livePts}
                    stroke="#ef4444"
                    strokeWidth={2 / scale}
                    dash={[6 / scale, 4 / scale]}
                    listening={false}
                  />
                )}
                {drawPts.map((_, i) => {
                  if (i % 2 !== 0) return null;
                  const isFirst  = i === 0;
                  const nearSnap = isFirst && hoverPt && drawPts.length >= 6
                    && Math.hypot(hoverPt.x - drawPts[0], hoverPt.y - drawPts[1]) < SNAP_PX / scale;
                  return (
                    <Circle
                      key={i}
                      x={drawPts[i]}
                      y={drawPts[i + 1]}
                      radius={(nearSnap ? 9 : isFirst ? 6 : 4) / scale}
                      fill={nearSnap ? '#22c55e' : isFirst ? '#ef4444' : '#f97316'}
                      stroke="white"
                      strokeWidth={1.5 / scale}
                      listening={false}
                    />
                  );
                })}

              </Layer>
            </Stage>
          </div>
        </div>

        {/* ══ Sidebar ═══════════════════════════════════════════════════════ */}
        <div className={`sidebar-zone ${sidebarOpen ? 'open' : 'closed'}`}>
          {/* Pull-tab toggle */}
          <button
            className="sidebar-tab"
            onClick={() => {
              setSidebarOpen(v => !v);
              setTimeout(() => { initializedRef.current = false; recalc(); }, 290);
            }}
            title={sidebarOpen ? 'Hide panel' : 'Show panel'}
          >{sidebarOpen ? '›' : '‹'}</button>
        <div className="sidebar">

          {/* Quick-assign palette */}
          {mode === 'assign' && (
            <div className="sidebar-card">
              <div className="sidebar-header accordion-header" onClick={() => setPaintOpen(v => !v)}>
                <span>🎨 Quick Paint</span>
                <span className={`accordion-chevron ${paintOpen ? 'open' : ''}`}>›</span>
              </div>
              <div className={`accordion-wrap ${paintOpen ? 'open' : ''}`}>
                <div className="accordion-inner">
                  {departments.length === 0 ? (
                    <div className="empty-state">No departments yet.<br />Add some via ⚙ Departments.</div>
                  ) : departments.map(d => (
                    <div
                      key={d.id}
                      className={`dept-assign-btn ${activeDept?.id === d.id ? 'active' : ''}`}
                      onClick={() => setActiveDept(prev => prev?.id === d.id ? null : d)}
                    >
                      <div className="dept-dot" style={{ background: d.color }} />
                      <span>{d.name}</span>
                      {activeDept?.id === d.id && <span className="dept-checkmark">✓</span>}
                    </div>
                  ))}
                  {activeDept && (
                    <div style={{ padding: '0.4rem 0.875rem', fontSize: '0.72rem', color: 'var(--muted)', borderTop: '1px solid var(--border)' }}>
                      Click rooms to apply · click again to deselect
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Rooms list */}
          <div className="sidebar-card">
            <div className="sidebar-header accordion-header" onClick={() => setRoomsOpen(v => !v)}>
              <span>Rooms</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <span className="badge-count">{spaces.length}</span>
                <span className={`accordion-chevron ${roomsOpen ? 'open' : ''}`}>›</span>
              </span>
            </div>
            <div className={`accordion-wrap ${roomsOpen ? 'open' : ''}`}>
            <div className="accordion-inner">
            <div className="space-list">
              {spaces.length === 0 ? (
                <div className="empty-state">
                  {mode === 'edit' ? 'No rooms detected. Use Draw Room to add them.' : 'No rooms mapped.'}
                </div>
              ) : spaces.map(s => (
                <div
                  key={s.id}
                  className={`space-item ${selectedIds.has(s.id) ? 'selected' : ''}`}
                  onClick={() => {
                    setSelectedIds(new Set([s.id]));
                    if (mode === 'edit') { setEditingSpace(s); setShowModal(true); }
                  }}
                >
                  <div className="space-dot" style={{ background: deptColor(s.department_id) }} />
                  <span className="space-name">{s.name || <em style={{ color: 'var(--muted)' }}>Unnamed</em>}</span>
                  <span className={`space-badge ${s.source === 'ai' ? 'badge-ai' : 'badge-manual'}`}>
                    {s.source === 'ai' ? 'AI' : 'M'}
                  </span>
                </div>
              ))}
            </div>
            </div>
            </div>
          </div>

          {/* Department coverage (assign mode) */}
          {mode === 'assign' && spaces.length > 0 && (
            <div className="sidebar-card">
              <div className="sidebar-header accordion-header" onClick={() => setCoverageOpen(v => !v)}>
                <span>Coverage</span>
                <span className={`accordion-chevron ${coverageOpen ? 'open' : ''}`}>›</span>
              </div>
              <div className={`accordion-wrap ${coverageOpen ? 'open' : ''}`}>
              <div className="accordion-inner">
              {departments.map(d => {
                const cnt = coverageStats.counts[d.id] ?? 0;
                if (cnt === 0) return null;
                const pct = Math.round(cnt / spaces.length * 100);
                return (
                  <div key={d.id} className="stat-row">
                    <div className="dept-dot" style={{ background: d.color }} />
                    <span className="stat-label">{d.name}</span>
                    <div style={{ width: 48, height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: d.color, borderRadius: 3 }} />
                    </div>
                    <span className="stat-pct">{pct}%</span>
                  </div>
                );
              })}
              {(() => {
                const u = coverageStats.unassigned;
                if (!u) return null;
                const pct = Math.round(u / spaces.length * 100);
                return (
                  <div className="stat-row">
                    <div className="dept-dot" style={{ background: '#a0aec0' }} />
                    <span className="stat-label" style={{ color: 'var(--muted)' }}>Unassigned</span>
                    <div style={{ width: 48, height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: '#a0aec0', borderRadius: 3 }} />
                    </div>
                    <span className="stat-pct">{pct}%</span>
                  </div>
                );
              })()}
            </div>
            </div>
            </div>
          )}
        </div>
        </div>
      </div>

      {/* ── Toast ── */}
      {toast && (
        <div className={`toast-notification toast-${toast.type}`}>{toast.msg}</div>
      )}

      {/* ── Export Preview Modal ── */}
      <Modal show={showPreview} onHide={() => setShowPreview(false)} centered size="xl">
        <Modal.Header closeButton className="py-2">
          <Modal.Title style={{ fontSize: '0.95rem' }}>
            🖼️ Export Preview{pageLabel ? ` — ${pageLabel}` : ''}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body style={{ background: '#f1f5f9', textAlign: 'center', padding: '1.25rem' }}>
          {(previewDataUrl || savedPreviewUrl) ? (
            <img
              src={previewDataUrl || savedPreviewUrl}
              alt="Floor plan preview"
              style={{ maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain', borderRadius: 8, boxShadow: '0 4px 20px rgba(0,0,0,0.15)' }}
            />
          ) : null}
        </Modal.Body>
        <Modal.Footer className="py-2">
          <Button variant="outline-secondary" size="sm" onClick={() => setShowPreview(false)}>Close</Button>
          <Button variant="primary" size="sm" onClick={downloadPreview}>⬇ Download PNG</Button>
        </Modal.Footer>
      </Modal>

      {/* ── Edit / Assign Modal ── */}
      <Modal show={showModal} onHide={closeModal} centered size="sm">
        <Modal.Header closeButton className="py-2">
          <Modal.Title style={{ fontSize: '0.95rem' }}>
            {mode === 'assign'
              ? '🎨 Assign Department'
              : editingSpace?.source === 'manual' && !editingSpace?.name
                ? '✏️ New Space'
                : '📝 Edit Space'}
          </Modal.Title>
        </Modal.Header>
        <Form onSubmit={handleSave}>
          <Modal.Body className="py-3">
            {mode === 'edit' && (
              <>
                <Form.Group className="mb-3">
                  <Form.Label style={{ fontSize: '0.82rem', fontWeight: 600 }}>Space Name</Form.Label>
                  <Form.Control
                    name="name"
                    size="sm"
                    defaultValue={editingSpace?.name}
                    placeholder="e.g. Conference Room A"
                    autoFocus
                  />
                </Form.Group>
                <Form.Group className="mb-3">
                  <Form.Label style={{ fontSize: '0.82rem', fontWeight: 600 }}>Type</Form.Label>
                  <Form.Select name="type" size="sm" defaultValue={editingSpace?.type || 'Office'}>
                    {SPACE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </Form.Select>
                </Form.Group>
              </>
            )}

            {mode === 'assign' && editingSpace?.name && (
              <p style={{ fontSize: '0.88rem', marginBottom: '0.75rem' }}>
                <strong>{editingSpace.name}</strong>
                <span className="text-muted"> · {editingSpace.type}</span>
              </p>
            )}

            <Form.Group>
              <Form.Label style={{ fontSize: '0.82rem', fontWeight: 600 }}>Department</Form.Label>
              <Form.Select name="department_id" size="sm" defaultValue={editingSpace?.department_id ?? ''}>
                <option value="">— Unassigned —</option>
                {departments.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </Form.Select>
            </Form.Group>
          </Modal.Body>

          <Modal.Footer className={`py-2 ${mode === 'edit' ? 'justify-content-between' : ''}`}>
            {mode === 'edit' && (
              <Button variant="outline-danger" size="sm" type="button" onClick={handleDeleteFromModal}>
                🗑 Delete
              </Button>
            )}
            <div className="d-flex gap-2">
              <Button variant="outline-secondary" size="sm" onClick={closeModal}>Cancel</Button>
              <Button variant="primary" size="sm" type="submit">
                {mode === 'assign' ? 'Assign' : 'Save'}
              </Button>
            </div>
          </Modal.Footer>
        </Form>
      </Modal>

    </div>
  );
}

export default React.memo(SmartWorkspace);
