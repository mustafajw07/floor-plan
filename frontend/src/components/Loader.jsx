import React from 'react';

/**
 * Full-screen blocking overlay shown during slow API calls.
 * All pointer events beneath it are blocked while visible.
 */
function Loader({ show, message = 'Loading…', subMessage }) {
  if (!show) return null;

  return (
    <div
      aria-live="assertive"
      aria-busy="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(15, 23, 42, 0.68)',
        backdropFilter: 'blur(5px)',
        WebkitBackdropFilter: 'blur(5px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'all',
        animation: 'loaderFadeIn 0.18s ease',
      }}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: 16,
          padding: '2.5rem 3rem',
          textAlign: 'center',
          boxShadow: '0 20px 60px rgba(0,0,0,0.28)',
          minWidth: 240,
          maxWidth: 380,
          animation: 'loaderSlideUp 0.2s ease',
        }}
      >
        <div
          className="spinner-border text-primary mb-3"
          style={{ width: '3rem', height: '3rem' }}
          role="status"
        />
        <h5
          style={{
            fontWeight: 700,
            marginBottom: subMessage ? '0.35rem' : 0,
            color: '#1e293b',
            fontSize: '1rem',
          }}
        >
          {message}
        </h5>
        {subMessage && (
          <p style={{ fontSize: '0.83rem', color: '#64748b', margin: 0 }}>
            {subMessage}
          </p>
        )}
      </div>
    </div>
  );
}

export default React.memo(Loader);
