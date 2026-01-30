/**
 * Protocol Builder Module
 * Handles custom protocol creation, storage, and management
 * Version 2.0 - Grouped sequence types with plane selection
 */

export class ProtocolBuilder {
  constructor() {
    this.sequenceLibrary = null;
    this.customProtocols = this.loadCustomProtocols();
    this.currentProtocol = null;
    this.isEditing = false;
    this.selectedSequences = [];
    this.contrastMode = 'without'; // 'without', 'with', or 'both'
    this.scopeTags = []; // Scope/coverage tags for time estimation
    this.selectedRationale = null; // Currently expanded rationale
    this.expandedType = null; // Currently expanded sequence type

    // Comprehensive scope tags with time multipliers (relative to standard single joint FOV)
    this.scopeMultipliers = {
      // Neuro
      'brain': 1.0,
      'brain with neck': 1.4,
      'orbits': 0.7,
      'iacs': 0.8,
      'pituitary': 0.6,
      'sella': 0.6,
      'temporal lobes': 0.8,
      'posterior fossa': 0.8,
      'skull base': 0.9,
      'face': 0.9,
      'tmj': 0.7,
      'sinuses': 0.7,
      'nasopharynx': 0.8,
      'neck soft tissue': 1.0,
      'thyroid': 0.7,
      'salivary glands': 0.8,
      'parotid': 0.7,

      // Spine
      'whole spine': 1.8,
      'c-spine': 0.9,
      'cervical spine': 0.9,
      't-spine': 1.0,
      'thoracic spine': 1.0,
      'l-spine': 0.9,
      'lumbar spine': 0.9,
      's-spine': 0.7,
      'sacrum': 0.7,
      'coccyx': 0.6,
      'cervical and thoracic': 1.4,
      'thoracic and lumbar': 1.4,
      'lumbar and sacral': 1.2,
      'brachial plexus': 1.3,
      'lumbosacral plexus': 1.2,

      // Upper Extremity
      'shoulder': 0.9,
      'bilateral shoulders': 1.5,
      'rotator cuff': 0.9,
      'elbow': 0.7,
      'forearm': 0.8,
      'wrist': 0.6,
      'hand': 0.6,
      'fingers': 0.5,
      'thumb': 0.5,

      // Lower Extremity
      'hip': 1.0,
      'bilateral hips': 1.5,
      'pelvis': 1.1,
      'thigh': 1.0,
      'knee': 0.8,
      'bilateral knees': 1.4,
      'leg': 0.9,
      'calf': 0.8,
      'ankle': 0.7,
      'bilateral ankles': 1.2,
      'foot': 0.6,
      'toes': 0.5,
      'achilles': 0.6,

      // Abdomen/Pelvis
      'liver': 1.0,
      'hepatobiliary': 1.1,
      'mrcp': 1.0,
      'pancreas': 0.9,
      'spleen': 0.8,
      'kidneys': 1.0,
      'adrenals': 0.8,
      'upper abdomen': 1.2,
      'whole abdomen': 1.5,
      'abdomen and pelvis': 1.6,
      'enterography': 1.5,
      'rectum': 0.9,
      'prostate': 1.0,
      'bladder': 0.8,
      'uterus': 0.9,
      'ovaries': 0.9,
      'female pelvis': 1.1,
      'male pelvis': 1.1,
      'perineum': 0.8,
      'scrotum': 0.7,
      'penis': 0.6,

      // Chest
      'chest': 1.2,
      'lungs': 1.1,
      'mediastinum': 1.0,
      'heart': 1.0,
      'cardiac': 1.0,
      'breast': 0.9,
      'bilateral breasts': 1.3,
      'axilla': 0.8,

      // Vascular
      'circle of willis': 0.8,
      'carotids': 1.0,
      'neck vessels': 1.0,
      'aorta': 1.3,
      'runoff': 1.8,
      'upper extremity vessels': 1.2,
      'lower extremity vessels': 1.5,

      // Whole Body
      'whole body': 2.5,
      'screening': 2.0
    };

    // Protocol templates for common use cases
    this.templates = [
      {
        id: 'brain_routine',
        name: 'Brain Routine',
        description: 'Standard brain MRI without contrast',
        region: 'neuro',
        contrast_mode: 'without',
        scope_tags: ['brain'],
        sequences: [
          { type_id: 't1', plane: 'sagittal' },
          { type_id: 't2', plane: 'axial' },
          { type_id: 'flair', plane: 'axial' },
          { type_id: 'dwi', plane: 'axial' },
          { type_id: 't1', plane: 'axial' }
        ]
      },
      {
        id: 'brain_tumor',
        name: 'Brain Tumor',
        description: 'Pre/post contrast for tumor evaluation',
        region: 'neuro',
        contrast_mode: 'both',
        scope_tags: ['brain'],
        sequences: [
          { type_id: 't1', plane: 'sagittal' },
          { type_id: 't2', plane: 'axial' },
          { type_id: 'flair', plane: 'axial' },
          { type_id: 'dwi', plane: 'axial' },
          { type_id: 'swi', plane: 'axial' },
          { type_id: 't1', plane: 'axial' },
          { type_id: 't1_post', plane: 'axial' },
          { type_id: 't1_post', plane: 'sagittal' },
          { type_id: 't1_post', plane: 'coronal' }
        ]
      },
      {
        id: 'brain_ms',
        name: 'MS Protocol',
        description: 'Multiple sclerosis evaluation',
        region: 'neuro',
        contrast_mode: 'both',
        scope_tags: ['brain'],
        sequences: [
          { type_id: 't1', plane: 'sagittal' },
          { type_id: 't2', plane: 'axial' },
          { type_id: 'flair', plane: 'axial' },
          { type_id: 'flair', plane: 'sagittal' },
          { type_id: 'dwi', plane: 'axial' },
          { type_id: 't1', plane: 'axial' },
          { type_id: 't1_post', plane: 'axial' },
          { type_id: 'flair', plane: 'coronal' }
        ]
      },
      {
        id: 'brain_stroke',
        name: 'Stroke Protocol',
        description: 'Acute stroke evaluation with MRA',
        region: 'neuro',
        contrast_mode: 'without',
        scope_tags: ['brain'],
        sequences: [
          { type_id: 'dwi', plane: 'axial' },
          { type_id: 'flair', plane: 'axial' },
          { type_id: 't2', plane: 'axial' },
          { type_id: 'swi', plane: 'axial' },
          { type_id: 'mra_tof', plane: '3d' }
        ]
      },
      {
        id: 'c_spine',
        name: 'C-Spine',
        description: 'Cervical spine without contrast',
        region: 'spine',
        contrast_mode: 'without',
        scope_tags: ['c-spine'],
        sequences: [
          { type_id: 't1', plane: 'sagittal' },
          { type_id: 't2', plane: 'sagittal' },
          { type_id: 'stir', plane: 'sagittal' },
          { type_id: 't2', plane: 'axial' }
        ]
      },
      {
        id: 'l_spine',
        name: 'L-Spine',
        description: 'Lumbar spine without contrast',
        region: 'spine',
        contrast_mode: 'without',
        scope_tags: ['l-spine'],
        sequences: [
          { type_id: 't1', plane: 'sagittal' },
          { type_id: 't2', plane: 'sagittal' },
          { type_id: 'stir', plane: 'sagittal' },
          { type_id: 't2', plane: 'axial' }
        ]
      },
      {
        id: 'knee',
        name: 'Knee',
        description: 'Standard knee MRI',
        region: 'msk',
        contrast_mode: 'without',
        scope_tags: ['knee'],
        sequences: [
          { type_id: 'pd_fs', plane: 'sagittal' },
          { type_id: 'pd_fs', plane: 'coronal' },
          { type_id: 'pd_fs', plane: 'axial' },
          { type_id: 't1', plane: 'coronal' }
        ]
      },
      {
        id: 'shoulder',
        name: 'Shoulder',
        description: 'Standard shoulder MRI',
        region: 'msk',
        contrast_mode: 'without',
        scope_tags: ['shoulder'],
        sequences: [
          { type_id: 't1', plane: 'coronal' },
          { type_id: 'pd_fs', plane: 'coronal' },
          { type_id: 'pd_fs', plane: 'sagittal' },
          { type_id: 'pd_fs', plane: 'axial' }
        ]
      },
      {
        id: 'liver',
        name: 'Liver',
        description: 'Multiphasic liver MRI',
        region: 'abdomen',
        contrast_mode: 'both',
        scope_tags: ['liver'],
        sequences: [
          { type_id: 't2_fs', plane: 'axial' },
          { type_id: 't2_haste', plane: 'coronal' },
          { type_id: 't1', plane: 'axial' },
          { type_id: 'dwi', plane: 'axial' },
          { type_id: 'dynamic', plane: 'axial' }
        ]
      },
      {
        id: 'mrcp',
        name: 'MRCP',
        description: 'Biliary/pancreatic duct imaging',
        region: 'abdomen',
        contrast_mode: 'without',
        scope_tags: ['mrcp'],
        sequences: [
          { type_id: 't2_haste', plane: 'axial' },
          { type_id: 't2_haste', plane: 'coronal' },
          { type_id: 'mrcp', plane: '3d' },
          { type_id: 't1', plane: 'axial' }
        ]
      }
    ];

    // All available scope tags for auto-suggest (display names)
    this.allScopeTags = [
      // Neuro
      'Brain', 'Brain with Neck', 'Orbits', 'IACs', 'Pituitary', 'Sella',
      'Temporal Lobes', 'Posterior Fossa', 'Skull Base', 'Face', 'TMJ',
      'Sinuses', 'Nasopharynx', 'Neck Soft Tissue', 'Thyroid', 'Salivary Glands', 'Parotid',

      // Spine
      'Whole Spine', 'C-Spine', 'Cervical Spine', 'T-Spine', 'Thoracic Spine',
      'L-Spine', 'Lumbar Spine', 'S-Spine', 'Sacrum', 'Coccyx',
      'Cervical and Thoracic', 'Thoracic and Lumbar', 'Lumbar and Sacral',
      'Brachial Plexus', 'Lumbosacral Plexus',

      // Upper Extremity
      'Shoulder', 'Bilateral Shoulders', 'Rotator Cuff', 'Elbow', 'Forearm',
      'Wrist', 'Hand', 'Fingers', 'Thumb',

      // Lower Extremity
      'Hip', 'Bilateral Hips', 'Pelvis', 'Thigh', 'Knee', 'Bilateral Knees',
      'Leg', 'Calf', 'Ankle', 'Bilateral Ankles', 'Foot', 'Toes', 'Achilles',

      // Abdomen/Pelvis
      'Liver', 'Hepatobiliary', 'MRCP', 'Pancreas', 'Spleen', 'Kidneys', 'Adrenals',
      'Upper Abdomen', 'Whole Abdomen', 'Abdomen and Pelvis', 'Enterography',
      'Rectum', 'Prostate', 'Bladder', 'Uterus', 'Ovaries',
      'Female Pelvis', 'Male Pelvis', 'Perineum', 'Scrotum', 'Penis',

      // Chest
      'Chest', 'Lungs', 'Mediastinum', 'Heart', 'Cardiac',
      'Breast', 'Bilateral Breasts', 'Axilla',

      // Vascular
      'Circle of Willis', 'Carotids', 'Neck Vessels', 'Aorta', 'Runoff',
      'Upper Extremity Vessels', 'Lower Extremity Vessels',

      // Whole Body
      'Whole Body', 'Screening'
    ];
  }

  // Get all available scope tags for auto-suggest
  getAllScopeTags() {
    return this.allScopeTags;
  }

  // Get all protocol templates
  getTemplates() {
    return this.templates;
  }

  // Get template by ID
  getTemplateById(templateId) {
    return this.templates.find(t => t.id === templateId);
  }

  // Create new protocol from template
  createFromTemplate(templateId) {
    const template = this.getTemplateById(templateId);
    if (!template) return null;

    this.createNewProtocol();

    // Set template values
    this.currentProtocol.name = template.name;
    this.currentProtocol.display_name = template.name;
    this.currentProtocol.body_region = template.region;
    this.currentProtocol.contrast_mode = template.contrast_mode;
    this.contrastMode = template.contrast_mode;
    this.scopeTags = [...(template.scope_tags || [])];

    // Add sequences from template
    for (const seq of template.sequences) {
      this.addSequenceByType(seq.type_id, seq.plane);
    }

    return this.currentProtocol;
  }

  // Add a scope tag (normalizes to lowercase)
  addScopeTag(tag) {
    const normalized = tag.toLowerCase().trim();
    if (normalized && !this.scopeTags.includes(normalized)) {
      this.scopeTags.push(normalized);
      return true;
    }
    return false;
  }

  // Load custom protocols from localStorage
  loadCustomProtocols() {
    try {
      const data = JSON.parse(localStorage.getItem('radex_custom_protocols') || '{}');
      return data.protocols || [];
    } catch {
      return [];
    }
  }

  // Save custom protocols to localStorage
  saveCustomProtocols() {
    const data = {
      version: '1.0.0',
      protocols: this.customProtocols
    };
    localStorage.setItem('radex_custom_protocols', JSON.stringify(data));
  }

  // Load sequence library from JSON file
  async loadSequenceLibrary() {
    if (this.sequenceLibrary) return this.sequenceLibrary;

    try {
      const response = await fetch('data/sequence-library.json?v=20260129e');
      this.sequenceLibrary = await response.json();
      return this.sequenceLibrary;
    } catch (error) {
      console.error('Failed to load sequence library:', error);
      return null;
    }
  }

  // Get all sequence types
  getSequenceTypes() {
    if (!this.sequenceLibrary) return [];
    return this.sequenceLibrary.sequence_types || [];
  }

  // Get sequence type by ID
  getSequenceTypeById(typeId) {
    if (!this.sequenceLibrary) return null;
    return this.sequenceLibrary.sequence_types.find(t => t.id === typeId);
  }

  // Get plane label
  getPlaneLabel(plane) {
    if (!this.sequenceLibrary || !this.sequenceLibrary.plane_labels) {
      const labels = { axial: 'Axial', sagittal: 'Sagittal', coronal: 'Coronal', '3d': '3D', '2d': '2D' };
      return labels[plane] || plane;
    }
    return this.sequenceLibrary.plane_labels[plane] || plane;
  }

  // Generate sequence name from type and plane
  generateSequenceName(seqType, plane) {
    const planeAbbrev = {
      axial: 'AX',
      sagittal: 'SAG',
      coronal: 'COR',
      '3d': '3D',
      '2d': '2D'
    };
    const abbrev = planeAbbrev[plane] || plane.toUpperCase();
    return `${abbrev} ${seqType.name}`;
  }

  // Generate sequence ID from type and plane
  generateSequenceId(typeId, plane) {
    return `${typeId}_${plane}`;
  }

  // Create new protocol
  createNewProtocol() {
    this.currentProtocol = {
      id: `custom_${Date.now()}`,
      name: '',
      display_name: '',
      body_region: '',
      contrast_mode: 'without',
      scope_tags: [],
      is_custom: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      notes: '',
      indications: '',
      sequences: [],
      total_time_seconds: 0
    };
    this.selectedSequences = [];
    this.contrastMode = 'without';
    this.scopeTags = [];
    this.isEditing = true;
    this.selectedRationale = null;
    this.expandedType = null;
    return this.currentProtocol;
  }

  // Edit existing protocol
  editProtocol(protocolId) {
    const protocol = this.customProtocols.find(p => p.id === protocolId);
    if (!protocol) return null;

    this.currentProtocol = JSON.parse(JSON.stringify(protocol)); // Deep copy
    this.selectedSequences = [...(protocol.sequences || [])];
    this.contrastMode = protocol.contrast_mode || (protocol.uses_contrast ? 'with' : 'without');
    this.scopeTags = [...(protocol.scope_tags || [])];
    this.isEditing = true;
    this.selectedRationale = null;
    this.expandedType = null;
    return this.currentProtocol;
  }

  // Add sequence with type and plane
  addSequenceByType(typeId, plane) {
    const seqType = this.getSequenceTypeById(typeId);
    if (!seqType) return null;

    const sequenceId = this.generateSequenceId(typeId, plane);

    // Check if already added
    if (this.selectedSequences.some(s => s.sequence_id === sequenceId)) {
      return null;
    }

    const newSequence = {
      sequence_id: sequenceId,
      type_id: typeId,
      plane: plane,
      sequence_name: this.generateSequenceName(seqType, plane),
      full_name: `${this.getPlaneLabel(plane)} ${seqType.display_name}`,
      is_post_contrast: seqType.is_post_contrast || false,
      sort_order: this.selectedSequences.length,
      time_seconds: seqType.time_seconds,
      weighting: seqType.name
    };

    this.selectedSequences.push(newSequence);
    this.reorderSequences();
    return newSequence;
  }

  // Check if a specific type+plane combination is added
  isSequenceAdded(typeId, plane) {
    const sequenceId = this.generateSequenceId(typeId, plane);
    return this.selectedSequences.some(s => s.sequence_id === sequenceId);
  }

  // Remove sequence from current protocol
  removeSequence(index) {
    if (index >= 0 && index < this.selectedSequences.length) {
      this.selectedSequences.splice(index, 1);
      this.reorderSequences();
    }
  }

  // Move sequence (drag and drop reorder)
  moveSequence(oldIndex, newIndex) {
    if (oldIndex < 0 || oldIndex >= this.selectedSequences.length) return;
    if (newIndex < 0 || newIndex >= this.selectedSequences.length) return;

    const item = this.selectedSequences.splice(oldIndex, 1)[0];
    this.selectedSequences.splice(newIndex, 0, item);
    this.reorderSequences();
  }

  // Update sort_order values after reordering
  reorderSequences() {
    this.selectedSequences.forEach((seq, i) => {
      seq.sort_order = i;
    });
  }

  // Toggle contrast flag for a sequence
  toggleSequenceContrast(index) {
    if (index >= 0 && index < this.selectedSequences.length) {
      this.selectedSequences[index].is_post_contrast = !this.selectedSequences[index].is_post_contrast;
    }
  }

  // Get time multiplier based on scope tags
  getScopeMultiplier() {
    if (this.scopeTags.length === 0) return 1.0;

    // Find the maximum multiplier from all tags (coverage determines time)
    let maxMultiplier = 1.0;
    for (const tag of this.scopeTags) {
      const multiplier = this.scopeMultipliers[tag.toLowerCase()] || 1.0;
      if (multiplier > maxMultiplier) {
        maxMultiplier = multiplier;
      }
    }
    return maxMultiplier;
  }

  // Calculate total scan time (with scope adjustment)
  calculateTotalTime() {
    const baseTime = this.selectedSequences.reduce((total, seq) => {
      return total + (seq.time_seconds || 0);
    }, 0);

    // Apply scope multiplier for more accurate estimation
    const multiplier = this.getScopeMultiplier();
    return Math.round(baseTime * multiplier);
  }

  // Format seconds to human readable time
  formatTime(seconds) {
    if (seconds === 0) return '0 min';
    const mins = Math.round(seconds / 60);
    if (mins < 1) return '<1 min';
    return `${mins} min`;
  }

  // Format time range
  formatTimeRange(timeRange) {
    if (!timeRange || timeRange.length !== 2) return '';
    const min = Math.round(timeRange[0] / 60);
    const max = Math.round(timeRange[1] / 60);
    return `${min}-${max} min`;
  }

  // Validate protocol before saving
  validateProtocol(formData) {
    const errors = [];

    if (!formData.name || formData.name.trim().length === 0) {
      errors.push('Protocol name is required');
    }

    if (!formData.region) {
      errors.push('Body region is required');
    }

    if (this.selectedSequences.length === 0) {
      errors.push('At least one sequence is required');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  // Save current protocol
  saveProtocol(formData) {
    const validation = this.validateProtocol(formData);
    if (!validation.valid) {
      return { success: false, errors: validation.errors };
    }

    this.currentProtocol.name = formData.name.trim();
    this.currentProtocol.display_name = formData.name.trim();
    this.currentProtocol.body_region = formData.region;
    this.currentProtocol.contrast_mode = formData.contrastMode || 'without';
    this.currentProtocol.scope_tags = formData.scopeTags || [];
    this.currentProtocol.indications = formData.indications || '';
    this.currentProtocol.notes = formData.notes || '';
    this.currentProtocol.sequences = JSON.parse(JSON.stringify(this.selectedSequences));
    this.currentProtocol.updated_at = new Date().toISOString();
    this.currentProtocol.total_time_seconds = this.calculateTotalTime();
    // Legacy compatibility
    this.currentProtocol.uses_contrast = formData.contrastMode === 'with' || formData.contrastMode === 'both';

    // Update or add to collection
    const existingIndex = this.customProtocols.findIndex(p => p.id === this.currentProtocol.id);
    if (existingIndex >= 0) {
      this.customProtocols[existingIndex] = this.currentProtocol;
    } else {
      this.customProtocols.push(this.currentProtocol);
    }

    this.saveCustomProtocols();
    this.isEditing = false;

    return { success: true, protocol: this.currentProtocol };
  }

  // Delete protocol
  deleteProtocol(protocolId) {
    const index = this.customProtocols.findIndex(p => p.id === protocolId);
    if (index >= 0) {
      this.customProtocols.splice(index, 1);
      this.saveCustomProtocols();
      return true;
    }
    return false;
  }

  // Duplicate protocol
  duplicateProtocol(protocolId) {
    const protocol = this.customProtocols.find(p => p.id === protocolId);
    if (!protocol) return null;

    const newProtocol = {
      ...JSON.parse(JSON.stringify(protocol)),
      id: `custom_${Date.now()}`,
      name: `${protocol.name} (Copy)`,
      display_name: `${protocol.name} (Copy)`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    this.customProtocols.push(newProtocol);
    this.saveCustomProtocols();

    return newProtocol;
  }

  // Export protocol as JSON string
  exportProtocol(protocolId) {
    const protocol = this.customProtocols.find(p => p.id === protocolId);
    if (!protocol) return null;

    const exportData = {
      version: '1.0.0',
      exported_at: new Date().toISOString(),
      source: 'Radex Protocol Builder',
      protocol: protocol
    };

    return JSON.stringify(exportData, null, 2);
  }

  // Export all protocols
  exportAllProtocols() {
    const exportData = {
      version: '1.0.0',
      exported_at: new Date().toISOString(),
      source: 'Radex Protocol Builder',
      protocols: this.customProtocols
    };

    return JSON.stringify(exportData, null, 2);
  }

  // Import protocol from JSON string
  importProtocol(jsonString) {
    try {
      const data = JSON.parse(jsonString);

      // Handle single protocol import
      if (data.protocol) {
        const protocol = this.importSingleProtocol(data.protocol);
        return { success: true, imported: 1, protocols: [protocol] };
      }

      // Handle multiple protocols import
      if (data.protocols && Array.isArray(data.protocols)) {
        const imported = [];
        for (const proto of data.protocols) {
          const protocol = this.importSingleProtocol(proto);
          if (protocol) imported.push(protocol);
        }
        return { success: true, imported: imported.length, protocols: imported };
      }

      return { success: false, error: 'Invalid protocol format' };
    } catch (error) {
      console.error('Failed to import protocol:', error);
      return { success: false, error: 'Failed to parse JSON' };
    }
  }

  // Import a single protocol object
  importSingleProtocol(protoData) {
    if (!protoData || !protoData.name) return null;

    const protocol = {
      id: `custom_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: protoData.name,
      display_name: protoData.display_name || protoData.name,
      body_region: protoData.body_region || '',
      uses_contrast: protoData.uses_contrast || false,
      is_custom: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      notes: protoData.notes || '',
      indications: protoData.indications || '',
      sequences: protoData.sequences || [],
      total_time_seconds: protoData.total_time_seconds || 0
    };

    this.customProtocols.push(protocol);
    this.saveCustomProtocols();

    return protocol;
  }

  // Search/filter sequence types
  searchSequenceTypes(query, filters = {}) {
    if (!this.sequenceLibrary) return [];

    let results = [...(this.sequenceLibrary.sequence_types || [])];

    // Apply text search
    if (query && query.trim().length > 0) {
      const q = query.toLowerCase().trim();
      results = results.filter(seqType => {
        return seqType.name.toLowerCase().includes(q) ||
               seqType.display_name.toLowerCase().includes(q) ||
               (seqType.rationale && seqType.rationale.purpose.toLowerCase().includes(q));
      });
    }

    // Apply weighting/type filter (T1, T2, DWI, contrast)
    if (filters.category && filters.category !== 'all') {
      const filterLower = filters.category.toLowerCase();
      if (filterLower === 'contrast' || filterLower === '+c') {
        results = results.filter(seqType => seqType.is_post_contrast);
      } else if (filterLower === 't1') {
        results = results.filter(seqType =>
          seqType.name.toLowerCase().startsWith('t1') ||
          seqType.name.toLowerCase().includes('mprage')
        );
      } else if (filterLower === 't2') {
        results = results.filter(seqType =>
          (seqType.name.toLowerCase().startsWith('t2') ||
           seqType.name.toLowerCase() === 'flair' ||
           seqType.name.toLowerCase() === 'stir' ||
           seqType.name.toLowerCase().includes('haste')) &&
          !seqType.is_post_contrast
        );
      } else if (filterLower === 'dwi') {
        results = results.filter(seqType =>
          seqType.name.toLowerCase() === 'dwi' ||
          seqType.name.toLowerCase() === 'swi'
        );
      } else {
        // Generic category filter
        results = results.filter(seqType => seqType.category === filters.category);
      }
    }

    // Filter based on contrast mode - hide post-contrast when "without" is selected
    if (filters.contrastMode === 'without') {
      results = results.filter(seqType => !seqType.is_post_contrast);
    }

    // Apply region filter
    if (filters.region && filters.region !== 'all') {
      results = results.filter(seqType =>
        seqType.regions && seqType.regions.includes(filters.region)
      );
    }

    return results;
  }

  // Get all custom protocols sorted by last updated
  getAllCustomProtocols() {
    return [...this.customProtocols].sort((a, b) =>
      new Date(b.updated_at) - new Date(a.updated_at)
    );
  }

  // Get protocol by ID
  getProtocolById(protocolId) {
    return this.customProtocols.find(p => p.id === protocolId);
  }

  // Cancel editing
  cancelEdit() {
    this.currentProtocol = null;
    this.selectedSequences = [];
    this.isEditing = false;
    this.selectedRationale = null;
    this.expandedType = null;
  }

  // Toggle expanded sequence type
  toggleExpandedType(typeId) {
    if (this.expandedType === typeId) {
      this.expandedType = null;
    } else {
      this.expandedType = typeId;
    }
    return this.expandedType;
  }

  // Set selected rationale for display
  setSelectedRationale(typeId) {
    if (this.selectedRationale === typeId) {
      this.selectedRationale = null; // Toggle off
    } else {
      this.selectedRationale = typeId;
    }
    return this.selectedRationale;
  }

  // Get rationale for a sequence type
  getRationale(typeId) {
    const seqType = this.getSequenceTypeById(typeId);
    return seqType ? seqType.rationale : null;
  }

  // Get pre-contrast sequences
  getPreContrastSequences() {
    return this.selectedSequences.filter(s => !s.is_post_contrast);
  }

  // Get post-contrast sequences
  getPostContrastSequences() {
    return this.selectedSequences.filter(s => s.is_post_contrast);
  }

  // Check if protocol uses contrast (has post-contrast sequences)
  hasPostContrastSequences() {
    return this.selectedSequences.some(s => s.is_post_contrast);
  }

  // Get statistics about the protocol
  getProtocolStats() {
    const preContrast = this.getPreContrastSequences();
    const postContrast = this.getPostContrastSequences();

    const preTime = preContrast.reduce((t, s) => t + (s.time_seconds || 0), 0);
    const postTime = postContrast.reduce((t, s) => t + (s.time_seconds || 0), 0);

    return {
      totalSequences: this.selectedSequences.length,
      preContrastCount: preContrast.length,
      postContrastCount: postContrast.length,
      preContrastTime: preTime,
      postContrastTime: postTime,
      totalTime: preTime + postTime
    };
  }
}
