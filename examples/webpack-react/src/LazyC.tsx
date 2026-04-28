import React from 'react';

export default function LazyC() {
  return (
    <section data-testid="lazy-c-loaded" style={{ marginTop: 16, padding: 12, background: '#e3f2fd' }}>
      <h2>Module C loaded ✓</h2>
      <p>Third async chunk — circuit breaker should make this load much faster.</p>
    </section>
  );
}
