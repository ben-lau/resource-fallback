import React from 'react';
export default function Lazy() {
  return (
    <section
      data-testid="lazy-loaded"
      style={{ marginTop: 16, padding: 12, background: '#e8ffe8' }}
    >
      <h2>Lazy module loaded ✓</h2>
      <p>This component lives in its own webpack chunk.</p>
    </section>
  );
}
