import React, { useState, useEffect, useCallback, useRef } from 'react';
import 'bootstrap/dist/css/bootstrap.min.css';
import './index.css';
import SmartWorkspace from './components/SmartWorkspace';
import Departments from './components/Departments';
import { Modal, Button } from 'react-bootstrap';

const API = 'https://floor-plan-1fq2.onrender.com';  // TODO: move to .env

const STEPS = [
  { label: 'Upload Plan' },
  { label: 'Map Rooms' },
  { label: 'Assign & Export' },
];

const AUTOSAVE_DELAY = 3000; // ms

export default function App() {
  const [step, setStep] = useState(0);

  // Multi-page state: each page holds its own image + spaces + optional dbId (Supabase canvas_pages.id)
  const [pages, setPages] = useState([]);
  const [activePageIdx, setActivePageIdx] = useState(0);

  const [departments, setDepartments]     = useState([]);
  const [isProcessing, setIsProcessing]   = useState(false);
  const [processingMsg, setProcessingMsg] = useState('');
  const [showDepts, setShowDepts]         = useState(false);
  const [dragOver, setDragOver]           = useState(false);
  const [error, setError]                 = useState(null);

  // Project state
  const [currentProjectId, setCurrentProjectId] = useState(null);
  const [saveStatus, setSaveStatus]             = useState(null); // 'saving' | 'saved' | 'error'
  const [showProjects, setShowProjects]         = useState(false);
  const [projectList, setProjectList]           = useState([]);
  const [projectsLoading, setProjectsLoading]   = useState(false);

  const autosaveTimerRef = useRef(null);

  // Derived helpers for the active page
  const activePage = pages[activePageIdx] ?? null;

  const setActiveSpaces = useCallback((newSpaces) => {
    setPages(prev => prev.map((p, i) => i === activePageIdx ? { ...p, spaces: newSpaces } : p));
  }, [activePageIdx]);

  // ── Departments ────────────────────────────────────────────────────────────
  const fetchDepts = useCallback(() => {
    fetch(`${API}/api/departments`)
      .then(r => r.json())
      .then(setDepartments)
      .catch(() => {});
  }, []);

  useEffect(() => { fetchDepts(); }, [fetchDepts]);

  // ── Projects: save canvas pages to Supabase ────────────────────────────────
  const saveCanvasPages = useCallback(async (projectId, pagesSnapshot) => {
    if (!projectId || pagesSnapshot.length === 0) return;
    setSaveStatus('saving');
    try {
      const body = {
        pages: pagesSnapshot.map((p, i) => ({
          label:           p.label,
          image_src:       p.imageSrc ?? '',
          image_width:     p.imageSize.width,
          image_height:    p.imageSize.height,
          spaces:          p.spaces,
          page_index:      i,
          preview_data_url: p.previewDataUrl ?? null,
        })),
      };
      const res = await fetch(`${API}/api/projects/${projectId}/pages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Save failed');
      const saved = await res.json(); // [{id, project_id, ...}]
      // Persist Supabase IDs back into page state so preview patches work
      setPages(prev => prev.map((p, i) => ({ ...p, dbId: saved[i]?.id ?? p.dbId })));
      setSaveStatus('saved');
    } catch {
      setSaveStatus('error');
    }
  }, []);

  // Auto-save on page/spaces change (debounced)
  useEffect(() => {
    if (!currentProjectId || pages.length === 0) return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    setSaveStatus('saving');
    autosaveTimerRef.current = setTimeout(() => {
      saveCanvasPages(currentProjectId, pages);
    }, AUTOSAVE_DELAY);
    return () => clearTimeout(autosaveTimerRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages, currentProjectId]);

  // ── Projects: load list ────────────────────────────────────────────────────
  const fetchProjects = useCallback(async () => {
    setProjectsLoading(true);
    try {
      const res = await fetch(`${API}/api/projects`);
      const data = await res.json();
      setProjectList(data);
    } catch {
      setProjectList([]);
    } finally {
      setProjectsLoading(false);
    }
  }, []);

  const openProjectsModal = () => {
    setShowProjects(true);
    fetchProjects();
  };

  // ── Projects: load a saved project ────────────────────────────────────────
  const loadProject = async (project) => {
    setShowProjects(false);
    setIsProcessing(true);
    setProcessingMsg(`Loading "${project.name}"…`);
    try {
      const res = await fetch(`${API}/api/projects/${project.id}/pages`);
      if (!res.ok) throw new Error('Failed to load project');
      const savedPages = await res.json();
      if (savedPages.length === 0) throw new Error('No pages found in this project');

      const loadedPages = savedPages.map(p => ({
        id:           p.id,
        dbId:         p.id,
        label:        p.label,
        imageSrc:     p.image_src,
        imageSize:    { width: p.image_width, height: p.image_height },
        spaces:       p.spaces ?? [],
        processResult: { rooms: (p.spaces ?? []).length },
        previewDataUrl: p.preview_data_url ?? null,
      }));

      setPages(loadedPages);
      setActivePageIdx(0);
      setCurrentProjectId(project.id);
      setSaveStatus('saved');
      setStep(2); // open in Assign & Export mode so preview is visible
    } catch (err) {
      setError(err.message);
    } finally {
      setIsProcessing(false);
      setProcessingMsg('');
    }
  };

  // ── Preview callback: save preview data URL for a page ────────────────────
  const handleSavePreview = useCallback(async (previewDataUrl, pageLocalId) => {
    if (!currentProjectId) return;
    const page = pages.find(p => p.id === pageLocalId);
    if (!page?.dbId) return; // page not yet synced to Supabase
    try {
      await fetch(`${API}/api/projects/${currentProjectId}/pages/${page.dbId}/preview`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preview_data_url: previewDataUrl }),
      });
      // Update local state so preview is available without a reload
      setPages(prev => prev.map(p => p.id === pageLocalId ? { ...p, previewDataUrl } : p));
    } catch {
      // non-critical — preview still shows locally
    }
  }, [currentProjectId, pages]);

  // ── File processing ────────────────────────────────────────────────────────
  const processFiles = async (files) => {
    const fileArray = Array.from(files).filter(f =>
      f.type.startsWith('image/') || f.type === 'application/pdf'
    );
    if (fileArray.length === 0) {
      setError('Please upload image files (JPG/PNG/…) or PDF files.');
      return;
    }
    setError(null);
    setIsProcessing(true);
    setPages([]);
    setCurrentProjectId(null);
    setSaveStatus(null);

    const allPages = [];

    for (let i = 0; i < fileArray.length; i++) {
      const file = fileArray[i];
      setProcessingMsg(
        fileArray.length > 1
          ? `Processing file ${i + 1} of ${fileArray.length}: ${file.name}`
          : `Analyzing ${file.name}…`
      );

      const isPdf   = file.type === 'application/pdf';
      const blobUrl = isPdf ? null : URL.createObjectURL(file);

      const fd = new FormData();
      fd.append('file', file);

      try {
        const res = await fetch(`${API}/api/upload-smart-plan`, { method: 'POST', body: fd });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: 'Unknown error' }));
          throw new Error(err.detail || 'Upload failed');
        }
        const data = await res.json();

        for (const page of (data.pages ?? [])) {
          allPages.push({
            id:           `${Date.now()}_${Math.random().toString(36).slice(2)}`,
            dbId:         null,
            label:        page.label || file.name,
            imageSrc:     page.image_base64 ?? blobUrl,
            imageSize:    { width: page.image_width, height: page.image_height },
            spaces:       page.spaces ?? [],
            processResult: { rooms: page.rooms_detected },
            previewDataUrl: null,
          });
        }
      } catch (err) {
        setError(`Failed on "${file.name}": ${err.message}`);
      }
    }

    setIsProcessing(false);
    setProcessingMsg('');

    if (allPages.length > 0) {
      setPages(allPages);
      setActivePageIdx(0);
      setStep(1);

      // Auto-create a project in Supabase
      try {
        const projectName = fileArray.length === 1 ? fileArray[0].name : `${fileArray[0].name} (+${fileArray.length - 1} more)`;
        const res = await fetch(`${API}/api/projects`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: projectName }),
        });
        if (res.ok) {
          const proj = await res.json();
          setCurrentProjectId(proj.id);
          // Immediately save pages (don't wait for debounce)
          await saveCanvasPages(proj.id, allPages);
        }
      } catch {
        // project saving is non-critical
      }
    }
  };

  const handleFileInput = (e) => { processFiles(e.target.files); e.target.value = ''; };
  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    processFiles(e.dataTransfer.files);
  };

  const assignedCount = activePage?.spaces.filter(s => s.department_id).length ?? 0;
  const totalSpaces   = activePage?.spaces.length ?? 0;

  return (
    <div className="app-shell">
      {/* ── Header ── */}
      <header className="app-header">
        <div className="brand">
          <div className="brand-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 9h18M9 21V9" />
            </svg>
          </div>
          Floor Planner
        </div>
        <div className="d-flex align-items-center gap-2">
          {saveStatus === 'saving' && <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.7)' }}>Saving…</span>}
          {saveStatus === 'saved'  && <span style={{ fontSize: '0.75rem', color: '#86efac' }}>✓ Saved</span>}
          {saveStatus === 'error'  && <span style={{ fontSize: '0.75rem', color: '#fca5a5' }}>Save failed</span>}
          <button className="btn btn-sm btn-outline-light" onClick={openProjectsModal}>
            📂&nbsp; Projects
          </button>
          <button className="btn btn-sm btn-outline-light" onClick={() => setShowDepts(true)}>
            ⚙&nbsp; Departments
          </button>
        </div>
      </header>

      {/* ── Stepper ── */}
      <div className="stepper">
        {STEPS.map((s, i) => (
          <React.Fragment key={i}>
            <div className={`step-item ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`}>
              <div className="step-bubble">{i < step ? '✓' : i + 1}</div>
              <span className="step-label">{s.label}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`step-connector ${i < step ? 'done' : ''}`} />
            )}
          </React.Fragment>
        ))}
      </div>

      {/* ── Main Content ── */}
      <div className="step-content">

        {/* ── Step 0: Upload ── */}
        {step === 0 && (
          <div>
            <div className="text-center mb-4">
              <h2 style={{ fontWeight: 800, fontSize: '1.6rem' }}>Upload Your Floor Plan</h2>
              <p className="text-muted mt-1" style={{ fontSize: '0.95rem' }}>
                Our AI will scan the image, detect room labels, and draw boundaries automatically.
                Upload multiple images or a multi-page PDF to edit each floor separately.
              </p>
            </div>

            {error && (
              <div className="alert alert-danger d-flex align-items-center gap-2 mb-3" style={{ maxWidth: 600, margin: '0 auto 1rem' }}>
                <span>⚠️</span> {error}
              </div>
            )}

            {isProcessing ? (
              <div className="text-center py-5">
                <div className="spinner-border text-primary mb-3" style={{ width: '3rem', height: '3rem' }} role="status" />
                <h5 className="fw-bold">Analyzing floor plan…</h5>
                <p className="text-muted" style={{ fontSize: '0.9rem' }}>{processingMsg}</p>
              </div>
            ) : (
              <label
                className={`upload-zone ${dragOver ? 'drag-over' : ''}`}
                style={{ maxWidth: 580, margin: '0 auto' }}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
              >
                <input type="file" accept="image/*,.pdf" multiple onChange={handleFileInput} style={{ display: 'none' }} />
                <span className="upload-icon">🗺️</span>
                <h3>Drop your floor plan here</h3>
                <p>or click to browse files</p>
                <p className="mt-2" style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                  JPG · PNG · TIFF · PDF &nbsp;·&nbsp; Multiple files supported &nbsp;·&nbsp; Max 20 MB each
                </p>
              </label>
            )}
          </div>
        )}

        {/* ── Steps 1 & 2: Canvas with page tabs ── */}
        {(step === 1 || step === 2) && activePage && (
          <>
            {/* Page tabs — only shown when more than one page */}
            {pages.length > 1 && (
              <div className="page-tabs">
                {pages.map((page, idx) => (
                  <button
                    key={page.id}
                    className={`page-tab ${idx === activePageIdx ? 'active' : ''}`}
                    onClick={() => setActivePageIdx(idx)}
                    title={page.label}
                  >
                    <span className="page-tab-num">{idx + 1}</span>
                    <span className="page-tab-label">{page.label}</span>
                  </button>
                ))}
              </div>
            )}

            <SmartWorkspace
              key={activePage.id}
              imageSrc={activePage.imageSrc}
              imageWidth={activePage.imageSize.width}
              imageHeight={activePage.imageSize.height}
              spaces={activePage.spaces}
              setSpaces={setActiveSpaces}
              departments={departments}
              mode={step === 1 ? 'edit' : 'assign'}
              processResult={activePage.processResult}
              pageLabel={pages.length > 1 ? activePage.label : null}
              pageId={activePage.id}
              savedPreviewUrl={activePage.previewDataUrl}
              onSavePreview={handleSavePreview}
            />
          </>
        )}

        {/* ── Step Navigation ── */}
        {step > 0 && (
          <div className="step-nav">
            <button className="btn btn-outline-secondary btn-sm" onClick={() => setStep(s => s - 1)}>
              ← Back
            </button>
            <div className="step-nav-info">
              {step === 1
                ? <>{totalSpaces} room{totalSpaces !== 1 ? 's' : ''} mapped{pages.length > 1 ? ` · ${pages.length} pages` : ''}</>
                : <>{assignedCount} / {totalSpaces} rooms assigned ({totalSpaces ? Math.round(assignedCount / totalSpaces * 100) : 0}%)</>
              }
            </div>
            {step < 2 ? (
              <button className="btn btn-primary btn-sm" onClick={() => setStep(s => s + 1)}>
                Continue →
              </button>
            ) : (
              <button className="btn btn-success btn-sm" disabled>
                ✓ Done
              </button>
            )}
          </div>
        )}

      </div>

      {/* ── Departments Modal ── */}
      {showDepts && (
        <Departments
          departments={departments}
          onRefresh={fetchDepts}
          onClose={() => setShowDepts(false)}
          API={API}
        />
      )}

      {/* ── Projects Modal ── */}
      <Modal show={showProjects} onHide={() => setShowProjects(false)} centered size="lg">
        <Modal.Header closeButton>
          <Modal.Title style={{ fontSize: '1rem' }}>📂 Saved Projects</Modal.Title>
        </Modal.Header>
        <Modal.Body style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          {projectsLoading ? (
            <div className="text-center py-4">
              <div className="spinner-border spinner-border-sm text-primary me-2" role="status" />
              Loading projects…
            </div>
          ) : projectList.length === 0 ? (
            <p className="text-muted text-center py-4" style={{ fontSize: '0.9rem' }}>
              No saved projects yet. Upload a floor plan to create one automatically.
            </p>
          ) : (
            <div className="d-flex flex-column gap-3">
              {projectList.map(proj => (
                <div
                  key={proj.id}
                  className="d-flex align-items-center gap-3 p-3 rounded border"
                  style={{ background: currentProjectId === proj.id ? '#f0fdf4' : '#fff', borderColor: currentProjectId === proj.id ? '#86efac' : '#e2e8f0', cursor: 'pointer' }}
                  onClick={() => loadProject(proj)}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{proj.name}</div>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                      {currentProjectId === proj.id ? '● Currently open · ' : ''}
                      Last saved {new Date(proj.updated_at).toLocaleString()}
                    </div>
                  </div>
                  <Button variant="outline-primary" size="sm">Open</Button>
                </div>
              ))}
            </div>
          )}
        </Modal.Body>
        <Modal.Footer className="py-2">
          <Button variant="secondary" size="sm" onClick={() => setShowProjects(false)}>Close</Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}

