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

    // Scope tag time multipliers (relative to standard brain FOV)
    this.scopeMultipliers = {
      'brain': 1.0,
      'orbits': 0.7,
      'iacs': 0.8,
      'pituitary': 0.7,
      'whole spine': 1.8,
      'c-spine': 0.9,
      't-spine': 1.0,
      'l-spine': 0.9,
      'knee': 0.8,
      'shoulder': 0.9,
      'hip': 1.0,
      'ankle': 0.7,
      'wrist': 0.6,
      'hand': 0.6,
      'foot': 0.6,
      'elbow': 0.7,
      'upper abdomen': 1.2,
      'liver': 1.1,
      'pelvis': 1.1,
      'prostate': 1.0,
      'brachial plexus': 1.3,
      'whole abdomen': 1.5,
      'chest': 1.2,
      'bilateral hips': 1.4,
      'bilateral knees': 1.6
    };
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
      const response = await fetch('data/sequence-library.json?v=20260129c');
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

    // Apply category filter
    if (filters.category && filters.category !== 'all') {
      if (filters.category === 'contrast') {
        results = results.filter(seqType => seqType.is_post_contrast);
      } else {
        results = results.filter(seqType => seqType.category === filters.category);
      }
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
