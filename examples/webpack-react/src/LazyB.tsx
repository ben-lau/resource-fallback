import React from 'react';

export default function LazyB() {
  return (
    <section data-testid="lazy-b-loaded" style={{ marginTop: 16, padding: 12, background: '#fff3e0' }}>
      <h2>Module B loaded ✓</h2>
      <p>Second async chunk — if the circuit breaker has tripped, this should skip broken CDNs.</p>
    </section>
  );
}
