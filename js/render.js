// js/render.js - FINAL VERSION

/**
 * Sorts MRI sequences into a predefined clinical order.
 */
// js/render.js - CORRECTED sortSequences function

function sortSequences(sequences) {
  const PREDEFINED_ORDER = ['T1', 'T2', 'FLAIR', 'SWAN', 'SWI', 'GRE', 'PD', 'DWI', 'FIESTA', 'COSMIC', 'SPACE', 'MPRAGE', 'SPGR'];
  
  return sequences.slice().sort((a, b) => {
    const aIsContrast = a.contrast === true || a.highlight === true;
    const bIsContrast = b.contrast === true || b.highlight === true;

    // CORRECTED: Non-contrast always comes before contrast
    if (!aIsContrast && bIsContrast) return -1;
    if (aIsContrast && !bIsContrast) return 1;

    // If both are non-contrast, sort by the predefined order
    if (!aIsContrast && !bIsContrast) {
      const aBaseType = a.sequence?.split(' ')[0].toUpperCase();
      const bBaseType = b.sequence?.split(' ')[0].toUpperCase();
      const indexA = PREDEFINED_ORDER.indexOf(aBaseType);
      const indexB = PREDEFINED_ORDER.indexOf(bBaseType);
      
      if (indexA !== -1 && indexB !== -1) return indexA - indexB;
      if (indexA !== -1) return -1;
      if (indexB !== -1) return 1;
    }

    // Fallback to alphabetical sort for everything else
    return (a.sequence || '').localeCompare(b.sequence || '');
  });
}

/**
 * Renders a single protocol card HTML string.
 */
function renderProtocolCard(protocol) {
  if (!protocol) return ''; // Safety check
  
  const contrastText = protocol.usesContrast ? 'Yes' : 'No';
  const contrastClass = protocol.usesContrast ? 'contrast-yes' : 'contrast-no';

  // Get sequences from the new layout structure
  const sequences = protocol.layout?.leftCard?.sequences || [];
  let sortedSequences;
  
  try {
    sortedSequences = sortSequences(sequences);
  } catch (error) {
    console.error('Error sorting sequences:', error);
    sortedSequences = sequences; // Fallback to unsorted sequences
  }
  
  // Get content from the right card
  const rightCardContent = protocol.layout?.rightCard?.content || {};
  const fullHeight = protocol.layout?.rightCard?.fullHeight;

  return `
    <div class="protocol-card">
      <div class="protocol-content ${fullHeight ? 'full-height' : ''}">
        <div class="left-card">
          <div class="protocol-header">
            <h3>${protocol.study || 'Untitled Study'}</h3>
            <div class="protocol-info">
              <span class="${contrastClass}"><strong>Contrast:</strong> <span class="contrast-value">${contrastText}</span></span>
            </div>
          </div>
          <div class="sequences">
            <h4>Sequences:</h4>
            <ul>
              ${sortedSequences.map(seq => {
                const isHighlight = seq.highlight === true;
                const liClass = isHighlight ? 'class="highlight-sequence"' : '';
                return `<li ${liClass}>${seq.sequence}</li>`;
              }).join('\n              ') || '<li>None listed</li>'}
            </ul>
          </div>
        </div>

        <div class="right-card">
          <div class="content">
            <p class="indications">${rightCardContent.indications || ''}</p>
            ${rightCardContent.contrastRationale ? 
              `<p class="contrast-rationale"><strong>Contrast Rationale:</strong> ${rightCardContent.contrastRationale}</p>` 
              : ''}
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Renders protocol cards into a grid.
 */
export function renderProtocols(protocols) {
  if (!protocols || protocols.length === 0) {
    return '<p>No protocols found.</p>';
  }

  const protocolCards = protocols.map(renderProtocolCard).join('');

  return `
    <div class="protocol-grid">
      ${protocolCards}
    </div>
  `;
}

/**
 * Creates HTML for search results, grouped by category.
 */
export function renderGroupedProtocols(groupedData) {
  return Object.entries(groupedData).map(([category, protocols]) => {
    const protocolCards = protocols.map(renderProtocolCard).join('');
    
    return `
      <div class="protocol-group">
        <h2 class="category-header">${category}</h2>
        <div class="protocol-grid">
          ${protocolCards}
        </div>
      </div>
    `;
  }).join('');
}

