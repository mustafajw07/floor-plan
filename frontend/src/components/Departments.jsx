import React, { useState } from 'react';
import { Modal, Button, Form } from 'react-bootstrap';

const PRESET_COLORS = [
  '#6ee7b7', '#fca5a5', '#93c5fd', '#fde68a', '#d8b4fe',
  '#fed7aa', '#a5f3fc', '#f9a8d4', '#bbf7d0', '#fef08a',
  '#c4b5fd', '#86efac', '#fdba74', '#67e8f9', '#f0abfc',
];

export default function Departments({ departments, onRefresh, onClose, API }) {
  const [name,    setName]    = useState('');
  const [color,   setColor]   = useState('#6ee7b7');
  const [editId,  setEditId]  = useState(null);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState(null);

  const resetForm = () => {
    setName(''); setColor('#6ee7b7'); setEditId(null); setError(null);
  };

  const startEdit = (d) => {
    setEditId(d.id); setName(d.name); setColor(d.color); setError(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const url    = editId ? `${API}/api/departments/${editId}` : `${API}/api/departments`;
      const method = editId ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), color }),
      });
      if (!res.ok) throw new Error((await res.json()).detail || 'Save failed');
      onRefresh();
      resetForm();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id, deptName) => {
    if (!window.confirm(`Delete "${deptName}"?\nRooms assigned to it will become unassigned.`)) return;
    await fetch(`${API}/api/departments/${id}`, { method: 'DELETE' });
    onRefresh();
    if (editId === id) resetForm();
  };

  return (
    <Modal show onHide={onClose} size="lg" centered>
      <Modal.Header closeButton>
        <Modal.Title style={{ fontSize: '1rem' }}>⚙️ Manage Departments</Modal.Title>
      </Modal.Header>

      <Modal.Body>
        <div className="row g-4">

          {/* ── Form ── */}
          <div className="col-md-5">
            <h6 className="fw-bold mb-3" style={{ fontSize: '0.88rem' }}>
              {editId ? 'Edit Department' : 'Add New Department'}
            </h6>

            <Form onSubmit={handleSubmit}>
              <Form.Group className="mb-3">
                <Form.Label style={{ fontSize: '0.82rem', fontWeight: 600 }}>Name</Form.Label>
                <Form.Control
                  size="sm"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Engineering"
                  required
                  autoFocus
                />
              </Form.Group>

              <Form.Group className="mb-3">
                <Form.Label style={{ fontSize: '0.82rem', fontWeight: 600 }}>Color</Form.Label>
                {/* Preset swatches */}
                <div className="d-flex flex-wrap gap-1 mb-2">
                  {PRESET_COLORS.map(c => (
                    <div
                      key={c}
                      className={`color-preset ${color === c ? 'checked' : ''}`}
                      style={{ background: c }}
                      onClick={() => setColor(c)}
                      title={c}
                    />
                  ))}
                </div>
                {/* Custom colour picker */}
                <div className="d-flex align-items-center gap-2">
                  <Form.Control
                    type="color"
                    value={color}
                    onChange={e => setColor(e.target.value)}
                    style={{ width: 40, height: 32, padding: '2px', cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>Custom colour</span>
                </div>
              </Form.Group>

              {error && (
                <div className="alert alert-danger py-1 px-2 mb-2" style={{ fontSize: '0.8rem' }}>{error}</div>
              )}

              {/* Preview */}
              <div className="dept-row mb-3">
                <div className="dept-color-swatch" style={{ background: color }} />
                <span className="dept-name">{name || <em style={{ color: 'var(--muted)', fontWeight: 400 }}>Preview</em>}</span>
              </div>

              <div className="d-flex gap-2">
                {editId && (
                  <Button variant="outline-secondary" size="sm" onClick={resetForm}>
                    Cancel
                  </Button>
                )}
                <Button type="submit" variant="primary" size="sm" disabled={saving} className="flex-fill">
                  {saving ? 'Saving…' : editId ? 'Update' : '+ Add Department'}
                </Button>
              </div>
            </Form>
          </div>

          {/* ── List ── */}
          <div className="col-md-7">
            <h6 className="fw-bold mb-3" style={{ fontSize: '0.88rem' }}>
              Departments ({departments.length})
            </h6>

            <div style={{ maxHeight: 380, overflowY: 'auto' }}>
              {departments.length === 0 ? (
                <p className="text-muted text-center py-4" style={{ fontSize: '0.85rem' }}>
                  No departments yet. Add your first one.
                </p>
              ) : departments.map(d => (
                <div key={d.id} className="dept-row">
                  <div className="dept-color-swatch" style={{ background: d.color }} />
                  <span className="dept-name">{d.name}</span>
                  <button
                    className="btn btn-sm btn-outline-secondary"
                    style={{ fontSize: '0.72rem', padding: '2px 8px' }}
                    onClick={() => startEdit(d)}
                  >
                    Edit
                  </button>
                  <button
                    className="btn btn-sm btn-outline-danger"
                    style={{ fontSize: '0.72rem', padding: '2px 8px' }}
                    onClick={() => handleDelete(d.id, d.name)}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>

        </div>
      </Modal.Body>

      <Modal.Footer className="py-2">
        <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
      </Modal.Footer>
    </Modal>
  );
}
