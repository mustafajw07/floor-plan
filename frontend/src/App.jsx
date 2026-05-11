import React, { useState, useEffect, useCallback } from 'react';
import 'bootstrap/dist/css/bootstrap.min.css';
import './index.css';
import SmartWorkspace from './components/SmartWorkspace';
import Departments from './components/Departments';

const API = 'http://localhost:8000';  // TODO: move to .env

const STEPS = [
  { label: 'Upload Plan' },
  { label: 'Map Rooms' },
  { label: 'Assign & Export' },
];

export default function App() {
  const [step, setStep] = useState(0);

  // Multi-page state: each page holds its own image + spaces
  const [pages, setPages] = useState([]);          // [{id, label, imageSrc, imageSize, spaces, processResult}]
  const [activePageIdx, setActivePageIdx] = useState(0);

  const [departments, setDepartments] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingMsg, setProcessingMsg] = useState('');
  const [showDepts, setShowDepts] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState(null);

  // Derived helpers for the active page
  const activePage = pages[activePageIdx] ?? null;

  const setActiveSpaces = useCallback((newSpaces) => {
    setPages(prev => prev.map((p, i) => i === activePageIdx ? { ...p, spaces: newSpaces } : p));
  }, [activePageIdx]);

  const fetchDepts = useCallback(() => {
    fetch(`${API}/api/departments`)
      .then(r => r.json())
      .then(setDepartments)
      .catch(() => {});
  }, []);

  useEffect(() => { fetchDepts(); }, [fetchDepts]);

  // Process one or more files (images or PDFs) sequentially
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

    const allPages = [];

    for (let i = 0; i < fileArray.length; i++) {
      const file = fileArray[i];
      setProcessingMsg(
        fileArray.length > 1
          ? `Processing file ${i + 1} of ${fileArray.length}: ${file.name}`
          : `Analyzing ${file.name}…`
      );

      const isPdf   = file.type === 'application/pdf';
      // For images, create a blob URL now so we don't need base64 from the backend
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
            label:        page.label || file.name,
            imageSrc:     page.image_base64 ?? blobUrl,
            imageSize:    { width: page.image_width, height: page.image_height },
            spaces:       page.spaces ?? [],
            processResult: { rooms: page.rooms_detected },
          });
        }
      } catch (err) {
        setError(`Failed on "${file.name}": ${err.message}`);
        // continue to next file
      }
    }

    setIsProcessing(false);
    setProcessingMsg('');

    if (allPages.length > 0) {
      setPages(allPages);
      setActivePageIdx(0);
      setStep(1);
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
        <button className="btn btn-sm btn-outline-light" onClick={() => setShowDepts(true)}>
          ⚙&nbsp; Departments
        </button>
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
    </div>
  );
}
