/**
 * Narrowing buttons for a topic guide.
 *
 * A topic's scenarios differ in a handful of attributes that ACR writes into
 * each scenario name and patient description: how long it has been going on,
 * trauma or not, pregnancy, child or adult, first study or next study, what
 * the earlier imaging showed, and the specific features a name mentions.
 * This module reads those attributes out of one topic's own scenarios and
 * offers a button for each one that tells its scenarios apart. Nothing here
 * is a fixed list of buttons: a topic that never mentions trauma never gets a
 * trauma button.
 *
 * Pure functions, no DOM: unit tested in tests/guide-facets.test.mjs.
 *
 * Two kinds of button:
 *   - attribute buttons (one choice per attribute). A scenario that does not
 *     state the attribute still applies when the choice is an "open" one:
 *     "acute" keeps a cauda equina scenario that names no duration, because
 *     that scenario applies at any duration. "Trauma", "Pregnant" and the red
 *     flag choices are strict: only scenarios that say so are kept.
 *   - feature buttons (any number, all must hold): the remaining parts of the
 *     scenario names, e.g. "Cauda equina syndrome suspected".
 */

// Attribute definitions. `open` values also keep scenarios that do not state
// the attribute at all.
const DIMENSIONS = [
  { key: 'timing', label: 'Duration', values: [
    { key: 'acute', label: 'Acute', open: true },
    { key: 'subacute', label: 'Subacute', open: true },
    { key: 'chronic', label: 'Chronic', open: true },
  ] },
  { key: 'trauma', label: 'Trauma', values: [
    { key: 'yes', label: 'Trauma', open: false },
    { key: 'no', label: 'No trauma', open: true },
  ] },
  { key: 'pregnancy', label: 'Pregnancy', values: [
    { key: 'yes', label: 'Pregnant', open: false },
    { key: 'no', label: 'Not pregnant', open: true },
  ] },
  { key: 'age', label: 'Patient', values: [
    { key: 'adult', label: 'Adult', open: false },
    { key: 'child', label: 'Child', open: false },
  ] },
  { key: 'redflag', label: 'Red flags', values: [
    { key: 'yes', label: 'Red flags present', open: false },
    { key: 'no', label: 'No red flags', open: false },
  ] },
  { key: 'phase', label: 'Stage of workup', values: [
    { key: 'initial', label: 'Initial imaging', open: true },
    { key: 'next', label: 'Next imaging study', open: true },
    { key: 'followup', label: 'Follow-up', open: true },
    { key: 'surveillance', label: 'Surveillance', open: true },
    { key: 'staging', label: 'Staging', open: true },
    { key: 'screening', label: 'Screening', open: true },
  ] },
];

// Groups the feature buttons are shown under, in display order.
const FEATURE_GROUPS = [
  { key: 'lead', label: 'Presentation' },
  { key: 'site', label: 'Body part' },
  { key: 'agedetail', label: 'Age' },
  { key: 'prior', label: 'Earlier imaging' },
  { key: 'concern', label: 'Clinical concern' },
  { key: 'feature', label: 'Features' },
  { key: 'detail', label: 'Patient description' },
];

const TIMING_WORD = /^(acute|subacute|chronic)$/;
const TIMING_PAIR = /^(acute|subacute|chronic) (?:or|and) (acute|subacute|chronic)$/;

// Negation in front of a word: "no trauma", "without trauma", "unrelated to
// trauma", "nontraumatic", "atraumatic".
const NEG_TRAUMA = /\b(?:no|not|without|unrelated to|non|absence of|no history of|no hx of)[\s-]*(?:recent |known |significant |prior |acute |history of |hx of )*(?:post[\s-]?)?trauma|\bnon[\s-]?traumatic|\batraumatic/;
const ANY_TRAUMA = /\b(?:post[\s-]?)?trauma(?:tic)?\b|\bposttraumatic\b/;
const EITHER_WAY = /\bwith or without\b|\bwithout or with\b|\bwith and without\b/;
const NEG_PREGNANT = /\b(?:not|non|no)[\s-]*(?:known to be )?pregnan|\bnonpregnan|\bpregnancy (?:excluded|ruled out)|\bnegative (?:pregnancy test|beta[\s-]?hcg)/;
const ANY_PREGNANT = /\bpregnan/;
const NEG_REDFLAG = /\b(?:no|without|absence of)\b[^.;:]{0,40}red flags?/;
const ANY_REDFLAG = /red flags?/;
// "One or more of the following: a, b, or c": the names enumerate the items,
// so the sentence as a whole says nothing about any single scenario.
const ENUMERATION = /\b(?:one or more|any|at least one|none) of the following\b/;

const PRIOR_STUDY = /\b(?:radiograph(?:y|s|ic)?|x[\s-]?rays?|cxr|us|ultrasound|ct|cta|mri|mra|mammo(?:gra(?:m|phy))?|dbt|imaging|echocardiogra(?:m|phy)|scintigraphy|bone scan)\b/;
const PRIOR_RESULT = /\b(?:normal|negative|positive|indeterminate|inconclusive|nondiagnostic|non-diagnostic|equivocal|abnormal|unremarkable|nonspecific|done|performed|findings?|suggest(?:s|ive|ing)?|shows?|showing|demonstrat(?:es|ing)|lesions?|detected|seen|identified)\b/;
const PRIOR_EXCLUDE = /\bcontraindicat|\bnot indicated\b|\bindicated\b|\bguide\b|\bplanning\b/;

const SITE = /^(?:left |right |bilateral )?(?:elbow|knee|shoulder|hip|wrist|ankle|foot|hand|pelvis|femur|humerus|forearm|thigh|neck|chest|abdomen|head|face|skull|orbit|upper arm|lower leg|leg|arm|upper extremity|lower extremity|tibia(?: and)? fibula|tibia|fibula|radius and ulna|ribs?|sternum|clavicle|scapula|cervical(?: spine)?|thoracic(?: spine)?|lumbar(?: spine)?|thoracolumbar(?: spine)?|lumbosacral(?: spine)?|sacrum|complete spine|spine|finger|toe|calcaneus|heel|midfoot|forefoot|hindfoot|sacroiliac joints?|abdomen and pelvis|chest and abdomen)$/;
const CONCERN = /\b(?:suspected|suspect|suspicion|concern)\b/;
const AGE_DETAIL = /\b(?:years?|months?|weeks?|days?) (?:of age|old)\b|\bage (?:of )?\d|\b(?:infant|neonate|newborn)s?\b/;

const PHASE_RULES = [
  ['screening', /\bscreening\b/],
  ['surveillance', /\bsurveillance\b/],
  ['staging', /\b(?:re)?staging\b/],
  ['followup', /\bfollow[\s-]?up\b/],
  ['next', /^next (?:imaging )?(?:study|test|exam)\b|^additional imaging\b/],
  ['initial', /^initial (?:imaging|exam|evaluation|study)\b/],
];
// A name part that is exactly one of these says nothing beyond the stage.
const PHASE_EXACT = /^(?:initial (?:imaging|exam|evaluation|study)|next (?:imaging )?(?:study|test|exam)|follow[\s-]?up(?: imaging)?|surveillance(?: imaging)?|staging|screening)$/;

function lower(text) {
  return String(text || '').toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Splits a scenario name on commas that are not inside parentheses. */
export function splitName(name) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of String(name || '')) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts.map(p => p.replace(/\s+/g, ' ').trim().replace(/\.$/, '')).filter(Boolean);
}

/** Splits a patient description into sentences. */
export function splitDescription(text) {
  const parts = [];
  let depth = 0;
  let current = '';
  const chars = [...String(text || '')];
  chars.forEach((ch, i) => {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    current += ch;
    if ((ch === '.' || ch === ';') && depth === 0 && (i === chars.length - 1 || /\s/.test(chars[i + 1]))) {
      parts.push(current);
      current = '';
    }
  });
  parts.push(current);
  return parts.map(p => p.trim().replace(/[.;]$/, '').trim()).filter(Boolean);
}

// For reading a description sentence: bracketed asides ("eg, no history of
// stones or pregnancy") qualify something else and are left out, and a word
// that follows any negation the patterns above do not recognise is not read
// either way.
const LOOSE_NEGATION = /\b(?:no|not|non|without|excluding|except|absence|unrelated|rule out|negative)\b/;
function fromSentence(read, word) {
  return sentence => {
    const text = sentence.replace(/\([^()]*(?:\([^()]*\)[^()]*)*\)/g, ' ').replace(/\([^)]*$/, ' ');
    const value = read(text);
    if (value !== 'yes') return value;
    const at = text.search(word);
    return LOOSE_NEGATION.test(text.slice(0, at)) ? null : value;
  };
}

function traumaOf(text) {
  if (!ANY_TRAUMA.test(text) || EITHER_WAY.test(text)) return null;
  return NEG_TRAUMA.test(text) ? 'no' : 'yes';
}

function pregnancyOf(text) {
  if (!ANY_PREGNANT.test(text) || EITHER_WAY.test(text)) return null;
  return NEG_PREGNANT.test(text) ? 'no' : 'yes';
}

function redflagOf(text) {
  if (!ANY_REDFLAG.test(text)) return null;
  return NEG_REDFLAG.test(text) ? 'no' : 'yes';
}

function phaseOf(text) {
  for (const [key, pattern] of PHASE_RULES) if (pattern.test(text)) return key;
  return null;
}

function isPrior(text) {
  return PRIOR_STUDY.test(text) && PRIOR_RESULT.test(text) && !PRIOR_EXCLUDE.test(text);
}

function sentenceCase(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Reads one scenario's name. Returns the attribute values the name states and
 * the name parts left over as features.
 */
function readName(scenario) {
  const dims = { timing: new Set(), trauma: new Set(), pregnancy: new Set(), redflag: new Set(), phase: new Set() };
  const features = [];
  const parts = splitName(scenario.name);
  parts.forEach((part, i) => {
    // Some names carry their topic in brackets to stay unique; it is not a feature.
    const raw = scenario.topic && part.endsWith(` (${scenario.topic})`) ? part.slice(0, -scenario.topic.length - 3) : part;
    let text = lower(raw);
    let label = raw;
    let consumed = false;

    // Duration: only a part that is the bare word, or a first part that
    // carries it ("Foot pain chronic"). "Chronic steroid use" is not duration.
    const pair = text.match(TIMING_PAIR);
    if (TIMING_WORD.test(text)) {
      dims.timing.add(text);
      consumed = true;
    } else if (pair) {
      dims.timing.add(pair[1]);
      dims.timing.add(pair[2]);
      consumed = true;
    } else if (i === 0) {
      const m = text.match(/^(acute|subacute|chronic) (.+)$/) || text.match(/^(.+) (acute|subacute|chronic)$/);
      if (m) {
        const word = TIMING_WORD.test(m[1]) ? m[1] : m[2];
        const rest = TIMING_WORD.test(m[1]) ? m[2] : m[1];
        // "Acute pancreatitis" names a disease; only strip the word when the
        // rest still reads as a complaint on its own.
        if (/\b(?:pain|trauma|injury|illness|symptoms?)\b/.test(rest)) {
          dims.timing.add(word);
          text = rest;
          label = raw.replace(new RegExp(`\\s*\\b${word}\\b\\s*`, 'i'), ' ').trim();
        }
      }
    }

    const trauma = traumaOf(text);
    if (trauma) {
      dims.trauma.add(trauma);
      if (/^(?:no |non|a|hx of |history of |post[\s-]?)?trauma(?:tic)?$/.test(text)) consumed = true;
    }
    const pregnancy = pregnancyOf(text);
    if (pregnancy) {
      dims.pregnancy.add(pregnancy);
      if (/^(?:not |non[\s-]?)?pregnan(?:t|cy)(?: patient| woman| female)?$/.test(text)) consumed = true;
    }
    const redflag = redflagOf(text);
    if (redflag) {
      dims.redflag.add(redflag);
      if (/^(?:no |with |without )?red flags?$/.test(text)) consumed = true;
    }

    const prior = isPrior(text);
    if (!prior) {
      const phase = phaseOf(text);
      if (phase && i > 0) {
        dims.phase.add(phase);
        if (PHASE_EXACT.test(text)) consumed = true;
      }
    }

    if (consumed || !text || text === 'suspected') return;
    const group = i === 0 ? 'lead'
      : prior ? 'prior'
      : SITE.test(text) ? 'site'
      : CONCERN.test(text) ? 'concern'
      : 'feature';
    features.push({ key: `${group}:${lower(label)}`, label: sentenceCase(label), group });
  });
  return { dims, features };
}

/**
 * Reads what one topic's scenarios state. Scenarios need { id, name, age,
 * search } (search is ACR's patient description).
 */
function readTopic(scenarios) {
  const rows = scenarios.map(s => ({ scenario: s, ...readName(s), sentences: splitDescription(s.search).map(lower) }));

  // Descriptions several scenarios share enumerate alternatives the names pick
  // between ("...pregnancy or peripartum period"). When one of those names
  // states an attribute, the description is not used to give it to the others.
  const byDescription = new Map();
  for (const row of rows) {
    const key = lower(row.scenario.search);
    if (!byDescription.has(key)) byDescription.set(key, []);
    byDescription.get(key).push(row);
  }
  for (const row of rows) row.named = Object.fromEntries(Object.entries(row.dims).map(([k, v]) => [k, v.size > 0]));
  const siblingStates = (row, dim) => byDescription.get(lower(row.scenario.search)).some(r => r.named[dim]);

  for (const row of rows) {
    const usable = row.sentences.filter(s => !ENUMERATION.test(s));
    // A name that uses a duration word some other way ("chronic symmetric
    // weakness") is left unread rather than guessed at.
    const namesDuration = /\b(?:acute|subacute|chronic)\b/i.test(row.scenario.name);
    if (row.dims.timing.size === 0 && !namesDuration && !siblingStates(row, 'timing')) {
      for (const s of usable) {
        const m = s.match(/^(acute|subacute|chronic)(?: (?:or|and) (acute|subacute|chronic))?\b/);
        if (m) {
          row.dims.timing.add(m[1]);
          if (m[2]) row.dims.timing.add(m[2]);
          break;
        }
      }
    }
    if (row.dims.trauma.size === 0 && !siblingStates(row, 'trauma')) {
      const found = new Set(usable.map(fromSentence(traumaOf, ANY_TRAUMA)).filter(Boolean));
      if (found.size === 1) row.dims.trauma.add([...found][0]);
    }
    if (row.dims.pregnancy.size === 0 && !siblingStates(row, 'pregnancy')) {
      const found = new Set(usable.map(fromSentence(pregnancyOf, ANY_PREGNANT)).filter(Boolean));
      if (found.size === 1) row.dims.pregnancy.add([...found][0]);
    }
    if (row.dims.redflag.size === 0) {
      const found = new Set(row.sentences.map(redflagOf).filter(Boolean));
      if (found.size === 1) row.dims.redflag.add([...found][0]);
    }
    if (row.dims.phase.size === 0) {
      for (const s of row.sentences) {
        if (PHASE_EXACT.test(s)) {
          row.dims.phase.add(phaseOf(s));
          break;
        }
      }
    }

    // Child or adult comes from the data's own age field; a description that
    // says "Adult or child" covers both.
    row.dims.age = new Set(row.sentences.some(s => /^adults? or child(?:ren)?\b|^child(?:ren)? or adults?\b/.test(s))
      ? ['adult', 'child']
      : [row.scenario.age === 'pediatric' ? 'child' : 'adult']);

    // Age bands only the description gives ("40 years of age or older").
    const original = splitDescription(row.scenario.search);
    original.forEach((sentence, i) => {
      const text = row.sentences[i];
      if (!AGE_DETAIL.test(text) || text.length > 70 || ENUMERATION.test(text)) return;
      const label = sentence.replace(/^(?:adults?(?: or child(?:ren)?)?|child(?:ren)?)(?: females?| males?| patients?)?[,\s]+(?=\S)/i, '');
      if (!label || /^(?:female|male)s?$/i.test(label)) return;
      row.features.push({ key: `agedetail:${lower(label)}`, label: sentenceCase(label), group: 'agedetail' });
    });
  }

  // Scenarios the names and attributes cannot tell apart: offer the sentences
  // of their descriptions that differ.
  const signature = row => [
    ...DIMENSIONS.map(d => [...row.dims[d.key]].sort().join('+')),
    ...row.features.map(f => f.key).sort(),
  ].join('|');
  const bySignature = new Map();
  for (const row of rows) {
    const key = signature(row);
    if (!bySignature.has(key)) bySignature.set(key, []);
    bySignature.get(key).push(row);
  }
  for (const group of bySignature.values()) {
    if (group.length < 2) continue;
    const counts = new Map();
    for (const row of group) for (const s of new Set(row.sentences)) counts.set(s, (counts.get(s) || 0) + 1);
    for (const row of group) {
      const original = splitDescription(row.scenario.search);
      original.forEach((sentence, i) => {
        const text = row.sentences[i];
        if (counts.get(text) === group.length || text.length > 110 || PHASE_EXACT.test(text)) return;
        if (row.features.some(f => f.key === `detail:${text}`)) return;
        row.features.push({ key: `detail:${text}`, label: sentenceCase(sentence), group: 'detail' });
      });
    }
  }
  return rows;
}

/**
 * Builds the facet model for one topic's scenarios.
 * Returns { scenarios, rows, dims, features } for facetState/applySelection.
 */
export function buildFacetModel(scenarios) {
  const rows = readTopic(scenarios);
  const total = rows.length;

  // Feature buttons: one per distinct name part, with the scenarios that carry it.
  const featureMap = new Map();
  rows.forEach((row, index) => {
    for (const f of row.features) {
      if (!featureMap.has(f.key)) featureMap.set(f.key, { id: `f:${f.key}`, label: f.label, group: f.group, members: new Set() });
      featureMap.get(f.key).members.add(index);
    }
  });

  // An attribute with one stated value cannot be "open": every scenario would
  // pass. It becomes a plain has-it toggle instead.
  const dims = [];
  for (const def of DIMENSIONS) {
    const stated = def.values.filter(v => rows.some(r => r.dims[def.key].has(v.key)));
    if (stated.length === 0) continue;
    // Trauma and pregnancy: where some scenarios say yes, the rest are the
    // "no" side whether or not they spell it out.
    const impliedNo = (def.key === 'trauma' || def.key === 'pregnancy') && stated.length === 1 && stated[0].key === 'yes';
    const offered = impliedNo ? def.values : stated;
    const values = offered.map(v => ({ ...v, id: `${def.key}:${v.key}`, open: offered.length > 1 && v.open }));
    dims.push({ key: def.key, label: def.label, values });
  }

  const model = { scenarios, rows, dims, features: [] };

  // Keep an attribute value only if choosing it alone narrows the topic.
  for (const dim of dims) {
    dim.values = dim.values.filter(v => {
      const n = countMatching(model, [v.id]);
      return n > 0 && n < total;
    });
  }
  model.dims = dims.filter(d => d.values.length > 0);

  // Feature buttons that pick out the same scenarios as an attribute button or
  // as each other say the same thing twice: merge them.
  const key = members => [...members].sort((a, b) => a - b).join(',');
  const featureKeys = new Set([...featureMap.values()].map(f => key(f.members)));
  const taken = new Map();
  for (const dim of model.dims) {
    const statedKey = v => key(new Set(rows.map((r, i) => (r.dims[dim.key].has(v.key) ? i : -1)).filter(i => i >= 0)));
    // "Trauma" that only restates one feature ("Low velocity trauma") gives
    // way to the feature, which is ACR's own wording.
    if (dim.key === 'trauma' && dim.values.some(v => v.key === 'yes' && featureKeys.has(statedKey(v)))) {
      dim.values = [];
      continue;
    }
    for (const v of dim.values) if (!v.open) taken.set(statedKey(v), null);
  }
  model.dims = model.dims.filter(d => d.values.length > 0);
  for (const f of featureMap.values()) {
    if (f.members.size === total) continue;
    const k = key(f.members);
    if (taken.has(k)) {
      const first = taken.get(k);
      if (first && first.group === f.group && first.merged < 3) {
        first.label += `, ${/^[A-Z][a-z]/.test(f.label) ? f.label.charAt(0).toLowerCase() + f.label.slice(1) : f.label}`;
        first.merged++;
      }
      continue;
    }
    const feature = { ...f, merged: 1 };
    taken.set(k, feature);
    model.features.push(feature);
  }
  return model;
}

function parseSelection(model, selection) {
  const chosen = new Map();
  const features = [];
  for (const id of selection || []) {
    if (id.startsWith('f:')) {
      const f = model.features.find(x => x.id === id);
      if (f) features.push(f);
      continue;
    }
    const [dimKey, valueKey] = id.split(':');
    const dim = model.dims.find(d => d.key === dimKey);
    const value = dim && dim.values.find(v => v.key === valueKey);
    if (value) chosen.set(dimKey, value);
  }
  return { chosen, features };
}

function matchingIndexes(model, selection) {
  const { chosen, features } = parseSelection(model, selection);
  const out = [];
  model.rows.forEach((row, index) => {
    for (const [dimKey, value] of chosen) {
      const stated = row.dims[dimKey];
      if (stated.has(value.key)) continue;
      if (value.open && stated.size === 0) continue;
      return;
    }
    for (const f of features) if (!f.members.has(index)) return;
    out.push(index);
  });
  return out;
}

function countMatching(model, selection) {
  return matchingIndexes(model, selection).length;
}

/** The scenarios a selection (array of option ids) leaves. */
export function applySelection(model, selection) {
  return matchingIndexes(model, selection).map(i => model.scenarios[i]);
}

/**
 * Selection after pressing an option: an attribute holds one choice at a time
 * (pressing the chosen one clears it); features add up.
 */
export function toggleOption(selection, id) {
  const current = selection || [];
  if (current.includes(id)) return current.filter(x => x !== id);
  if (id.startsWith('f:')) return [...current, id];
  const dimKey = id.split(':')[0];
  return [...current.filter(x => x.startsWith('f:') || x.split(':')[0] !== dimKey), id];
}

/**
 * What to draw for a selection: the scenarios left and the button groups.
 * Each option: { id, label, count, pressed, disabled }. count is how many
 * scenarios would be left after pressing it. Attribute options that would
 * leave nothing are disabled; feature options that would leave nothing, or
 * change nothing, are not offered.
 */
export function facetState(model, selection) {
  const valid = (selection || []).filter(id =>
    model.features.some(f => f.id === id) || model.dims.some(d => d.values.some(v => v.id === id)));
  const remainingIdx = matchingIndexes(model, valid);
  const remaining = remainingIdx.map(i => model.scenarios[i]);
  const remainingSet = new Set(remainingIdx);
  const groups = [];

  for (const dim of model.dims) {
    const options = dim.values.map(v => {
      const pressed = valid.includes(v.id);
      const count = pressed ? remaining.length : countMatching(model, toggleOption(valid, v.id));
      return { id: v.id, label: v.label, count, pressed, disabled: !pressed && count === 0 };
    });
    groups.push({ key: dim.key, label: dim.label, kind: 'attribute', options });
  }

  for (const def of FEATURE_GROUPS) {
    const options = [];
    for (const f of model.features) {
      if (f.group !== def.key) continue;
      const pressed = valid.includes(f.id);
      let count = 0;
      for (const i of f.members) if (remainingSet.has(i)) count++;
      if (!pressed && (count === 0 || count === remaining.length)) continue;
      options.push({ id: f.id, label: f.label, count, pressed, disabled: false });
    }
    if (options.length === 0) continue;
    options.sort((a, b) => Number(b.pressed) - Number(a.pressed) || b.count - a.count);
    groups.push({ key: def.key, label: def.label, kind: 'feature', options });
  }

  return { selection: valid, remaining, groups, total: model.scenarios.length };
}

/**
 * Fewest presses that leave only this scenario, pressing at each step the
 * offered button that keeps it and leaves the fewest others. null when the
 * buttons cannot single it out.
 */
export function clicksToReach(model, scenario) {
  const index = model.scenarios.indexOf(scenario);
  let selection = [];
  let left = model.scenarios.length;
  let clicks = 0;
  while (left > 1) {
    const state = facetState(model, selection);
    let best = null;
    for (const group of state.groups) {
      for (const option of group.options) {
        if (option.pressed || option.disabled || option.count >= left) continue;
        const next = toggleOption(selection, option.id);
        if (!matchingIndexes(model, next).includes(index)) continue;
        if (!best || option.count < best.count) best = { count: option.count, next };
      }
    }
    if (!best) return null;
    selection = best.next;
    left = best.count;
    clicks++;
  }
  return clicks;
}

/** ACR's own page for one scenario (the same address the region data carries). */
export function acrSourceUrl(id) {
  return `https://gravitas.acr.org/ACPortal/GetDataForOneScenario?senarioId=${encodeURIComponent(id)}`;
}
