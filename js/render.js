// js/render.js - CORRECTED VERSION

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
  <div class="accordion-content-inner">
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
  <div class="accordion-content-inner">
        ${rightCardContent.indications ? `<p class="indications"><strong>Indications:</strong> ${escapeHtml(rightCardContent.indications)}</p>` : ''}
        ${rightCardContent.contrastRationale ? `<p class="contrast-rationale"><strong>Contrast Rationale:</strong> ${escapeHtml(rightCardContent.contrastRationale)}</p>` : ''}
      </div>
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
  <div class="accordion-content-inner">
    <ul>${sequenceList}</ul>
  </div>
</div>
    </div>
  `;
}

/**
 * Renders a single protocol card HTML string.
 */
function renderProtocolCard(protocol) {
  if (!protocol) return '';
  
  const contrastText = protocol.usesContrast ? 'YES' : 'NO';
  const contrastClass = protocol.usesContrast ? 'contrast-yes' : 'contrast-no';

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
 * Generic function to render consolidated protocol cards
 */
function renderConsolidatedCard(protocols, groupType, mainProtocolName, cardTitle, borderColor = '#9b59b6') {
  const mainProtocol = mainProtocolName ? protocols.find(p => p.study === mainProtocolName) : protocols[0];
  const subProtocols = protocols.filter(p => p.study !== mainProtocol?.study);
  
  if (!mainProtocol) return protocols.map(renderProtocolCard).join('');
  
  const subProtocolsId = `sub-protocols-${groupType}-` + Math.random().toString(36).substr(2, 9);
  const contrastText = mainProtocol.usesContrast ? 'YES' : 'NO';
  const contrastClass = mainProtocol.usesContrast ? 'contrast-yes' : 'contrast-no';
  
  const sequences = mainProtocol.layout?.leftCard?.sequences || [];
  const sortedSequences = sortSequences(sequences);
  
  const rightCardContent = mainProtocol.layout?.rightCard?.content || {};
  
  const sequencesHtml = renderSequencesCard(sortedSequences);
  const indicationsHtml = renderIndicationsCard(rightCardContent);
  const scannerNotesHtml = renderScannerNotesCard(rightCardContent.scannerSpecificNotes);
  
  const subProtocolsList = subProtocols.map(p => `<li class="sub-protocol-item">${p.study}${p.usesContrast ? ' (Contrast)' : ''}</li>`).join('');
  
  return `
    <div class="protocol-card consolidated-${groupType}">
      <div class="protocol-content">
        <div class="left-card">
          <div class="protocol-header">
            <div class="protocol-title-section">
              <h3>Protocol: ${escapeHtml(cardTitle || mainProtocol.study)}</h3>
              <button class="favorite-btn" data-type="protocol" data-study="${escapeHtml(mainProtocol.study)}"><span class="material-symbols-outlined">favorite_border</span></button>
            </div>
            <div class="protocol-info">
              <div class="contrast-indicator ${contrastClass}">
                <span class="contrast-icon material-symbols-outlined">${mainProtocol.usesContrast ? 'science' : 'block'}</span>
                <span>Contrast: ${contrastText}</span>
              </div>
            </div>
          </div>
        </div>
        ${sequencesHtml}
        ${indicationsHtml}
        ${scannerNotesHtml}
        ${subProtocols.length > 0 ? `
        <div class="sub-protocols-card">
          <div class="sub-protocols-header" data-accordion-id="${subProtocolsId}">
            <h4>Related Protocols (${subProtocols.length})</h4>
            <span class="accordion-toggle material-symbols-outlined">expand_more</span>
          </div>
          <div class="sub-protocols-content accordion-content" id="${subProtocolsId}">
  <div class="accordion-content-inner">
    <ul class="sub-protocols-list">${subProtocolsList}</ul>
  </div>
</div>
        </div>
        ` : ''}
      </div>
    </div>
  `;
}

/**
 * Creates breadcrumb navigation.
 */
function renderBreadcrumb(category, protocols) {
  if (protocols.length <= 1) return '';
  const totalCount = protocols.length;
  const mainProtocol = protocols[0]?.study || category;
  return `
    <div class="breadcrumb-nav">
      <nav class="breadcrumb">
        <span class="breadcrumb-item">${escapeHtml(category)}</span>
        <span class="breadcrumb-separator">›</span>
        <span class="breadcrumb-item active">${escapeHtml(mainProtocol)}</span>
        <span class="breadcrumb-count">${totalCount} protocols</span>
      </nav>
    </div>
  `;
}

/**
 * Creates HTML for search results, grouped by category.
 */
export function renderGroupedProtocols(groupedData, isOrdersMode = false) {
  // Functions for consolidating protocols
  const consolidationRenderers = {
    'Brain': (protocols) => renderConsolidatedCard(protocols, 'brain', 'BRAIN', 'Brain Protocols'),
    'Spine': (protocols) => renderConsolidatedCard(protocols, 'spine', 'C-SPINE', 'Spine Imaging'),
    // Add other consolidators here as needed
  };

  return Object.entries(groupedData).map(([category, protocols]) => {
    let protocolCards;
    let breadcrumbHtml = '';
    
    if (isOrdersMode) {
      protocolCards = protocols.map(renderOrderCard).join('');
    } else {
      const renderer = consolidationRenderers[category];
      if (renderer && protocols.length > 1) {
        protocolCards = renderer(protocols);
        breadcrumbHtml = renderBreadcrumb(category, protocols);
      } else {
        protocolCards = protocols.map(renderProtocolCard).join('');
      }
    }
    
    return `
      <div class="protocol-group">
        <h2 class="category-header">${escapeHtml(category)}</h2>
        ${breadcrumbHtml}
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
  
  const clinicalIndications = `<div class="clinical-indication"><strong>Indications:</strong> For evaluation of related symptoms and conditions.</div>`;

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
}