// js/render.js - NO SUBPROTOCOLS VERSION (Individual protocols only)

/**
 * HTML sanitization functions to prevent XSS attacks
 */
function escapeHtml(unsafe) {
  if (typeof unsafe !== 'string') {
    return unsafe;
  }
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function sanitizeForAttribute(unsafe) {
  if (typeof unsafe !== 'string') {
    return unsafe;
  }
  return unsafe.replace(/[^a-zA-Z0-9\-_]/g, '');
}

/**
 * Sorts MRI sequences into a predefined clinical order.
 */
function sortSequences(sequences) {
  const PREDEFINED_ORDER = ['T1', 'T2', 'FLAIR', 'SWAN', 'SWI', 'GRE', 'PD', 'DWI', 'FIESTA', 'COSMIC', 'SPACE', 'MPRAGE', 'SPGR'];
  
  return sequences.slice().sort((a, b) => {
    const aIsRoutineBrain = (a.sequence || '').toUpperCase().includes('ROUTINE BRAIN +');
    const bIsRoutineBrain = (b.sequence || '').toUpperCase().includes('ROUTINE BRAIN +');
    if (aIsRoutineBrain && !bIsRoutineBrain) return -1;
    if (!aIsRoutineBrain && bIsRoutineBrain) return 1;
    if (aIsRoutineBrain && bIsRoutineBrain) return 0;
    
    const aIsContrast = a.contrast === true || a.highlight === true;
    const bIsContrast = b.contrast === true || b.highlight === true;
    if (!aIsContrast && bIsContrast) return -1;
    if (aIsContrast && !bIsContrast) return 1;

    if (!aIsContrast && !bIsContrast) {
      const aBaseType = a.sequence?.split(' ')[0].toUpperCase();
      const bBaseType = b.sequence?.split(' ')[0].toUpperCase();
      const indexA = PREDEFINED_ORDER.indexOf(aBaseType);
      const indexB = PREDEFINED_ORDER.indexOf(bBaseType);
      if (indexA !== -1 && indexB !== -1) return indexA - indexB;
      if (indexA !== -1) return -1;
      if (indexB !== -1) return 1;
    }
    return (a.sequence || '').localeCompare(b.sequence || '');
  });
}

/**
 * Renders scanner-specific notes as a separate card
 */
function renderScannerNotesCard(scannerNotes) {
  if (!scannerNotes || typeof scannerNotes !== 'object') return '';

  const scannerSections = Object.entries(scannerNotes).map(([scannerType, sequences]) => {
    if (!Array.isArray(sequences) || sequences.length === 0) return '';
    const sequenceList = sequences.map(seq => `<li class="${seq.highlight ? 'highlight-sequence' : ''}">${escapeHtml(seq.sequence)}</li>`).join('');
    return `<div class="scanner-section"><h3>${escapeHtml(scannerType)}</h3><ul class="scanner-sequences">${sequenceList}</ul></div>`;
  }).filter(Boolean);

  if (scannerSections.length === 0) return '';

  const accordionId = 'scanner-notes-' + Date.now() + '-' + Math.floor(Math.random() * 1000);

  return `
    <div class="scanner-notes-card">
      <div class="scanner-notes-header" data-accordion-id="${accordionId}">
        <h4>Scanner Specific Notes</h4>
        <span class="accordion-toggle material-symbols-outlined">expand_more</span>
      </div>
      <div class="scanner-notes-content accordion-content" id="${accordionId}">
        ${scannerSections.join('')}
      </div>
    </div>
  `;
}

/**
 * Renders a separate card for indications and contrast rationale
 */
function renderIndicationsCard(rightCardContent) {
  if (!rightCardContent || (!rightCardContent.indications && !rightCardContent.contrastRationale)) return '';

  const accordionId = 'indications-' + Date.now() + '-' + Math.floor(Math.random() * 1000);

  return `
    <div class="indications-card">
      <div class="indications-header" data-accordion-id="${accordionId}">
        <h4>Clinical Information</h4>
        <span class="accordion-toggle material-symbols-outlined expanded">expand_more</span>
      </div>
      <div class="indications-content accordion-content open" id="${accordionId}">
        ${rightCardContent.indications ? `<p class="indications"><strong>Indications:</strong> ${escapeHtml(rightCardContent.indications)}</p>` : ''}
        ${rightCardContent.contrastRationale ? `<p class="contrast-rationale"><strong>Contrast Rationale:</strong> ${escapeHtml(rightCardContent.contrastRationale)}</p>` : ''}
      </div>
    </div>
  `;
}

/**
 * Renders a separate card for sequences with accordion functionality
 */
function renderSequencesCard(sequences) {
  if (!sequences || sequences.length === 0) return '';

  const accordionId = 'sequences-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
  const sequenceList = sequences.map(seq => `<li class="${seq.highlight ? 'highlight-sequence' : ''}">${escapeHtml(seq.sequence)}</li>`).join('\n') || '<li>None listed</li>';

  return `
    <div class="sequences-card">
      <div class="sequences-header" data-accordion-id="${accordionId}">
        <h4>Sequences</h4>
        <span class="accordion-toggle material-symbols-outlined">expand_more</span>
      </div>
      <div class="sequences-content accordion-content" id="${accordionId}">
        <ul>${sequenceList}</ul>
      </div>
    </div>
  `;
}

/**
 * Determines the appropriate clinical order name(s) for a protocol based on its study name and contrast usage
 * Returns a string for single orders, or an array for multiple orders (like arthrograms)
 */
function determineProtocolOrderName(protocol) {
  if (!protocol || !protocol.study) return null;
  
  const studyName = protocol.study.toUpperCase();
  const usesContrast = protocol.usesContrast;
  
  // Arthrogram studies require two separate orders
  if (studyName.includes('ARTHROGRAM')) {
    let bodyPart = '';
    if (studyName.includes('SHOULDER')) bodyPart = 'SHOULDER';
    else if (studyName.includes('WRIST')) bodyPart = 'WRIST'; 
    else if (studyName.includes('HIP')) bodyPart = 'HIP';
    else if (studyName.includes('KNEE')) bodyPart = 'KNEE';
    else if (studyName.includes('ANKLE')) bodyPart = 'ANKLE';
    
    if (bodyPart) {
      return [
        `MRI ${bodyPart} W/O CONTRAST`,
        `RF ARTHROGRAM ${bodyPart}`
      ];
    }
  }
  
  // Brain studies
  if (studyName.includes('BRAIN') || studyName === 'SEIZURE' || studyName.includes('MS')) {
    if (studyName.includes('TUMOR') || studyName.includes('INF') || studyName === 'SEIZURE' || studyName.includes('MS')) {
      return usesContrast ? 'MRI BRAIN W/ + W/O CONTRAST' : 'MRI BRAIN W/O CONTRAST';
    }
    return usesContrast ? 'MRI BRAIN W/ CONTRAST' : 'MRI BRAIN W/O CONTRAST';
  }
  
  // IAC studies
  if (studyName.includes('IAC')) {
    return usesContrast ? 'MRI IAC W/ + W/O CONTRAST' : 'MRI IAC W/O CONTRAST';
  }
  
  // Pituitary studies
  if (studyName.includes('PITUITARY')) {
    return 'MRI SELLA (PITUITARY) W/ +W/O CONTRAST';
  }
  
  // Orbit studies
  if (studyName.includes('ORBIT')) {
    return usesContrast ? 'MRI ORBITS W/ + W/O CONTRAST' : 'MRI ORBITS W/O CONTRAST';
  }
  
  // TIA and stroke studies
  if (studyName.includes('TIA')) {
    if (studyName.includes('MRA') || studyName.includes('DISSECTION')) {
      return 'MRA BRAIN/HEAD W/O CONTRAST';
    }
    return usesContrast ? 'MRI BRAIN W/ + W/O CONTRAST' : 'MRI BRAIN W/O CONTRAST';
  }
  
  // Aneurysm studies
  if (studyName.includes('ANEURYSM')) {
    return 'MRA BRAIN/HEAD W/O CONTRAST';
  }
  
  // Neck soft tissue
  if (studyName.includes('NECK SOFT TISSUE')) {
    return usesContrast ? 'MRI NECK W/ CONTRAST' : 'MRI NECK W/O CONTRAST';
  }
  
  // Brachial plexus
  if (studyName.includes('BRACHIAL PLEXUS')) {
    return 'MRI BRACHIAL PLEXUS W/O CONTRAST';
  }
  
  // TMJ studies
  if (studyName.includes('TMJ')) {
    return 'MRI TMJ W/O CONTRAST';
  }
  
  // Spine studies
  if (studyName.includes('SPINE') || studyName === 'C-SPINE' || studyName === 'T-SPINE' || studyName === 'L-SPINE') {
    let spineRegion = '';
    if (studyName.includes('CERVICAL') || studyName.includes('C-SPINE') || studyName === 'C-SPINE') spineRegion = 'CERVICAL';
    else if (studyName.includes('THORACIC') || studyName.includes('T-SPINE') || studyName === 'T-SPINE') spineRegion = 'THORACIC';
    else if (studyName.includes('LUMBAR') || studyName.includes('L-SPINE') || studyName === 'L-SPINE') spineRegion = 'LUMBAR';
    
    if (spineRegion) {
      return usesContrast ? `MRI SPINE ${spineRegion} W/ + W/O CONTRAST` : `MRI SPINE ${spineRegion} W/O CONTRAST`;
    }
  }
  
  // Sacrum
  if (studyName.includes('SACRUM')) {
    return usesContrast ? 'MRI SACRUM W/ CONTRAST' : 'MRI SACRUM W/O CONTRAST';
  }
  
  // Knee studies
  if (studyName.includes('KNEE')) {
    return usesContrast ? 'MRI KNEE W/ CONTRAST' : 'MRI KNEE W/O CONTRAST';
  }
  
  // Shoulder studies
  if (studyName.includes('SHOULDER')) {
    return usesContrast ? 'MRI SHOULDER W/ CONTRAST' : 'MRI SHOULDER W/O CONTRAST';
  }
  
  // Abdomen studies
  if (studyName.includes('ABDOMEN')) {
    return usesContrast ? 'MRI ABDOMEN W/ + W/O CONTRAST' : 'MRI ABDOMEN W/O CONTRAST';
  }
  
  // Pelvis studies
  if (studyName.includes('PELVIS')) {
    return usesContrast ? 'MRI PELVIS W/ + W/O CONTRAST' : 'MRI PELVIS W/O CONTRAST';
  }
  
  // Cardiac studies
  if (studyName.includes('CARDIAC') || studyName.includes('HEART')) {
    return usesContrast ? 'MRI CARDIAC W/ + W/O CONTRAST' : 'MRI CARDIAC W/O CONTRAST';
  }
  
  // Angiography studies
  if (studyName.includes('MRA') || studyName.includes('ANGIO')) {
    if (studyName.includes('BRAIN') || studyName.includes('HEAD')) {
      return 'MRA BRAIN/HEAD W/O CONTRAST';
    }
    if (studyName.includes('NECK') || studyName.includes('CAROTID')) {
      return 'MRA NECK/CAROTID W/O CONTRAST';
    }
  }
  
  // Default fallback - construct from protocol name
  const baseOrder = `MRI ${studyName}`;
  return usesContrast ? `${baseOrder} W/ CONTRAST` : `${baseOrder} W/O CONTRAST`;
}

/**
 * Renders a single protocol card HTML string.
 */
function renderProtocolCard(protocol) {
  if (!protocol) return '';
  
  const contrastText = protocol.usesContrast ? 'YES' : 'NO';
  const contrastClass = protocol.usesContrast ? 'contrast-yes' : 'contrast-no';
  
  // Determine clinical order name(s) for this protocol
  const clinicalOrderName = determineProtocolOrderName(protocol);
  let orderNameBadge = '';
  
  if (clinicalOrderName) {
    if (Array.isArray(clinicalOrderName)) {
      // Multiple orders (like arthrograms)
      orderNameBadge = clinicalOrderName.map(order => 
        `<span class="protocol-order-type-badge">${escapeHtml(order)}</span>`
      ).join('');
    } else {
      // Single order
      orderNameBadge = `<span class="protocol-order-type-badge">${escapeHtml(clinicalOrderName)}</span>`;
    }
  }

  const sequences = protocol.layout?.leftCard?.sequences || [];
  const sortedSequences = sortSequences(sequences);
  
  const rightCardContent = protocol.layout?.rightCard?.content || {};
  const fullHeight = protocol.layout?.rightCard?.fullHeight;

  const scannerNotesHtml = renderScannerNotesCard(rightCardContent.scannerSpecificNotes);
  const indicationsHtml = renderIndicationsCard(rightCardContent);
  const sequencesHtml = renderSequencesCard(sortedSequences);

  return `
    <div class="protocol-card" data-study="${escapeHtml(protocol.study)}" data-section="${escapeHtml(protocol.section || 'Other')}">
      <div class="protocol-content ${fullHeight ? 'full-height' : ''}">
        <div class="left-card">
          <div class="protocol-header">
            ${orderNameBadge}
            <div class="protocol-title-section">
              <h3>Protocol: ${escapeHtml(protocol.study || 'Untitled Study')}</h3>
              <button class="favorite-btn" data-type="protocol" data-study="${escapeHtml(protocol.study)}" title="Add to favorites">
                <span class="material-symbols-outlined">favorite_border</span>
              </button>
            </div>
            <div class="protocol-info">
              <div class="contrast-indicator ${contrastClass}">
                <span class="contrast-icon material-symbols-outlined">${protocol.usesContrast ? 'science' : 'block'}</span>
                <span>Contrast: ${contrastText}</span>
              </div>
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
 * This function has been removed - protocols should always be individual
 * No consolidation or grouping should ever occur
 */

/**
 * Breadcrumb function removed - no longer needed since protocols are always individual
 */

/**
 * Creates HTML for search results, grouped by category.
 */
export function renderGroupedProtocols(groupedData, isOrdersMode = false) {
  // Force individual protocol cards - no consolidation
  console.log('Rendering protocols:', groupedData); // Debug log
  return Object.entries(groupedData).map(([category, protocols]) => {
    let protocolCards;
    
    if (isOrdersMode) {
      protocolCards = protocols.map(renderOrderCard).join('');
    } else {
      // Ensure each protocol gets its own card
      console.log(`Rendering ${protocols.length} individual cards for ${category}`); // Debug log
      console.log('Protocol names:', protocols.map(p => p.study)); // Debug log
      protocolCards = protocols.map((protocol, index) => {
        console.log(`Rendering individual card ${index + 1}: ${protocol.study}`);
        return renderProtocolCard(protocol);
      }).join('');
    }
    
    return `
      <div class="protocol-group">
        <h2 class="category-header">${escapeHtml(category)}</h2>
        <div class="protocol-grid">${protocolCards}</div>
      </div>
    `;
  }).join('');
}

/**
 * Renders a simplified card for imaging orders
 */
function renderOrderCard(order) {
  const contrastIndicator = order.usesContrast ? `<span class="contrast-badge contrast-yes">With Contrast</span>` : `<span class="contrast-badge contrast-no">No Contrast</span>`;
  const modalityBadge = `<span class="modality-badge modality-${(order.modality || 'unknown').toLowerCase().replace(/[\s/]/g, '-')}">${escapeHtml(order.modality || 'Unknown')}</span>`;
  const orderTypeBadge = order.orderType && order.orderType !== 'Standard' ? `<span class="order-type-badge">${escapeHtml(order.orderType)}</span>` : '';
  
  const clinicalIndications = order.indication 
    ? `<div class="clinical-indication"><strong>Indications:</strong> ${escapeHtml(order.indication)}</div>`
    : `<div class="clinical-indication"><strong>Indications:</strong> For evaluation of related symptoms and conditions.</div>`;

  return `
    <div class="protocol-card order-card">
      <div class="protocol-header">
        <div class="protocol-title-section">
          <h3 class="protocol-title">${escapeHtml(order.study)}</h3>
          <button class="favorite-btn" data-type="order" data-study="${escapeHtml(order.study)}"><span class="material-symbols-outlined">favorite_border</span></button>
        </div>
        <div class="protocol-badges">${modalityBadge}${contrastIndicator}${orderTypeBadge}</div>
      </div>
      <div class="order-details">${clinicalIndications}</div>
    </div>
  `;
}// Force browser cache refresh
