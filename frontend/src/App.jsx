import React, { useState, useEffect, useCallback } from 'react';
import 'bootstrap/dist/css/bootstrap.min.css';
import './index.css';
import SmartWorkspace from './components/SmartWorkspace';
import Departments from './components/Departments';

const API = 'http://localhost:8000';

const STEPS = [
  { label: 'Upload Plan' },
  { label: 'Map Rooms' },
  { label: 'Assign & Export' },
];

export default function App() {
  const [step, setStep] = useState(0);
  const [imageSrc, setImageSrc] = useState(null);
  const [imageSize, setImageSize] = useState({ width: 1, height: 1 });
  const [spaces, setSpaces] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processResult, setProcessResult] = useState(null);
  const [showDepts, setShowDepts] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState(null);

  const fetchDepts = useCallback(() => {
    fetch(`${API}/api/departments`)
      .then(r => r.json())
      .then(setDepartments)
      .catch(() => {});
  }, []);

  useEffect(() => { fetchDepts(); }, [fetchDepts]);

  const processFile = async (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please upload an image file (JPG or PNG).');
      return;
    }
    setError(null);
    setImageSrc(URL.createObjectURL(file));
    setIsProcessing(true);
    setProcessResult(null);
    setSpaces([]);

    const fd = new FormData();
    fd.append('file', file);

    try {
      const res = await fetch(`${API}/api/upload-smart-plan`, { method: 'POST', body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Unknown error' }));
        throw new Error(err.detail || 'Upload failed');
      }
      const data = await res.json();
      setSpaces(data.spaces || []);
      setImageSize({ width: data.image_width, height: data.image_height });
      setProcessResult({ rooms: data.rooms_detected });
      setStep(1);
    } catch (err) {
      setError(`Processing failed: ${err.message}`);
      setImageSrc(null);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFileInput = (e) => processFile(e.target.files[0]);
  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    processFile(e.dataTransfer.files[0]);
  };

  const assignedCount = spaces.filter(s => s.department_id).length;

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
                <p className="text-muted" style={{ fontSize: '0.9rem' }}>
                  AI is running OCR to detect rooms and extract labels. This takes a few seconds.
                </p>
              </div>
            ) : (
              <label
                className={`upload-zone ${dragOver ? 'drag-over' : ''}`}
                style={{ maxWidth: 580, margin: '0 auto' }}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
              >
                <input type="file" accept="image/*" onChange={handleFileInput} style={{ display: 'none' }} />
                <span className="upload-icon">🗺️</span>
                <h3>Drop your floor plan here</h3>
                <p>or click to browse files</p>
                <p className="mt-2" style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                  JPG · PNG · TIFF &nbsp;·&nbsp; Max 20 MB
                </p>
              </label>
            )}
          </div>
        )}

        {/* ── Steps 1 & 2: Canvas ── */}
        {(step === 1 || step === 2) && (
          <SmartWorkspace
            imageSrc={imageSrc}
            imageWidth={imageSize.width}
            imageHeight={imageSize.height}
            spaces={spaces}
            setSpaces={setSpaces}
            departments={departments}
            mode={step === 1 ? 'edit' : 'assign'}
            processResult={processResult}
          />
        )}

        {/* ── Step Navigation ── */}
        {step > 0 && (
          <div className="step-nav">
            <button className="btn btn-outline-secondary btn-sm" onClick={() => setStep(s => s - 1)}>
              ← Back
            </button>
            <div className="step-nav-info">
              {step === 1
                ? <>{spaces.length} room{spaces.length !== 1 ? 's' : ''} mapped</>
                : <>{assignedCount} / {spaces.length} rooms assigned ({spaces.length ? Math.round(assignedCount / spaces.length * 100) : 0}%)</>
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
