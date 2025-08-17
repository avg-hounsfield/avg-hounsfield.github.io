// js/render.js - FINAL VERSION

/**
 * Sorts MRI sequences into a predefined clinical order.
 */
// js/render.js - CORRECTED sortSequences function

function sortSequences(sequences) {
  const PREDEFINED_ORDER = ['T1', 'T2', 'FLAIR', 'SWAN', 'SWI', 'GRE', 'PD', 'DWI', 'FIESTA', 'COSMIC', 'SPACE', 'MPRAGE', 'SPGR'];
  
  return sequences.slice().sort((a, b) => {
    // ROUTINE BRAIN + always comes first
    const aIsRoutineBrain = (a.sequence || '').toUpperCase().includes('ROUTINE BRAIN +');
    const bIsRoutineBrain = (b.sequence || '').toUpperCase().includes('ROUTINE BRAIN +');
    
    if (aIsRoutineBrain && !bIsRoutineBrain) return -1;
    if (!aIsRoutineBrain && bIsRoutineBrain) return 1;
    if (aIsRoutineBrain && bIsRoutineBrain) return 0; // Both are routine brain, maintain order
    
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
  
  const contrastText = protocol.usesContrast ? 'YES' : 'NO';
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
    <div class="protocol-card" data-study="${protocol.study}" data-contrast="${protocol.usesContrast}" data-section="${protocol.section || 'Other'}">
      <div class="protocol-content ${fullHeight ? 'full-height' : ''}">
        <div class="left-card">
          <div class="protocol-header">
            <h3>Protocol: ${protocol.study || 'Untitled Study'}</h3>
            <div class="protocol-info">
              <span class="${contrastClass}">Contrast: <span class="contrast-value ${contrastClass}">${contrastText}</span></span>
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
 * Generic function to render consolidated protocol cards
 */
function renderConsolidatedCard(protocols, groupType, mainProtocolName, cardTitle, borderColor = '#9b59b6') {
  // Find the main protocol or use the first one if main not specified
  const mainProtocol = mainProtocolName ? 
    protocols.find(p => p.study === mainProtocolName) : 
    protocols[0];
  const subProtocols = protocols.filter(p => p.study !== mainProtocol?.study);
  
  if (!mainProtocol) return protocols.map(renderProtocolCard).join('');
  
  // Generate unique ID for sub-protocols accordion
  const subProtocolsId = `sub-protocols-${groupType}-` + Math.random().toString(36).substr(2, 9);
  
  const contrastText = mainProtocol.usesContrast ? 'YES' : 'NO';
  const contrastClass = mainProtocol.usesContrast ? 'contrast-yes' : 'contrast-no';
  
  // Get sequences from main protocol
  const sequences = mainProtocol.layout?.leftCard?.sequences || [];
  let sortedSequences;
  
  try {
    sortedSequences = sortSequences(sequences);
  } catch (error) {
    console.error('Error sorting sequences:', error);
    sortedSequences = sequences;
  }
  
  // Get content from the right card
  const rightCardContent = mainProtocol.layout?.rightCard?.content || {};
  const fullHeight = mainProtocol.layout?.rightCard?.fullHeight;
  
  // Create sequences card
  const sequencesHtml = renderSequencesCard(sortedSequences);
  
  // Get indications and contrast rationale
  const indicationsHtml = renderIndicationsCard(rightCardContent);
  
  // Get scanner-specific notes
  const scannerNotesHtml = renderScannerNotesCard(rightCardContent.scannerSpecificNotes);
  
  // Create sub-protocols list with custom styling
  const subProtocolsList = subProtocols.map(protocol => {
    const contrast = protocol.usesContrast ? ' (Contrast)' : ' (No Contrast)';
    return `<li class="sub-protocol-item" style="border-left-color: ${borderColor}" data-study="${protocol.study}">${protocol.study}${contrast}</li>`;
  }).join('');
  
  return `
    <div class="protocol-card consolidated-${groupType}" data-study="${mainProtocol.study}" data-contrast="${mainProtocol.usesContrast}" data-section="${mainProtocol.section || 'Other'}">
      <div class="protocol-content ${fullHeight ? 'full-height' : ''}">
        <div class="left-card">
          <div class="protocol-header">
            <h3>Protocol: ${cardTitle || mainProtocol.study}</h3>
            <div class="protocol-info">
              <span class="${contrastClass}">Contrast: <span class="contrast-value ${contrastClass}">${contrastText}</span></span>
            </div>
          </div>
        </div>

        ${sequencesHtml}

        ${indicationsHtml}

        ${scannerNotesHtml}

        ${subProtocols.length > 0 ? `
        <div class="sub-protocols-card" style="border-left-color: ${borderColor}">
          <div class="sub-protocols-header" onclick="toggleAccordion('${subProtocolsId}')">
            <h4>Related Protocols (${subProtocols.length})</h4>
            <span class="accordion-toggle" id="toggle-${subProtocolsId}">+</span>
          </div>
          <div class="sub-protocols-content" id="${subProtocolsId}" style="display: none;">
            <ul class="sub-protocols-list">
              ${subProtocolsList}
            </ul>
          </div>
        </div>
        ` : ''}
      </div>
    </div>
  `;
}

/**
 * Renders a consolidated brain protocol card with sub-protocols
 */
function renderConsolidatedBrainCard(protocols) {
  return renderConsolidatedCard(protocols, 'brain', 'BRAIN', 'Brain Protocols', '#9b59b6');
}

/**
 * Renders a consolidated spine protocol card with sub-protocols
 */
function renderConsolidatedSpineCard(protocols) {
  return renderConsolidatedCard(protocols, 'spine', 'C-SPINE', 'Spine Imaging', '#e74c3c');
}

/**
 * Renders a consolidated cerebrovascular protocol card with sub-protocols
 */
function renderConsolidatedCerebrovascularCard(protocols) {
  return renderConsolidatedCard(protocols, 'cerebrovascular', 'TIA', 'Cerebrovascular Imaging', '#3498db');
}

/**
 * Renders a consolidated arthrography protocol card with sub-protocols
 */
function renderConsolidatedArthrographyCard(protocols) {
  return renderConsolidatedCard(protocols, 'arthrography', 'SHOULDER ARTHROGRAM', 'Joint Arthrography', '#f39c12');
}

/**
 * Renders a consolidated orbital protocol card with sub-protocols
 */
function renderConsolidatedOrbitalCard(protocols) {
  return renderConsolidatedCard(protocols, 'orbital', 'ORBITS', 'Orbital Imaging', '#16a085');
}

/**
 * Renders a consolidated upper extremity protocol card with sub-protocols
 */
function renderConsolidatedUpperExtremityCard(protocols) {
  return renderConsolidatedCard(protocols, 'upper-extremity', 'SHOULDER', 'Upper Extremity Imaging', '#8e44ad');
}

/**
 * Renders a consolidated lower extremity protocol card with sub-protocols
 */
function renderConsolidatedLowerExtremityCard(protocols) {
  return renderConsolidatedCard(protocols, 'lower-extremity', 'HIP', 'Lower Extremity Imaging', '#27ae60');
}

/**
 * Creates breadcrumb navigation for consolidated protocols
 */
function renderBreadcrumb(category, protocols, isConsolidated = false) {
  if (!isConsolidated) return '';
  
  const totalCount = protocols.length;
  const mainProtocol = protocols[0]?.study || category;
  
  return `
    <div class="breadcrumb-nav">
      <nav class="breadcrumb">
        <span class="breadcrumb-item" onclick="searchCategory('${category.toLowerCase()}')">${category}</span>
        <span class="breadcrumb-separator">›</span>
        <span class="breadcrumb-item active">${mainProtocol}</span>
        <span class="breadcrumb-count">${totalCount} protocols</span>
      </nav>
    </div>
  `;
}

/**
 * Creates HTML for search results, grouped by category.
 */
export function renderGroupedProtocols(groupedData, isOrdersMode = false) {
  return Object.entries(groupedData).map(([category, protocols]) => {
    let protocolCards;
    let breadcrumbHtml = '';
    let isConsolidated = false;
    
    if (isOrdersMode) {
      // For orders, use simple card rendering without consolidation
      protocolCards = protocols.map(renderOrderCard).join('');
    } else {
      // Original protocol consolidation logic
      if (category === 'Brain' && protocols.length > 1) {
        protocolCards = renderConsolidatedBrainCard(protocols);
        isConsolidated = true;
      } else if (category === 'Spine' && protocols.length > 1) {
        protocolCards = renderConsolidatedSpineCard(protocols);
        isConsolidated = true;
      } else if (category === 'Cerebrovascular' && protocols.length > 1) {
        protocolCards = renderConsolidatedCerebrovascularCard(protocols);
        isConsolidated = true;
      } else if (category === 'Joint Arthrography' && protocols.length > 1) {
        protocolCards = renderConsolidatedArthrographyCard(protocols);
        isConsolidated = true;
      } else if (category === 'Orbital Imaging' && protocols.length > 1) {
        protocolCards = renderConsolidatedOrbitalCard(protocols);
        isConsolidated = true;
      } else if (category === 'Upper Extremity' && protocols.length > 1) {
        protocolCards = renderConsolidatedUpperExtremityCard(protocols);
        isConsolidated = true;
      } else if (category === 'Lower Extremity' && protocols.length > 1) {
        protocolCards = renderConsolidatedLowerExtremityCard(protocols);
        isConsolidated = true;
      } else {
        protocolCards = protocols.map(renderProtocolCard).join('');
      }
    }
    
    // Add breadcrumb for consolidated protocols
    if (isConsolidated) {
      breadcrumbHtml = renderBreadcrumb(category, protocols, true);
    }
    
    return `
      <div class="protocol-group">
        <h2 class="category-header">${category}</h2>
        ${breadcrumbHtml}
        <div class="protocol-grid">
          ${protocolCards}
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Renders a simplified card for imaging orders
 */
function renderOrderCard(order) {
  const contrastIndicator = order.usesContrast ? 
    '<span class="contrast-badge contrast-yes">With Contrast</span>' : 
    '<span class="contrast-badge contrast-no">No Contrast</span>';
  
  const modalityBadge = `<span class="modality-badge modality-${order.modality?.toLowerCase().replace(/\//g, '-').replace(/\s+/g, '-') || 'unknown'}">${order.modality || 'Unknown'}</span>`;
  
  const orderTypeBadge = order.orderType && order.orderType !== 'Standard' ? 
    `<span class="order-type-badge">${order.orderType}</span>` : '';

  // Add clinical indications based on order type and study name
  let clinicalIndications = '';
  const studyUpper = order.study.toUpperCase();
  
  if (studyUpper.includes('ANGIO')) {
    clinicalIndications = '<div class="clinical-indication">🔍 <strong>Vascular imaging:</strong> Evaluates blood vessels, stenosis, aneurysms</div>';
  } else if (studyUpper.includes('STONE PROTOCOL')) {
    clinicalIndications = '<div class="clinical-indication">💎 <strong>Stone detection:</strong> Identifies kidney/ureteral stones without contrast</div>';
  } else if (studyUpper.includes('LOW DOSE LUNG')) {
    clinicalIndications = '<div class="clinical-indication">🫁 <strong>Lung screening:</strong> Early lung cancer detection for high-risk patients</div>';
  } else if (studyUpper.includes('CALCIUM SCORING')) {
    clinicalIndications = '<div class="clinical-indication">❤️ <strong>Cardiac risk:</strong> Quantifies coronary artery calcium for risk stratification</div>';
  } else if (studyUpper.includes('ENTEROGRAPHY')) {
    clinicalIndications = '<div class="clinical-indication">🔬 <strong>Bowel imaging:</strong> Evaluates inflammatory bowel disease (Crohn\'s, UC)</div>';
  } else if (studyUpper.includes('MRCP')) {
    clinicalIndications = '<div class="clinical-indication">🟡 <strong>Biliary imaging:</strong> Evaluates bile ducts, gallbladder, pancreatic duct</div>';
  } else if (studyUpper.includes('PROSTATE')) {
    clinicalIndications = '<div class="clinical-indication">🎯 <strong>Prostate evaluation:</strong> Cancer detection, staging, and monitoring</div>';
  } else if (studyUpper.includes('BONE DENSITY')) {
    clinicalIndications = '<div class="clinical-indication">🦴 <strong>Bone health:</strong> Osteoporosis screening and monitoring</div>';
  } else if (studyUpper.includes('PET')) {
    clinicalIndications = '<div class="clinical-indication">⚡ <strong>Metabolic imaging:</strong> Cancer staging, treatment response assessment</div>';
  }

  return `
    <div class="protocol-card order-card">
      <div class="protocol-header">
        <h3 class="protocol-title">${order.study}</h3>
        <div class="protocol-badges">
          ${modalityBadge}
          ${contrastIndicator}
          ${orderTypeBadge}
        </div>
      </div>
      <div class="order-details">
        ${clinicalIndications}
        <div class="order-info">
          <p><strong>Modality:</strong> ${order.modality || 'Not specified'}</p>
          <p><strong>Order Type:</strong> ${order.orderType || 'Standard'}</p>
          <p><strong>Section:</strong> ${order.section || 'Other'}</p>
        </div>
      </div>
    </div>
  `;
}

// Global function for breadcrumb navigation
window.searchCategory = function(category) {
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.value = category;
    
    // Trigger search
    const searchEvent = new Event('input', { bubbles: true });
    searchInput.dispatchEvent(searchEvent);
  }
};

