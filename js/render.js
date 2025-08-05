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
      const aBaseType = a.type.split(' ')[0].toUpperCase();
      const bBaseType = b.type.split(' ')[0].toUpperCase();
      const indexA = PREDEFINED_ORDER.indexOf(aBaseType);
      const indexB = PREDEFINED_ORDER.indexOf(bBaseType);
      
      if (indexA !== -1 && indexB !== -1) return indexA - indexB;
      if (indexA !== -1) return -1;
      if (indexB !== -1) return 1;
    }

    // Fallback to alphabetical sort for everything else
    return a.type.localeCompare(b.type);
  });
}

/**
 * Renders a single protocol card HTML string.
 */
function renderProtocolCard(protocol) {
  if (!protocol) return ''; // Safety check
  
  const scannerClasses = protocol.scanner.map(s => `scanner-${s.replace('.', '-')}`).join(' ');
  const scannerText = protocol.scanner.join(' / ');
  const contrastText = protocol.usesContrast ? 'Yes' : 'No';
  const contrastClass = protocol.usesContrast ? 'contrast-yes' : 'contrast-no';

  // Safely sort sequences; default to an empty array if they don't exist.
  const sortedSequences = protocol.sequences ? sortSequences(protocol.sequences) : [];

  return `
    <div class="protocol-card ${scannerClasses}">
      <h3>${protocol.study || 'Untitled Study'}</h3>
      <p><strong>Scanner:</strong> ${scannerText}</p>
      <p><strong>Contrast:</strong> <span class="contrast-value ${contrastClass}">${contrastText}</span></p>

      <div class="sequences">
        <h4>Sequences:</h4>
        <ul>
          ${sortedSequences.map(seq => {
            const isContrastSequence = seq.contrast === true || seq.highlight === true;
            const liClass = isContrastSequence ? 'class="contrast-sequence"' : '';
            return `
              <li ${liClass}>
                <strong>${seq.type}:</strong> ${seq.planes?.join(', ') || '–'}
                ${seq.note ? `<em class="note">(${seq.note})</em>` : ''}
              </li>
            `;
          }).join('') || '<li>None listed</li>'}
        </ul>
      </div>
      ${protocol.note ? `<p class="protocol-note"><strong>Note:</strong> ${protocol.note}</p>` : ''}
    </div>
  `;
}

/**
 * Creates HTML for search results, pairing 1.5T and 3T protocols side-by-side.
 */
export function renderPairedProtocols(groupedData) {
  return Object.entries(groupedData).map(([category, protocols]) => {
    const studies = protocols.reduce((acc, protocol) => {
      const studyName = protocol.study || 'Uncategorized';
      if (!acc[studyName]) {
        acc[studyName] = {};
      }
      // Because of the data transformation, protocol.scanner is always a single-item array
      const scannerType = protocol.scanner[0]; 
      acc[studyName][scannerType] = protocol;
      return acc;
    }, {});

    const renderedGrids = Object.values(studies).map(studyPair => {
      // Render the cards or placeholders. 1.5T is always on the left.
      const card1_5T = renderProtocolCard(studyPair['1.5T']) || '<div class="card-placeholder"></div>';
      const card3T = renderProtocolCard(studyPair['3T']) || '<div class="card-placeholder"></div>';
      
      return `
        <div class="protocol-grid-container">
          ${card1_5T}
          ${card3T}
        </div>
      `;
    }).join('');

    return `
      <div class="category-block">
        <h2 class="category-header">${category}</h2>
        ${renderedGrids}
      </div>
    `;
  }).join('');
}