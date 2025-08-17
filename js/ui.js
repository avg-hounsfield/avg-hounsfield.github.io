// /js/ui.js

/**
 * Renders the search results into the DOM.
 * @param {Array<Object>} results - An array of protocol objects to display.
 */
export function renderResults(results) {
  const container = document.getElementById('results');
  container.innerHTML = ''; // Clear previous results

  if (!results || results.length === 0) {
    container.innerHTML = `<p class="no-results">No protocols found.</p>`;
    return;
  }

  // Use map to create an array of HTML strings, then join them once.
  // This is more efficient than appending to the DOM in a loop.
  const cardsHtml = results.map(protocol => {
    
    // --- REFACTORED: Use classes instead of inline styles ---
    // This allows the stylesheet to control the colors for theming.
    const sequenceList = protocol.sequences.map(seq => {
      const isContrast = /contrast|post/i.test(seq.note || '');
      
      const classes = [];
      if (isContrast) {
        classes.push('contrast-sequence');
      }
      if (seq.highlight) {
        classes.push('highlight-sequence');
      }
      
      const classAttribute = classes.length > 0 ? `class="${classes.join(' ')}"` : '';
      
      return `<li ${classAttribute}>${seq.type} - ${seq.note || ''}</li>`;
    }).join('');

    // --- IMPROVED: Generate the full card structure to match your CSS ---
    // This structure includes the title section, favorite button, and info.
    return `
      <div class="protocol-card" data-protocol-id="${protocol.id}">
        <div class="protocol-title-section">
          <h3>${protocol.study}</h3>
          <button class="favorite-btn" title="Add to favorites">
            <span class="material-symbols-outlined">favorite</span>
          </button>
        </div>
        
        <div class="protocol-info">
          <span class="scanner-info"><strong>Scanner:</strong> ${protocol.scanner.join(', ')}</span>
          <!-- Add contrast indicator here if data is available -->
        </div>

        <div class="sequences-card">
          <div class="sequences-header">
            <h4>Sequences</h4>
            <span class="accordion-toggle material-symbols-outlined">expand_more</span>
          </div>
          <div class="sequences-content">
            <ul>${sequenceList}</ul>
          </div>
        </div>

        <!-- Add other cards like indications, notes, etc. here -->
      </div>
    `;
  }).join('');
  
  // Set the HTML of the container once
  container.innerHTML = cardsHtml;
}