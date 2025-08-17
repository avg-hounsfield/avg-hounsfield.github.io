// js/render.js - FINAL VERSION

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
  // More restrictive sanitization for HTML attributes
  return unsafe.replace(/[^a-zA-Z0-9\-_]/g, '');
}

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
      return `<li ${liClass}>${escapeHtml(seq.sequence)}</li>`;
    }).join('');

    return `
      <div class="scanner-section">
        <h3>${escapeHtml(scannerType)}</h3>
        <ul class="scanner-sequences">
          ${sequenceList}
        </ul>
      </div>
    `;
  }).filter(Boolean);

  if (scannerSections.length === 0) {
    return '';
  }

  // Generate unique ID for this accordion using more efficient method
  const accordionId = 'scanner-notes-' + Date.now() + '-' + (Math.floor(Math.random() * 1000));

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
      return `<li ${liClass}>${escapeHtml(seq.sequence)}</li>`;
    }).join('');

    return `
      <div class="scanner-section">
        <h3>${escapeHtml(scannerType)}</h3>
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

  // Generate unique ID for this accordion using more efficient method
  const accordionId = 'indications-' + Date.now() + '-' + (Math.floor(Math.random() * 1000));

  return `
    <div class="indications-card">
      <div class="indications-header" onclick="toggleAccordion('${accordionId}')">
        <h4>Clinical Information</h4>
        <span class="accordion-toggle" id="toggle-${accordionId}">−</span>
      </div>
      <div class="indications-content accordion-open" id="${accordionId}" style="display: block;">
        ${rightCardContent.indications ? 
          `<p class="indications"><strong>Indications:</strong> ${escapeHtml(rightCardContent.indications)}</p>` 
          : ''}
        ${rightCardContent.contrastRationale ? 
          `<p class="contrast-rationale"><strong>Contrast Rationale:</strong> ${escapeHtml(rightCardContent.contrastRationale)}</p>` 
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

  // Generate unique ID for this accordion using more efficient method
  const accordionId = 'sequences-' + Date.now() + '-' + (Math.floor(Math.random() * 1000));

  return `
    <div class="sequences-card">
      <div class="sequences-header" onclick="toggleAccordion('${accordionId}')">
        <h4>Sequences</h4>
        <span class="accordion-toggle" id="toggle-${accordionId}">+</span>
      </div>
      <div class="sequences-content accordion-closed" id="${accordionId}" style="display: none;">
        <ul>
          ${sequences.map(seq => {
            const isHighlight = seq.highlight === true;
            const liClass = isHighlight ? 'class="highlight-sequence"' : '';
            return `<li ${liClass}>${escapeHtml(seq.sequence)}</li>`;
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
            <div class="protocol-title-section">
              <h3>Protocol: ${escapeHtml(protocol.study || 'Untitled Study')}</h3>
              <button class="favorite-btn" data-type="protocol" data-study="${escapeHtml(protocol.study)}" title="Add to favorites">
                <span class="material-symbols-outlined">favorite_border</span>
              </button>
            </div>
            <div class="protocol-info">
              <div class="contrast-indicator ${contrastClass}">
                <span class="contrast-icon material-symbols-outlined">
                  ${protocol.usesContrast ? 'science' : 'block'}
                </span>
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
            <div class="protocol-title-section">
              <h3>Protocol: ${cardTitle || mainProtocol.study}</h3>
              <button class="favorite-btn" data-type="protocol" data-study="${escapeHtml(mainProtocol.study)}" title="Add to favorites">
                <span class="material-symbols-outlined">favorite_border</span>
              </button>
            </div>
            <div class="protocol-info">
              <div class="contrast-indicator ${contrastClass}">
                <span class="contrast-icon material-symbols-outlined">
                  ${protocol.usesContrast ? 'science' : 'block'}
                </span>
                <span>Contrast: ${contrastText}</span>
              </div>
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

  // Add highly specific clinical indications based on exact study patterns
  let clinicalIndications = '';
  const studyUpper = order.study.toUpperCase();
  
  // Specific study-based indications with unique descriptions
  if (studyUpper.includes('CT ANGIO BRAIN') || studyUpper.includes('CTA BRAIN')) {
    clinicalIndications = '<div class="clinical-indication"><strong>Cerebral Vascular Assessment:</strong> Evaluates intracranial vessels for aneurysms, stenosis, arteriovenous malformations, and stroke evaluation</div>';
  } else if (studyUpper.includes('CT ANGIO NECK') || studyUpper.includes('CTA NECK')) {
    clinicalIndications = '<div class="clinical-indication"><strong>Carotid & Vertebral Assessment:</strong> Evaluates extracranial vessels for atherosclerotic disease, dissection, and TIA workup</div>';
  } else if (studyUpper.includes('CT ANGIO CHEST') || studyUpper.includes('CTA CHEST')) {
    clinicalIndications = '<div class="clinical-indication"><strong>Thoracic Vascular Imaging:</strong> Evaluates aortic dissection, aneurysm, pulmonary embolism, and thoracic outlet syndrome</div>';
  } else if (studyUpper.includes('CT ANGIO ABDOMEN') || studyUpper.includes('CTA ABDOMEN')) {
    clinicalIndications = '<div class="clinical-indication"><strong>Abdominal Vascular Analysis:</strong> Evaluates aortic aneurysm, mesenteric ischemia, renal artery stenosis, and visceral vessel pathology</div>';
  } else if (studyUpper.includes('CT ANGIO PULMONARY') || studyUpper.includes('CTPA')) {
    clinicalIndications = '<div class="clinical-indication"><strong>Pulmonary Embolism Detection:</strong> First-line imaging for suspected PE, evaluates pulmonary arteries and parenchymal disease</div>';
  } else if (studyUpper.includes('CT ANGIO CORONARY')) {
    clinicalIndications = '<div class="clinical-indication"><strong>Coronary Artery Disease Screening:</strong> Non-invasive evaluation of coronary stenosis, bypass graft patency, and cardiac anatomy</div>';
  } else if (studyUpper.includes('STONE PROTOCOL') || studyUpper.includes('CT STONE')) {
    clinicalIndications = '<div class="clinical-indication"><strong>Urolithiasis Detection:</strong> Non-contrast imaging optimized for kidney stones, ureteral calculi, and alternative diagnoses for flank pain</div>';
  } else if (studyUpper.includes('LOW DOSE LUNG') || studyUpper.includes('LDCT LUNG')) {
    clinicalIndications = '<div class="clinical-indication"><strong>Lung Cancer Screening:</strong> Low-dose CT for high-risk patients (30+ pack-year history, age 50-80) per USPSTF guidelines</div>';
  } else if (studyUpper.includes('CALCIUM SCORING') || studyUpper.includes('CAC SCORE')) {
    clinicalIndications = '<div class="clinical-indication"><strong>Coronary Risk Stratification:</strong> Quantifies coronary calcium burden for cardiovascular risk assessment and statin therapy guidance</div>';
  } else if (studyUpper.includes('ENTEROGRAPHY') && studyUpper.includes('CT')) {
    clinicalIndications = '<div class="clinical-indication"><strong>CT Enterography:</strong> Evaluates Crohn\'s disease activity, complications (strictures, fistulas), and small bowel pathology</div>';
  } else if (studyUpper.includes('ENTEROGRAPHY') && studyUpper.includes('MR')) {
    clinicalIndications = '<div class="clinical-indication"><strong>MR Enterography:</strong> Radiation-free assessment of IBD, superior soft tissue contrast for bowel wall evaluation and perianal disease</div>';
  } else if (studyUpper.includes('MRCP')) {
    clinicalIndications = '<div class="clinical-indication"><strong>Biliary Tree Visualization:</strong> Non-invasive ERCP alternative for choledocholithiasis, strictures, PSC, and pancreatic duct evaluation</div>';
  } else if (studyUpper.includes('MRI PROSTATE') || studyUpper.includes('PROSTATE MRI')) {
    clinicalIndications = '<div class="clinical-indication"><strong>Prostate Cancer Evaluation:</strong> PI-RADS assessment for cancer detection, staging, biopsy guidance, and active surveillance</div>';
  } else if (studyUpper.includes('DEXA') || studyUpper.includes('BONE DENSITY')) {
    clinicalIndications = '<div class="clinical-indication"><strong>Osteoporosis Assessment:</strong> T-score measurement for fracture risk, treatment monitoring, and WHO diagnostic criteria application</div>';
  } else if (studyUpper.includes('PET/CT') || studyUpper.includes('PET CT')) {
    clinicalIndications = '<div class="clinical-indication"><strong>Oncologic PET/CT:</strong> Cancer staging, restaging, treatment response assessment, and detection of residual/recurrent disease</div>';
  } else if (studyUpper.includes('CT BRAIN') && !studyUpper.includes('ANGIO')) {
    clinicalIndications = '<div class="clinical-indication"><strong>Acute Neurological Assessment:</strong> First-line imaging for stroke, trauma, headache, altered mental status, and intracranial pathology</div>';
  } else if (studyUpper.includes('MRI BRAIN') && !studyUpper.includes('ANGIO')) {
    clinicalIndications = '<div class="clinical-indication"><strong>Advanced Brain Imaging:</strong> Superior soft tissue contrast for tumor characterization, demyelinating disease, posterior fossa, and brainstem evaluation</div>';
  } else if (studyUpper.includes('CT SPINE CERVICAL') || studyUpper.includes('CT C-SPINE')) {
    clinicalIndications = '<div class="clinical-indication"><strong>Cervical Spine Trauma:</strong> Rapid assessment for fractures, dislocations, and spinal instability in trauma patients</div>';
  } else if (studyUpper.includes('MRI SPINE CERVICAL') || studyUpper.includes('MRI C-SPINE')) {
    clinicalIndications = '<div class="clinical-indication"><strong>Cervical Spine Pathology:</strong> Evaluates disc herniation, spinal stenosis, myelopathy, radiculopathy, and cord compression</div>';
  } else if (studyUpper.includes('CT CHEST') && !studyUpper.includes('ANGIO')) {
    clinicalIndications = '<div class="clinical-indication"><strong>Thoracic Pathology Assessment:</strong> Evaluates pulmonary nodules, infections, pleural disease, mediastinal masses, and interstitial lung disease</div>';
  } else if (studyUpper.includes('CT ABDOMEN') && studyUpper.includes('PELVIS')) {
    clinicalIndications = '<div class="clinical-indication"><strong>Abdominopelvic Evaluation:</strong> Comprehensive assessment for oncologic staging, infection, trauma, and organ-specific pathology</div>';
  } else if (studyUpper.includes('ULTRASOUND ABDOMEN') || studyUpper.includes('US ABDOMEN')) {
    clinicalIndications = '<div class="clinical-indication"><strong>Abdominal Ultrasound:</strong> First-line imaging for gallbladder disease, hepatic pathology, renal assessment, and abdominal pain evaluation</div>';
  } else if (studyUpper.includes('ULTRASOUND PELVIS') || studyUpper.includes('US PELVIS')) {
    clinicalIndications = '<div class="clinical-indication"><strong>Pelvic Ultrasound:</strong> Evaluates gynecologic pathology, pregnancy, ovarian cysts, uterine fibroids, and pelvic pain</div>';
  } else {
    // Fallback for unmatched studies
    clinicalIndications = '<div class="clinical-indication"><strong>Diagnostic Imaging:</strong> Specialized imaging study tailored to clinical presentation and suspected pathology</div>';
  }

  return `
    <div class="protocol-card order-card">
      <div class="protocol-header">
        <div class="protocol-title-section">
          <h3 class="protocol-title">${order.study}</h3>
          <button class="favorite-btn" data-type="order" data-study="${escapeHtml(order.study)}" title="Add to favorites">
            <span class="material-symbols-outlined">favorite_border</span>
          </button>
        </div>
        <div class="protocol-badges">
          ${modalityBadge}
          ${contrastIndicator}
          ${orderTypeBadge}
        </div>
      </div>
      <div class="order-details">
        ${clinicalIndications}
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

