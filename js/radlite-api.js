/**
 * RadLITE API Module
 * Provides differential diagnosis information from coregrai.com
 */

export class RadLiteAPI {
  constructor() {
    this.baseUrl = 'https://coregrai.com';
    this.endpoint = '/api/v1/developer/rag/query';
    this.cache = new Map();
    this.cacheExpiry = 5 * 60 * 1000; // 5 minutes

    // Obfuscated key - split and encoded
    // To set your key: call RadLiteAPI.setKey('your_key') or set window._rlk
    this._kp = null;
  }

  clearCache() {
    this.cache.clear();
  }

  /**
   * Set API key (call this with your key)
   * For production, you may want to fetch this from a secure endpoint
   */
  static setKey(key) {
    if (window._radlite) {
      window._radlite._kp = RadLiteAPI._encode(key);
    }
  }

  static _encode(str) {
    // Simple obfuscation - not true security, just deters casual inspection
    return btoa(str.split('').reverse().join(''));
  }

  static _decode(str) {
    try {
      return atob(str).split('').reverse().join('');
    } catch {
      return null;
    }
  }

  _getKey() {
    // Check multiple sources for the key
    if (this._kp) return RadLiteAPI._decode(this._kp);
    if (window._rlk) return window._rlk;

    // Fallback: check for key in localStorage (user-provided)
    const stored = localStorage.getItem('radlite_key');
    if (stored) return stored;

    return null;
  }

  /**
   * Query for differential diagnosis or pathology description
   * @param {string} query - The medical term or symptoms
   * @returns {Promise<Object>} - { term, description, differentials, success }
   */
  async query(query) {
    if (!query || query.length < 3) {
      return { success: false, error: 'Query too short' };
    }

    // Check cache
    const cacheKey = query.toLowerCase().trim();
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
      return cached.data;
    }

    const apiKey = this._getKey();
    if (!apiKey) {
      // Fallback to basic pattern matching for common terms
      return this._getFallbackResponse(query);
    }

    try {
      const response = await fetch(`${this.baseUrl}${this.endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey
        },
        body: JSON.stringify({
          question: `Provide a brief 1-2 sentence description of "${query}" for radiology context. If this is vague symptoms, list the top 3 differential diagnoses.`,
          n_results: 3
        })
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();
      const result = this._parseResponse(query, data);

      // Cache the result
      this.cache.set(cacheKey, { data: result, timestamp: Date.now() });

      return result;
    } catch (error) {
      console.warn('RadLITE API error:', error.message);
      return this._getFallbackResponse(query);
    }
  }

  _parseResponse(query, data) {
    if (!data.success || !data.answer) {
      return this._getFallbackResponse(query);
    }

    const answer = data.answer;

    // Try to extract differentials if present
    const differentials = this._extractDifferentials(answer);

    // Get first 1-2 sentences as description
    const description = this._extractDescription(answer);

    return {
      success: true,
      term: this._formatTerm(query),
      description: description,
      differentials: differentials,
      hasMultiple: differentials.length > 1,
      sources: data.sources || []
    };
  }

  _extractDifferentials(text) {
    const differentials = [];

    // Look for numbered lists (1. item, 2. item)
    const numberedMatch = text.match(/\d+\.\s*\*?\*?([^:\n]+)/g);
    if (numberedMatch) {
      numberedMatch.slice(0, 3).forEach(match => {
        const cleaned = match.replace(/^\d+\.\s*\*?\*?/, '').replace(/\*?\*?$/, '').trim();
        if (cleaned.length > 2 && cleaned.length < 100) {
          differentials.push(cleaned);
        }
      });
    }

    // Look for bullet points
    if (differentials.length === 0) {
      const bulletMatch = text.match(/[-*]\s*\*?\*?([^:\n]+)/g);
      if (bulletMatch) {
        bulletMatch.slice(0, 3).forEach(match => {
          const cleaned = match.replace(/^[-*]\s*\*?\*?/, '').replace(/\*?\*?$/, '').trim();
          if (cleaned.length > 2 && cleaned.length < 100) {
            differentials.push(cleaned);
          }
        });
      }
    }

    return differentials;
  }

  _extractDescription(text) {
    // Remove markdown formatting
    let cleaned = text
      .replace(/#{1,6}\s*/g, '')
      .replace(/\*\*/g, '')
      .replace(/\*/g, '')
      .replace(/\n+/g, ' ')
      .trim();

    // Get first 2 sentences
    const sentences = cleaned.match(/[^.!?]+[.!?]+/g) || [cleaned];
    const description = sentences.slice(0, 2).join(' ').trim();

    // Limit length
    if (description.length > 250) {
      return description.substring(0, 247) + '...';
    }

    return description;
  }

  _formatTerm(query) {
    // Capitalize first letter of each word for display
    return query.split(/\s+/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  /**
   * Fallback responses for common radiology terms when API unavailable
   */
  _getFallbackResponse(query) {
    const q = query.toLowerCase();

    // Common pathology definitions
    const definitions = {
      'appendicitis': {
        term: 'Appendicitis',
        description: 'Inflammation of the appendix, typically presenting with RLQ pain and periumbilical migration. CT shows dilated appendix >6mm with periappendiceal fat stranding. US is first-line in pediatric patients.',
        differentials: []
      },
      'cholecystitis': {
        term: 'Cholecystitis',
        description: 'Inflammation of the gallbladder, usually from gallstone obstruction. US shows gallbladder wall thickening >3mm, pericholecystic fluid, and positive sonographic Murphy sign.',
        differentials: []
      },
      'diverticulitis': {
        term: 'Diverticulitis',
        description: 'Inflammation of colonic diverticula, most common in sigmoid colon. CT shows colonic wall thickening, pericolonic fat stranding, and diverticula.',
        differentials: []
      },
      'pancreatitis': {
        term: 'Pancreatitis',
        description: 'Inflammation of the pancreas, most commonly from gallstones or alcohol. CT shows pancreatic enlargement, peripancreatic fat stranding, and possible fluid collections.',
        differentials: []
      },
      'bowel obstruction': {
        term: 'Bowel Obstruction',
        description: 'Mechanical blockage of intestinal flow. CT shows dilated proximal bowel, transition point, and decompressed distal bowel. Small bowel >3cm or colon >6cm is abnormal.',
        differentials: []
      },
      'budd-chiari': {
        term: 'Budd-Chiari Syndrome',
        description: 'Hepatic venous outflow obstruction caused by thrombosis or occlusion of the hepatic veins or IVC. Presents with hepatomegaly, ascites, and abdominal pain.',
        differentials: []
      },
      'chiari': {
        term: 'Chiari Malformation',
        description: 'Structural defect where cerebellar tonsils herniate through the foramen magnum. Type I is most common, presenting with headaches and neck pain.',
        differentials: []
      },
      'pulmonary embolism': {
        term: 'Pulmonary Embolism',
        description: 'Obstruction of pulmonary arteries by blood clots, typically originating from deep vein thrombosis. CT pulmonary angiography is the imaging standard.',
        differentials: []
      },
      'stroke': {
        term: 'Acute Stroke',
        description: 'Sudden neurological deficit from cerebral ischemia or hemorrhage. CT/MRI brain with DWI essential for early detection and treatment planning.',
        differentials: []
      },
      'meniscus': {
        term: 'Meniscal Tear',
        description: 'Tear of the fibrocartilaginous meniscus in the knee. MRI shows high signal extending to articular surface. Medial meniscus more commonly torn than lateral.',
        differentials: []
      },
      'acl': {
        term: 'ACL Tear',
        description: 'Rupture of the anterior cruciate ligament, often from pivoting injury. MRI shows discontinuous ligament, bone contusions, and secondary signs.',
        differentials: []
      },
      'rotator cuff': {
        term: 'Rotator Cuff Tear',
        description: 'Tear of the supraspinatus, infraspinatus, subscapularis, or teres minor tendons. MRI or US shows tendon discontinuity, retraction, and fatty atrophy.',
        differentials: []
      }
    };

    // Check for known terms - prioritize exact/longer matches
    const matches = [];
    for (const [key, value] of Object.entries(definitions)) {
      if (q.includes(key)) {
        matches.push({ key, value, score: key.length });
      }
    }
    // Sort by key length (longer = more specific match)
    if (matches.length > 0) {
      matches.sort((a, b) => b.score - a.score);
      return { success: true, ...matches[0].value };
    }

    // Symptom-based differentials
    const symptomDifferentials = {
      'headache': {
        term: 'Headache',
        description: 'Common symptom with multiple etiologies. Imaging indicated for red flags: thunderclap onset, worst headache of life, focal neurological deficits.',
        differentials: ['Subarachnoid hemorrhage', 'Intracranial mass', 'Cerebral venous thrombosis']
      },
      'chest pain': {
        term: 'Chest Pain',
        description: 'Requires clinical correlation to determine imaging approach. Consider cardiac, pulmonary, and musculoskeletal etiologies.',
        differentials: ['Acute coronary syndrome', 'Pulmonary embolism', 'Aortic dissection']
      },
      'abdominal pain': {
        term: 'Abdominal Pain',
        description: 'Location and character guide imaging selection. CT abdomen/pelvis with contrast is often first-line for acute presentations.',
        differentials: ['Appendicitis', 'Cholecystitis', 'Small bowel obstruction']
      },
      'back pain': {
        term: 'Back Pain',
        description: 'Most cases mechanical and self-limiting. Red flags requiring imaging: trauma, cancer history, infection risk, progressive neurological deficit.',
        differentials: ['Disc herniation', 'Vertebral fracture', 'Epidural abscess']
      },
      'ruq pain': {
        term: 'Right Upper Quadrant Pain',
        description: 'Classic location for hepatobiliary pathology. Ultrasound is first-line imaging for evaluation of gallbladder and biliary tree.',
        differentials: ['Acute cholecystitis', 'Choledocholithiasis', 'Hepatic abscess']
      }
    };

    for (const [key, value] of Object.entries(symptomDifferentials)) {
      if (q.includes(key)) {
        return { success: true, ...value };
      }
    }

    // Default: no match
    return {
      success: false,
      term: this._formatTerm(query),
      description: '',
      differentials: [],
      error: 'No information available'
    };
  }

  /**
   * Clear the cache
   */
  clearCache() {
    this.cache.clear();
  }
}

// Create global instance
window._radlite = new RadLiteAPI();
