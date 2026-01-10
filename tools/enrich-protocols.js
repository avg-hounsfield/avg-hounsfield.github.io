/**
 * Protocol Enrichment Script v2
 * Uses OpenRouter API + ACR source data to add detailed clinical information to MRI protocols
 *
 * Usage:
 *   Set OPENROUTER_API_KEY environment variable
 *   node enrich-protocols.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const MODEL = 'anthropic/claude-sonnet-4'; // Most accurate model
const TEST_MODE = false; // Set to false for full run
const TEST_LIMIT = 5; // Number of protocols to test
const PROTOCOLS_PATH = path.join(__dirname, '..', 'data', 'protocols.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', TEST_MODE ? 'protocols-enriched-test.json' : 'protocols-enriched.json');
const ACR_SCENARIOS_DIR = path.join(__dirname, '..', 'data', 'source', 'acr');
const BATCH_SIZE = 10; // Higher since no rate limits
const DELAY_MS = 500; // Small delay to be courteous

if (!OPENROUTER_API_KEY) {
  console.error('Error: OPENROUTER_API_KEY environment variable not set');
  console.error('Usage: set OPENROUTER_API_KEY=your_key && node enrich-protocols.js');
  process.exit(1);
}

// Load all ACR scenario data for cross-referencing
function loadACRData() {
  const acrData = {
    scenarios: [],
    byRegion: {}
  };

  const regionFiles = [
    'neuro-scenarios.json',
    'spine-scenarios.json',
    'msk-scenarios.json',
    'abdomen-scenarios.json',
    'chest-scenarios.json',
    'vascular-scenarios.json',
    'breast-scenarios.json',
    'peds-scenarios.json',
    'other-scenarios.json'
  ];

  for (const file of regionFiles) {
    const filePath = path.join(ACR_SCENARIOS_DIR, file);
    if (fs.existsSync(filePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        const region = file.replace('-scenarios.json', '');
        acrData.byRegion[region] = data;
        acrData.scenarios.push(...data);
        console.log(`  Loaded ${data.length} scenarios from ${file}`);
      } catch (e) {
        console.warn(`  Warning: Could not load ${file}: ${e.message}`);
      }
    }
  }

  return acrData;
}

// Find relevant ACR scenarios for a protocol
function findRelevantACRScenarios(protocol, acrData) {
  const relevant = [];
  const protocolRegion = (protocol.body_region || '').toLowerCase();
  const protocolKeywords = (protocol.keywords || []).map(k => k.toLowerCase());
  const protocolName = (protocol.name || '').toLowerCase();

  // First, check pre-matched scenarios from the protocol
  if (protocol.scenario_matches && protocol.scenario_matches.length > 0) {
    const topMatches = protocol.scenario_matches.slice(0, 5);
    for (const match of topMatches) {
      const scenario = acrData.scenarios.find(s =>
        String(s.acr_topic_id) === String(match.scenario_id)
      );
      if (scenario) {
        relevant.push({
          ...scenario,
          relevance_score: match.relevance_score
        });
      }
    }
  }

  // Also search by keywords if we don't have enough matches
  if (relevant.length < 3) {
    const regionScenarios = acrData.byRegion[protocolRegion] || [];
    for (const scenario of regionScenarios) {
      if (relevant.find(r => r.acr_topic_id === scenario.acr_topic_id)) continue;

      const scenarioName = (scenario.name || '').toLowerCase();
      const scenarioDesc = (scenario.description || '').toLowerCase();

      // Check for keyword matches
      const matchScore = protocolKeywords.filter(kw =>
        scenarioName.includes(kw) || scenarioDesc.includes(kw)
      ).length;

      if (matchScore > 0) {
        relevant.push({ ...scenario, relevance_score: matchScore * 10 });
      }

      if (relevant.length >= 5) break;
    }
  }

  return relevant.slice(0, 5);
}

// Extract key ACR recommendations from scenarios
function extractACRRecommendations(scenarios) {
  const recommendations = [];

  for (const scenario of scenarios) {
    if (!scenario.variants) continue;

    for (const variant of scenario.variants.slice(0, 2)) { // Top 2 variants
      const mriRatings = (variant.ratings || []).filter(r =>
        r.modality === 'MRI' && r.rating >= 7
      );

      if (mriRatings.length > 0) {
        recommendations.push({
          scenario: scenario.name,
          variant: variant.name,
          recommended_procedures: mriRatings.map(r => ({
            procedure: r.procedure_name,
            rating: r.rating,
            level: r.rating_level
          }))
        });
      }
    }
  }

  return recommendations;
}

async function callOpenRouter(prompt, systemPrompt) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://radex.app',
      'X-Title': 'Radex Protocol Enrichment'
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2, // Very low for factual accuracy
      max_tokens: 3000
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenRouter API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

function buildPrompt(protocol, acrScenarios, acrRecommendations) {
  const sequences = (protocol.sequences || [])
    .map((s, i) => `${i + 1}. ${s.sequence_name}${s.is_post_contrast ? ' (post-contrast)' : ''}`)
    .join('\n');

  // Build ACR context
  let acrContext = '';
  if (acrScenarios.length > 0) {
    acrContext = `
=== ACR APPROPRIATENESS CRITERIA CONTEXT ===
The following ACR scenarios are relevant to this protocol:

${acrScenarios.map(s => `
SCENARIO: ${s.name}
CLINICAL CONTEXT: ${(s.clinical_summary || s.description || '').substring(0, 500)}...
`).join('\n')}

${acrRecommendations.length > 0 ? `
ACR RECOMMENDATIONS FOR MRI:
${acrRecommendations.map(r => `
- ${r.scenario}
  ${r.recommended_procedures.map(p => `* ${p.procedure} (Rating: ${p.rating}/9 - ${p.level})`).join('\n  ')}
`).join('\n')}
` : ''}
=== END ACR CONTEXT ===
`;
  }

  return `
Analyze this MRI protocol and provide detailed clinical information.
Use the ACR Appropriateness Criteria context provided to ensure accuracy.

PROTOCOL: ${protocol.display_name || protocol.name}
BODY REGION: ${protocol.body_region || 'General'}
BODY PART: ${protocol.body_part || 'Not specified'}
USES CONTRAST: ${protocol.uses_contrast ? 'Yes' : 'No'}
CURRENT INDICATIONS: ${protocol.indications || 'Not specified'}

SEQUENCES:
${sequences || 'No sequences listed'}

${acrContext}

Provide the following information in valid JSON format. Base your responses on:
1. The ACR Appropriateness Criteria context provided above
2. Standard radiology practice guidelines
3. Your medical knowledge

For scan times, use these typical durations (1.5T/3T):
- Localizers: 0.5 min
- 2D T1/T2 axial/sagittal: 2-3 min
- 2D FLAIR: 3-4 min
- 3D volumetric (CUBE, SPACE, MPRAGE, BRAVO): 4-7 min
- DWI: 1.5-2 min
- SWI/SWAN: 3-4 min
- MRA/MRV: 3-5 min
- Post-contrast sequences: same as pre-contrast equivalents
- Dynamic contrast: 5-8 min

Return ONLY valid JSON (no markdown, no code blocks):

{
  "scan_time_minutes": <number>,
  "confidence": {
    "overall": "<high|medium|low>",
    "notes": "<any caveats about the enrichment accuracy>"
  },
  "patient_prep": {
    "npo_required": <boolean>,
    "npo_hours": <number or null>,
    "hydration_needed": <boolean>,
    "contrast_screening_required": <boolean>,
    "breath_hold_required": <boolean>,
    "claustrophobia_concern": "<none|mild|moderate|significant>",
    "estimated_table_time_minutes": <number - including positioning>,
    "special_instructions": [<string array>]
  },
  "contraindications": {
    "absolute": [<string array>],
    "relative": [<string array>],
    "gfr_cutoff": <number or null>,
    "pregnancy_considerations": "<string>"
  },
  "common_pitfalls": [<string array - artifacts, positioning issues, technical problems>],
  "sequence_rationale": [
    {
      "sequence": "<sequence name>",
      "purpose": "<why included>",
      "key_findings": "<what pathology it best shows>"
    }
  ],
  "clinical_pearls": [<string array - practical tips for residents, 3-5 pearls>],
  "when_to_upgrade": [<string array - when to add sequences or switch protocols>],
  "when_to_downgrade": [<string array - when a simpler protocol suffices>],
  "alternative_protocols": [
    {
      "protocol": "<protocol name>",
      "when_to_use": "<indication for alternative>"
    }
  ],
  "critical_sequences": [<string array - must-have sequences>],
  "optional_sequences": [<string array - can skip if time-limited>],
  "coil_selection": "<recommended coil>",
  "patient_positioning": {
    "position": "<supine|prone|lateral|etc>",
    "entry": "<head-first|feet-first>",
    "special_considerations": "<any positioning notes>"
  },
  "difficulty_rating": "<simple|routine|moderate|complex|specialized>",
  "red_flags": [<string array - findings requiring immediate notification>],
  "differential_considerations": [<string array - common differentials>],
  "acr_alignment": {
    "supported_indications": [<string array - indications supported by ACR criteria>],
    "rating_notes": "<any notes about ACR appropriateness ratings>"
  },
  "references": [<string array - relevant ACR topic IDs or guideline references>]
}`;
}

const SYSTEM_PROMPT = `You are an expert MRI radiologist and physicist providing accurate clinical information for a radiology education tool used by residents.

CRITICAL REQUIREMENTS:
1. Base responses on provided ACR Appropriateness Criteria when available
2. Be precise with scan times - calculate based on actual sequence types
3. Be conservative with clinical recommendations - when uncertain, indicate lower confidence
4. Focus on practical, actionable information for residents
5. Cite ACR guidelines when your recommendations align with them

Your responses will be used by radiology residents to:
- Understand why specific sequences are included
- Prepare patients appropriately
- Know what findings to look for
- Recognize when to modify protocols
- Identify critical findings requiring immediate action

Always respond with valid JSON only. No markdown, no code blocks, no explanations outside the JSON structure.`;

async function enrichProtocol(protocol, acrData) {
  const acrScenarios = findRelevantACRScenarios(protocol, acrData);
  const acrRecommendations = extractACRRecommendations(acrScenarios);
  const prompt = buildPrompt(protocol, acrScenarios, acrRecommendations);

  try {
    const response = await callOpenRouter(prompt, SYSTEM_PROMPT);

    // Parse the JSON response
    let enrichment;
    try {
      // Try to extract JSON if wrapped in code blocks
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        enrichment = JSON.parse(jsonMatch[0]);
      } else {
        enrichment = JSON.parse(response);
      }
    } catch (parseError) {
      console.error(`  Failed to parse response for ${protocol.name}:`, parseError.message);
      console.error('  Response preview:', response.substring(0, 300));
      return null;
    }

    // Add metadata about enrichment
    enrichment._enrichment_metadata = {
      model: MODEL,
      timestamp: new Date().toISOString(),
      acr_scenarios_used: acrScenarios.map(s => s.acr_topic_id),
      acr_scenarios_count: acrScenarios.length
    };

    return enrichment;
  } catch (error) {
    console.error(`  Error enriching ${protocol.name}:`, error.message);
    return null;
  }
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('=== Radex Protocol Enrichment v2 ===\n');

  // Load ACR data
  console.log('Loading ACR Appropriateness Criteria data...');
  const acrData = loadACRData();
  console.log(`Loaded ${acrData.scenarios.length} total ACR scenarios\n`);

  // Load protocols
  console.log('Loading protocols...');
  let protocols = JSON.parse(fs.readFileSync(PROTOCOLS_PATH, 'utf-8'));

  if (TEST_MODE) {
    console.log(`TEST MODE: Limiting to first ${TEST_LIMIT} protocols`);
    protocols = protocols.slice(0, TEST_LIMIT);
  }

  console.log(`Found ${protocols.length} protocols to enrich\n`);

  const enrichedProtocols = [];
  let successCount = 0;
  let failCount = 0;
  const startTime = Date.now();

  for (let i = 0; i < protocols.length; i += BATCH_SIZE) {
    const batch = protocols.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(protocols.length / BATCH_SIZE);

    console.log(`\n[Batch ${batchNum}/${totalBatches}]`);

    const batchPromises = batch.map(async (protocol) => {
      const name = protocol.display_name || protocol.name;
      process.stdout.write(`  Processing: ${name.substring(0, 40).padEnd(40)}... `);

      const enrichment = await enrichProtocol(protocol, acrData);

      if (enrichment) {
        successCount++;
        console.log(`OK (${enrichment.confidence?.overall || 'unknown'} confidence)`);
        return { ...protocol, enrichment };
      } else {
        failCount++;
        console.log('FAILED');
        return protocol;
      }
    });

    const results = await Promise.all(batchPromises);
    enrichedProtocols.push(...results);

    // Progress
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const rate = (enrichedProtocols.length / elapsed * 60).toFixed(1);
    console.log(`  Progress: ${enrichedProtocols.length}/${protocols.length} | ${elapsed}s elapsed | ~${rate}/min`);

    // Small delay between batches
    if (i + BATCH_SIZE < protocols.length) {
      await sleep(DELAY_MS);
    }
  }

  // Save enriched protocols
  console.log('\n\nSaving enriched protocols...');
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(enrichedProtocols, null, 2));
  console.log(`Saved to: ${OUTPUT_PATH}`);

  // Summary
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n=== Summary ===');
  console.log(`Total protocols: ${protocols.length}`);
  console.log(`Successfully enriched: ${successCount} (${(successCount/protocols.length*100).toFixed(1)}%)`);
  console.log(`Failed: ${failCount}`);
  console.log(`Total time: ${totalTime}s`);

  if (successCount > 0) {
    console.log('\n=== Next Steps ===');
    console.log('1. Review protocols-enriched.json for accuracy');
    console.log('2. Spot-check a few protocols manually');
    console.log('3. Copy to protocols.json: copy data\\protocols-enriched.json data\\protocols.json');
    console.log('4. Update the UI to display enrichment fields');
  }
}

main().catch(console.error);
