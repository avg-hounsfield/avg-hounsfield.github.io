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
 * Renders scanner-specific notes as a separate card
 */
function renderScannerNotesCard(scannerNotes) {
  if (!scannerNotes || typeof scannerNotes !== 'object') {
    return '';
  }

  const scannerSections = Object.entries(scannerNotes).map(([scannerType, sequences]) => {
    if (!Array.isArray(sequences) || sequences.length === 0) {
      return '';
    }

    const sequenceList = sequences.map(seq => {
      const isHighlight = seq.highlight === true;
      const liClass = isHighlight ? 'class="highlight-sequence"' : '';
      return `<li ${liClass}>${seq.sequence}</li>`;
    }).join('');

    return `
      <div class="scanner-section">
        <h3>${scannerType}</h3>
        <ul class="scanner-sequences">
          ${sequenceList}
        </ul>
      </div>
    `;
  }).filter(Boolean);

  if (scannerSections.length === 0) {
    return '';
  }

  // Generate unique ID for this accordion
  const accordionId = 'scanner-notes-' + Math.random().toString(36).substr(2, 9);

  return `
    <div class="scanner-notes-card">
      <div class="scanner-notes-header" onclick="toggleAccordion('${accordionId}')">
        <h4>Scanner Specific Notes</h4>
        <span class="accordion-toggle" id="toggle-${accordionId}">+</span>
      </div>
      <div class="scanner-notes-content" id="${accordionId}" style="display: none;">
        ${scannerSections.join('')}
      </div>
    </div>
  `;
}

/**
 * Renders scanner-specific notes if they exist
 */
function renderScannerNotes(scannerNotes) {
  if (!scannerNotes || typeof scannerNotes !== 'object') {
    return '';
  }

  const scannerSections = Object.entries(scannerNotes).map(([scannerType, sequences]) => {
    if (!Array.isArray(sequences) || sequences.length === 0) {
      return '';
    }

    const sequenceList = sequences.map(seq => {
      const isHighlight = seq.highlight === true;
      const liClass = isHighlight ? 'class="highlight-sequence"' : '';
      return `<li ${liClass}>${seq.sequence}</li>`;
    }).join('');

    return `
      <div class="scanner-section">
        <h3>${scannerType}</h3>
        <ul class="scanner-sequences">
          ${sequenceList}
        </ul>
      </div>
    `;
  }).filter(Boolean);

  if (scannerSections.length === 0) {
    return '';
  }

  return `
    <div class="scanner-notes">
      <h4>Scanner Specific Notes:</h4>
      ${scannerSections.join('')}
    </div>
  `;
}

/**
 * Renders a separate card for indications and contrast rationale
 */
function renderIndicationsCard(rightCardContent) {
  if (!rightCardContent || (!rightCardContent.indications && !rightCardContent.contrastRationale)) {
    return '';
  }

  // Generate unique ID for this accordion
  const accordionId = 'indications-' + Math.random().toString(36).substr(2, 9);

  return `
    <div class="indications-card">
      <div class="indications-header" onclick="toggleAccordion('${accordionId}')">
        <h4>Clinical Information</h4>
        <span class="accordion-toggle" id="toggle-${accordionId}">+</span>
      </div>
      <div class="indications-content" id="${accordionId}" style="display: none;">
        ${rightCardContent.indications ? 
          `<p class="indications"><strong>Indications:</strong> ${rightCardContent.indications}</p>` 
          : ''}
        ${rightCardContent.contrastRationale ? 
          `<p class="contrast-rationale"><strong>Contrast Rationale:</strong> ${rightCardContent.contrastRationale}</p>` 
          : ''}
      </div>
    </div>
  `;
}

/**
 * Renders a separate card for sequences with accordion functionality
 */
function renderSequencesCard(sequences) {
  if (!sequences || sequences.length === 0) {
    return '';
  }

  // Generate unique ID for this accordion
  const accordionId = 'sequences-' + Math.random().toString(36).substr(2, 9);

  return `
    <div class="sequences-card">
      <div class="sequences-header" onclick="toggleAccordion('${accordionId}')">
        <h4>Sequences</h4>
        <span class="accordion-toggle" id="toggle-${accordionId}">+</span>
      </div>
      <div class="sequences-content" id="${accordionId}" style="display: none;">
        <ul>
          ${sequences.map(seq => {
            const isHighlight = seq.highlight === true;
            const liClass = isHighlight ? 'class="highlight-sequence"' : '';
            return `<li ${liClass}>${seq.sequence}</li>`;
          }).join('\n          ') || '<li>None listed</li>'}
        </ul>
      </div>
    </div>
  `;
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

  // Get scanner-specific notes
  const scannerNotesHtml = renderScannerNotesCard(rightCardContent.scannerSpecificNotes);
  
  // Get indications and contrast rationale
  const indicationsHtml = renderIndicationsCard(rightCardContent);

  // Create sequences card similar to other accordion cards
  const sequencesHtml = renderSequencesCard(sortedSequences);

  return `
    <div class="protocol-card">
      <div class="protocol-content ${fullHeight ? 'full-height' : ''}">
        <div class="left-card">
          <div class="protocol-header">
            <h3>Protocol: ${protocol.study || 'Untitled Study'}</h3>
            <div class="protocol-info">
              <span class="${contrastClass}"><strong>Contrast:</strong> <span class="contrast-value ${contrastClass}">${contrastText}</span></span>
            </div>
          </div>
        </div>

        ${sequencesHtml}

        ${indicationsHtml}

        ${scannerNotesHtml}
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

