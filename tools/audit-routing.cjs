const fs = require('fs');

// Load protocols
const protocols = JSON.parse(fs.readFileSync('data/protocols.json', 'utf8'));

// Simulate the clinical rules routing (final version)
function applyClinicalRules(scenarioName, procedureName, region) {
  const procLower = procedureName.toLowerCase();
  const scenarioLower = scenarioName.toLowerCase();

  const isProcedureFor = (bodyPart) => procLower.includes(bodyPart);

  // Area of interest - context based routing
  if (isProcedureFor('area of interest') || isProcedureFor('extremity area of interest')) {
    if (scenarioLower.includes('head') || scenarioLower.includes('brain') ||
        scenarioLower.includes('cranial') || scenarioLower.includes('intracranial')) return 'BRAIN';
    if (scenarioLower.includes('face') || scenarioLower.includes('facial') ||
        scenarioLower.includes('maxillofacial') || scenarioLower.includes('mandib') ||
        scenarioLower.includes('orbit') || scenarioLower.includes('sinus')) return 'MAXILLOFACIAL';
    if (scenarioLower.includes('neck') || scenarioLower.includes('thyroid') ||
        scenarioLower.includes('laryn') || scenarioLower.includes('pharyn')) return 'NECK SOFT TISSUE';
    if (scenarioLower.includes('spine') || scenarioLower.includes('vertebr') ||
        scenarioLower.includes('disc') || scenarioLower.includes('spinal')) return 'L-SPINE';
    if (scenarioLower.includes('chest') || scenarioLower.includes('thorax') ||
        scenarioLower.includes('lung') || scenarioLower.includes('mediast')) return 'CHEST';
    if (scenarioLower.includes('abdomen') || scenarioLower.includes('liver') ||
        scenarioLower.includes('kidney') || scenarioLower.includes('pancrea') ||
        scenarioLower.includes('spleen') || scenarioLower.includes('bowel')) return 'LIVER';
    if (scenarioLower.includes('pelvis') || scenarioLower.includes('pelvic') ||
        scenarioLower.includes('bladder') || scenarioLower.includes('rectum') ||
        scenarioLower.includes('uterus') || scenarioLower.includes('ovary') ||
        scenarioLower.includes('prostate')) return 'PELVIS';
    if (scenarioLower.includes('shoulder')) return 'SHOULDER';
    if (scenarioLower.includes('elbow')) return 'ELBOW';
    if (scenarioLower.includes('wrist') || scenarioLower.includes('hand') || scenarioLower.includes('carpal')) return 'WRIST';
    if (scenarioLower.includes('hip')) return 'HIP';
    if (scenarioLower.includes('knee')) return 'KNEE';
    if (scenarioLower.includes('ankle') || scenarioLower.includes('foot') || scenarioLower.includes('tarsal')) return 'ANKLE';
    if (scenarioLower.includes('vascular malformation') || scenarioLower.includes('hemangioma')) return 'BRAIN';

    // Bone-specific scenarios (fracture, lesion, tumor) -> BONE TUMOR protocol
    // Joint protocols are for cartilage/ligaments, not bone pathology
    const isBoneScenario = scenarioLower.includes('humerus') || scenarioLower.includes('femur') ||
                           scenarioLower.includes('tibia') || scenarioLower.includes('fibula') ||
                           scenarioLower.includes('radius') || scenarioLower.includes('ulna') ||
                           scenarioLower.includes('metatarsal') || scenarioLower.includes('calcaneus') ||
                           scenarioLower.includes('rib') || scenarioLower.includes('costal') ||
                           scenarioLower.includes('stress fracture') || scenarioLower.includes('bone tumor') ||
                           scenarioLower.includes('bone lesion');
    if (isBoneScenario) {
      if (scenarioLower.includes('infection') || scenarioLower.includes('osteomyelitis')) return 'OSTEOMYELITIS';
      return 'BONE TUMOR';
    }

    // Vascular murmur
    if (scenarioLower.includes('vascular murmur') || scenarioLower.includes('bruit')) {
      if (scenarioLower.includes('forearm')) return 'ELBOW';
    }
  }

  // MR enteroclysis
  if (isProcedureFor('enteroclysis')) return 'MR ENTEROGRAPHY';

  // Sacroiliac joints
  if (isProcedureFor('sacroiliac')) return 'SI JOINTS';

  // Whole body
  if (isProcedureFor('whole body')) return 'WHOLE BODY';

  // Maxillofacial
  if (isProcedureFor('maxillofacial') || isProcedureFor('facial')) return 'MAXILLOFACIAL';

  // Sinuses
  if (isProcedureFor('sinus') || isProcedureFor('paranasal')) return 'SINUSES';

  // Sacrum
  if (isProcedureFor('sacrum') && !isProcedureFor('sacroiliac')) {
    if (scenarioLower.includes('infection') || scenarioLower.includes('abscess') || scenarioLower.includes('decubitus')) return 'SPINE INFECTION';
    return 'L-SPINE';
  }

  // Abdomen/Pelvis procedures
  if (isProcedureFor('prostate')) return 'PROSTATE';
  if (isProcedureFor('liver')) return 'LIVER';
  if (isProcedureFor('kidney') || isProcedureFor('renal')) return 'KIDNEYS';
  if (isProcedureFor('mrcp') || isProcedureFor('cholangiopancreatography')) return 'MRCP';
  if (isProcedureFor('enterography')) return 'MR ENTEROGRAPHY';
  if (isProcedureFor('pelvis') && !isProcedureFor('spine')) return 'PELVIS';
  if (isProcedureFor('abdomen') && !isProcedureFor('pelvis')) return 'LIVER';

  // Neuro procedures
  if ((isProcedureFor('head') || isProcedureFor('brain')) &&
      !isProcedureFor('orbit') && !isProcedureFor('iac') &&
      !isProcedureFor('sella') && !isProcedureFor('tmj') &&
      !isProcedureFor('neck')) return 'BRAIN';
  if (isProcedureFor('sella') || isProcedureFor('pituitary')) return 'PITUITARY';
  if (isProcedureFor('internal auditory') || procLower.includes(' iac')) return 'IAC';
  if (isProcedureFor('orbit')) return 'ORBITS';
  if (isProcedureFor('temporomandibular') || isProcedureFor('tmj')) return 'TMJ';
  if (isProcedureFor('neck') && !isProcedureFor('orbit')) return 'NECK SOFT TISSUE';
  if (isProcedureFor('brachial plexus')) return 'BRACHIAL PLEXUS';

  // Cardiac/Chest
  if (isProcedureFor('heart') || isProcedureFor('cardiac')) return 'CARDIAC STRESS';
  if (isProcedureFor('breast')) return 'BREAST';
  if (isProcedureFor('chest') && !isProcedureFor('heart')) return 'CHEST';

  // MSK - infection check first
  const isMskJoint = isProcedureFor('knee') || isProcedureFor('shoulder') ||
                     isProcedureFor('hip') || isProcedureFor('ankle') ||
                     isProcedureFor('foot') || isProcedureFor('wrist') ||
                     isProcedureFor('hand') || isProcedureFor('elbow');

  if (isMskJoint) {
    if (scenarioLower.includes('osteomyelitis') || scenarioLower.includes('infection') ||
        scenarioLower.includes('septic') || scenarioLower.includes('abscess') ||
        scenarioLower.includes('cellulitis')) return 'OSTEOMYELITIS';
  }

  if (isProcedureFor('knee')) return 'KNEE';
  if (isProcedureFor('shoulder')) return 'SHOULDER';
  if (isProcedureFor('hip') && !isProcedureFor('spine')) return 'HIP';
  if (isProcedureFor('ankle') || isProcedureFor('foot')) return 'ANKLE';
  if (isProcedureFor('wrist') || isProcedureFor('hand')) return 'WRIST';
  if (isProcedureFor('elbow')) return 'ELBOW';

  // Extremity bone
  const isExtremityBone = isProcedureFor('thigh') || isProcedureFor('femur') ||
                          isProcedureFor('forearm') || isProcedureFor('humerus') ||
                          isProcedureFor('upper arm') || isProcedureFor('lower leg') ||
                          isProcedureFor('tibia') || isProcedureFor('fibula') ||
                          isProcedureFor('lower extremity') || isProcedureFor('upper extremity');

  if (isExtremityBone) {
    if (scenarioLower.includes('tumor') || scenarioLower.includes('mass') ||
        scenarioLower.includes('metasta') || scenarioLower.includes('sarcoma') ||
        scenarioLower.includes('cancer') || scenarioLower.includes('malignant') ||
        scenarioLower.includes('neoplasm') || scenarioLower.includes('lesion')) return 'BONE TUMOR';
    if (scenarioLower.includes('osteonecrosis') || scenarioLower.includes('avascular') ||
        scenarioLower.includes('avn') || scenarioLower.includes('bone infarct')) return 'OSTEONECROSIS';
    if (scenarioLower.includes('infection') || scenarioLower.includes('osteomyelitis') ||
        scenarioLower.includes('septic') || scenarioLower.includes('abscess')) return 'OSTEOMYELITIS';
    if (isProcedureFor('thigh') || isProcedureFor('femur') || isProcedureFor('lower extremity')) return 'HIP';
    if (isProcedureFor('lower leg') || isProcedureFor('tibia') || isProcedureFor('fibula')) return 'KNEE';
    if (isProcedureFor('forearm')) return 'ELBOW';
    if (isProcedureFor('upper arm') || isProcedureFor('humerus') || isProcedureFor('upper extremity')) return 'SHOULDER';
  }

  // Spine procedures
  if (isProcedureFor('cervical') && isProcedureFor('spine')) {
    if (scenarioLower.includes('infection') || scenarioLower.includes('discitis') || scenarioLower.includes('abscess')) return 'SPINE INFECTION';
    return 'C-SPINE';
  }
  if (isProcedureFor('thoracic') && isProcedureFor('spine')) {
    if (scenarioLower.includes('infection') || scenarioLower.includes('discitis') || scenarioLower.includes('abscess')) return 'SPINE INFECTION';
    return 'T-SPINE';
  }
  if (isProcedureFor('lumbar') && isProcedureFor('spine')) {
    if (scenarioLower.includes('infection') || scenarioLower.includes('discitis') || scenarioLower.includes('abscess')) return 'SPINE INFECTION';
    return 'L-SPINE';
  }
  if (isProcedureFor('spine') && (isProcedureFor('complete') || isProcedureFor('total') ||
      (isProcedureFor('cervical') && isProcedureFor('lumbar')))) {
    if (scenarioLower.includes('infection') || scenarioLower.includes('discitis') || scenarioLower.includes('abscess')) return 'SPINE INFECTION';
    return 'SCREENING SPINE';
  }

  // Generic spine fallback
  if (isProcedureFor('spine')) return 'L-SPINE';

  return null;
}

// Check if scenario has pre-computed match
function hasPrecomputedMatch(scenarioId) {
  for (const protocol of protocols) {
    if (protocol.scenario_matches) {
      const match = protocol.scenario_matches.find(m => String(m.scenario_id) === String(scenarioId));
      if (match) return protocol.name;
    }
  }
  return null;
}

// Load all regions and audit
const regions = ['neuro', 'spine', 'chest', 'abdomen', 'msk', 'vascular', 'breast', 'peds'];
let unrouted = [];
let routed = 0;
let totalMRI = 0;

regions.forEach(region => {
  const data = JSON.parse(fs.readFileSync('data/regions/' + region + '.json', 'utf8'));
  data.scenarios.forEach(scenario => {
    const mriProcs = (scenario.procedures || []).filter(p => p.modality === 'MRI');
    totalMRI += mriProcs.length;

    mriProcs.forEach(proc => {
      let match = hasPrecomputedMatch(scenario.id);
      if (!match) {
        match = applyClinicalRules(scenario.name, proc.name, region);
      }

      if (match) {
        routed++;
      } else {
        unrouted.push({
          region,
          scenarioId: scenario.id,
          scenarioName: scenario.name,
          procedure: proc.name,
          rating: proc.rating
        });
      }
    });
  });
});

// Group by procedure name
const byProcedure = {};
unrouted.forEach(u => {
  const key = u.procedure;
  if (!byProcedure[key]) byProcedure[key] = [];
  byProcedure[key].push(u);
});

const sorted = Object.entries(byProcedure).sort((a, b) => b[1].length - a[1].length);

console.log('=== ROUTING COVERAGE AUDIT ===');
console.log('Total MRI procedures:', totalMRI);
console.log('Routed:', routed);
console.log('Unrouted:', unrouted.length);
console.log('Coverage:', ((routed / totalMRI) * 100).toFixed(1) + '%');
console.log('');

if (unrouted.length > 0) {
  console.log('Remaining unrouted procedures:');
  sorted.forEach(([proc, items]) => {
    console.log(items.length + 'x ' + proc);
    items.slice(0, 2).forEach(item => {
      console.log('   - ' + item.scenarioName.substring(0, 70));
    });
  });

  console.log('\n=== BY REGION ===');
  const byRegion = {};
  unrouted.forEach(u => {
    if (!byRegion[u.region]) byRegion[u.region] = 0;
    byRegion[u.region]++;
  });
  Object.entries(byRegion).sort((a,b) => b[1] - a[1]).forEach(([r, c]) => {
    console.log(r + ': ' + c);
  });
} else {
  console.log('All MRI procedures are routed!');
}
