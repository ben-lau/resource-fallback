import React from 'react';
import './lazy-b.css';

export default function LazyB() {
  return (
    <section data-testid="lazy-b-loaded" className="lazy-b-section">
      <h2 className="lazy-b-title">Module B loaded ✓</h2>
      <p>
        Second async chunk with separate CSS — if the circuit breaker has tripped, this should skip
        broken CDNs.
      </p>
    </section>
  );
}
