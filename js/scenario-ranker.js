/**
 * Clinical matching across every ACR scenario.
 *
 * The rule that keeps answers safe: a clinical word in the search is never
 * silently dropped. A scenario must name every required term, in its ACR name
 * or variant text; narrative keywords only reorder matches. When no scenario
 * fits, the answer is "none" rather than a guess. Earlier versions scored by
 * partial overlap ("seizure first time" reached pyelonephritis) or dropped the
 * most common word ("tension pneumothorax" reached tension headache).
 *
 * Negation is read on both sides, so "headache with red flags" cannot match
 * ACR's "headache, no red flags". Pregnancy, age and side act as filters.
 * Plain English, question words and study names are ignored, so a long
 * sentence is read for its clinical core.
 *
 * Three further readings keep a search from ending in a dead end:
 * - Several complaints ("chest pain and shortness of breath"): a scenario that
 *   names them all wins; otherwise each complaint's topics are offered, grouped
 *   by complaint, instead of dropping one complaint.
 * - A size ("8 mm lung nodule") is checked against the ranges ACR writes in
 *   scenario names ("<6mm", "1-2cm", "greater than 2 cm and less than 4 cm").
 *   A size outside every range never picks a wrong range: the topic is shown
 *   with a note instead.
 * - When nothing matches, the search is explained rather than refused: which
 *   words were understood, which ACR never uses, the topics each understood
 *   word points at, and the likely body region. Every suggestion passes the
 *   same population, negation, side and body-region checks as an answer, and a
 *   search ACR does not cover at all is told so.
 */
import { conceptNormalize } from './concept-matcher.js?v=20260531a';
import { MINED_ALIASES } from './aliases-mined.js?v=20261104a';

// Words that carry no clinical meaning here, including modality words: "mri for
// cauda equina" should reach the same scenario as "cauda equina". Plain English
// is listed too, so "my dad has back pain getting worse" is read as "back pain
// worsening". A word missing here is treated as clinical and must match.
const STOPWORDS = new Set([
  // function words and question words
  'a', 'about', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'been', 'being', 'by', 'can', 'cannot', 'cant', 'could',
  'did', 'do', 'does', 'doing', 'done', 'dont', 'else', 'etc', 'for', 'from', 'had', 'has', 'have', 'having', 'he',
  'her', 'here', 'hers', 'him', 'his', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'just', 'me', 'might',
  'mine', 'must', 'my', 'need', 'needed', 'needs', 'of', 'on', 'one', 'only', 'or', 'other', 'our', 'ours', 'she',
  'should', 'so', 'some', 'something', 'someone', 'anything', 'anyone', 'such', 'than', 'that', 'the', 'their', 'theirs',
  'them', 'then', 'there', 'these', 'they', 'this', 'those', 'to', 'too', 'us', 'very', 'was', 'we', 'were', 'what',
  'whats', 'when', 'where', 'whether', 'which', 'while', 'who', 'whom', 'whose', 'why', 'will', 'with', 'would', 'you',
  'your', 'yours', 'also', 'still', 'yet', 'ever', 'always', 'often', 'sometimes', 'usually', 'really', 'quite',
  'please', 'thanks', 'thank', 'ok', 'okay', 'well', 'say', 'said', 'says', 'tell', 'told', 'think', 'thought', 'know',
  'want', 'wants', 'wanted', 'mean', 'means', 'meant', 'look', 'looks', 'looking', 'looked', 'like', 'show', 'shows',
  'showing', 'shown', 'see', 'seen', 'sees', 'go', 'goes', 'going', 'gone', 'come', 'comes', 'coming', 'get', 'gets',
  'getting', 'got', 'give', 'given', 'take', 'taken', 'make', 'makes', 'made', 'kind', 'sort', 'thing', 'things',
  'way', 'ways', 'lot', 'much', 'many', 'more', 'most', 'less', 'least', 'few', 'several', 'various',
  'every', 'each', 'all', 'both', 'either', 'neither', 'another', 'same', 'different', 'own', 'away', 'over', 'under',
  'between', 'through', 'during', 'before', 'after', 'since', 'until', 'ago', 'now', 'today', 'yesterday', 'tonight',
  'last', 'past', 'currently', 'present', 'presently', 'again', 'already', 'soon', 'later', 'earlier',
  'because', 'due', 'though', 'although', 'however', 'but', 'plus', 'versus', 'vs', 'v', 'compared', 'compare',
  'comparison', 'rather', 'instead', 'per', 'via', 'using', 'use', 'used', 'useful', 'usefulness', 'utility', 'role',
  'help', 'helpful', 'helps', 'consider', 'considered', 'option', 'options', 'alternative', 'alternatives', 'better',
  'best', 'good', 'bad', 'terrible', 'worst', 'preferred', 'prefer', 'fine', 'ill', 'sick', 'feel', 'feels', 'feeling',
  'side', 'sided',
  // people, not clinical descriptors
  'patient', 'patients', 'pt', 'pts', 'person', 'people', 'case', 'cases', 'mom', 'mother', 'dad', 'father', 'husband',
  'wife', 'son', 'daughter', 'grandma', 'grandmother', 'grandpa', 'grandfather', 'brother', 'sister', 'friend', 'parent',
  'parents', 'family', 'doctor', 'dr', 'md', 'physician', 'nurse', 'np', 'pa', 'provider', 'radiologist', 'surgeon',
  'smoker', 'smoking', 'smokes', 'nonsmoker', 'drinker', 'runner', 'athlete', 'athletic', 'sports', 'football',
  'soccer', 'basketball', 'skiing', 'game', 'gym', 'worker',
  // how a question is asked
  'guideline', 'guidelines', 'recommend', 'recommended', 'recommendation', 'recommendations', 'appropriate',
  'appropriateness', 'criteria', 'criterion', 'acr', 'indication', 'indications', 'indicated', 'protocol', 'protocols',
  'sequence', 'sequences', 'technique', 'techniques', 'modality', 'modalities', 'choice', 'choose', 'choosing', 'select',
  'selection', 'order', 'ordered', 'ordering', 'orders', 'request', 'requested', 'workup', 'work', 'up', 'evaluation',
  'evaluate', 'evaluating', 'evaluated', 'eval', 'assess', 'assessing', 'assessment', 'approach', 'management', 'manage',
  'managing', 'managed', 'plan', 'planning', 'step', 'steps', 'finding', 'findings', 'feature', 'features', 'sign',
  'signs', 'symptom', 'symptoms', 'sx', 'presentation', 'presents', 'presenting', 'presented', 'complains',
  'complaining', 'complaint', 'complaints', 'reports', 'reported', 'reporting', 'noted', 'notes', 'note', 'found',
  'detected', 'discovered', 'diagnosed', 'diagnosis', 'diagnoses', 'diagnostic', 'dx', 'ddx', 'differential', 'etiology',
  'cause', 'causes', 'caused', 'imaging', 'image', 'images', 'imaged', 'study', 'studies', 'exam', 'exams',
  'examination', 'scan', 'scans', 'scanned', 'scanning', 'test', 'tests', 'testing', 'film', 'films', 'picture',
  'pictures', 'view', 'views', 'detect', 'detects', 'detection', 'confirm', 'confirmed', 'confirmation', 'identify',
  'identified', 'characterize', 'characterization', 'determine', 'determining', 'define', 'extent', 'significance',
  'significant', 'insignificant', 'importance', 'important', 'question', 'questions', 'answer', 'info', 'information',
  'learn', 'read', 'reading', 'reads', 'measure', 'measurement', 'measurements', 'measuring', 'size', 'sizing', 'cm', 'mm',
  'suspected', 'suspect', 'suspicion', 'suspicious', 'concern', 'concerning', 'concerned', 'worried', 'worry', 'worrisome',
  'rule', 'out', 'ro', 'exclude', 'excluded', 'known', 'possible', 'possibly', 'probable', 'probably', 'likely',
  'unlikely', 'presumed', 'consistent', 'compatible', 'year', 'years', 'yr', 'yrs', 'old', 'yo',
  'age', 'aged', 'ages', 'contrast', 'within', 'hour', 'hours', 'hr', 'hrs', 'minute', 'minutes', 'min', 'mins', 'day',
  'days', 'week', 'weeks', 'wk', 'wks', 'month', 'months', 'mo', 'mos', 'time', 'times', 'clearance', 'w', 'wo', 'iv',
  'intravenous', 'gad', 'gadolinium', 'gbca', 'con', 'noncon', 'enhanced', 'unenhanced', 'dose', 'change',
  'changes', 'changed', 'changing', 'status', 'episode', 'episodes', 'event', 'events', 'history', 'hx', 'condition',
  'conditions', 'disorder', 'disorders', 'problem', 'problems', 'issue', 'issues', 'complication', 'complications',
  'type', 'types', 'form', 'forms', 'level', 'levels', 'ground', 'next', 'line',
  'standard', 'gold', 'initial', 'initially', 'start', 'started', 'starting', 'begin', 'began', 'onset', 'blood',
  'pressure', 'picc', 'xbreakx', 'xcommax',
  // where the patient is
  'ed', 'er', 'emergency', 'department', 'clinic', 'office', 'outpatient', 'inpatient', 'icu', 'ward', 'floor',
  'bedside', 'triage', 'urgent', 'urgently', 'stat', 'elective', 'setting', 'care', 'pcp', 'referral', 'referred',
  'consult', 'consultation', 'home', 'house', 'school', 'nursing',
  // modalities and technique words
  'ct', 'cta', 'ctpa', 'ctp', 'mri', 'mr', 'mra', 'mrv', 'mrcp', 'mre', 'cte', 'us', 'ultrasound', 'sono', 'sonogram',
  'sonography', 'sonographic', 'echo', 'echocardiogram', 'echocardiography', 'xray', 'xrays', 'xr', 'cxr', 'kub',
  'radiograph', 'radiographs', 'radiography', 'radiographic', 'plain', 'pet', 'fdg', 'spect', 'nm', 'nuclear',
  'scintigraphy', 'angio', 'angiogram', 'angiography', 'arteriogram', 'arteriography', 'doppler', 'duplex', 'venogram',
  'venography', 'arthrogram', 'arthrography', 'enterography', 'colonography', 'urogram', 'urography', 'myelogram',
  'myelography', 'fluoroscopy', 'fluoro', 'tomosynthesis', 'dbt', 'hrct', 'ldct', 'phase', 'phases', 'triphasic',
  'multiphase', 'multiphasic', 'multiparametric', 'mp', 'dwi', 'adc', 'flair', 't1', 't2', 'swi', 'gre', 'stir', 'lge',
  'asl', 'dsc', 'dce', 'perfusion', 'spectroscopy', 'mrs', 'dti', 'tractography', '3d', '4d', 'thin', 'coronal',
  'axial', 'sagittal', 'slice', 'slices', 'mapping', 'weighted', 'noncontrast', 'nonenhanced', 'radiology',
  'rads', 'ir', 'interventional', 'biopsy', 'bx', 'guided', 'transvaginal', 'transabdominal', 'endovaginal', 'tvus',
  // laboratory shorthand that does not change the ACR scenario
  'hgb', 'hct', 'wbc', 'cbc', 'bmp', 'cmp', 'lipase', 'amylase', 'troponin', 'bnp', 'crp', 'esr', 'lactate', 'cr',
  'creatinine', 'bun', 'inr', 'ptt', 'ua', 'urinalysis', 'labs', 'lab', 'bloodwork', 'ecg', 'ekg', 'nl', 'wnl',
]);

// Body parts are never dropped from a search: hand trauma is no answer to a
// question about the abdomen, and upper GI bleeding none to lower.
const ANATOMY = new Set([
  'upper', 'lower',
  'head', 'neck', 'cervical', 'chest', 'lung', 'heart', 'abdomen', 'pelvis', 'spine', 'thoracic', 'lumbar', 'lowback',
  'back', 'sacrum', 'shoulder', 'elbow', 'forearm', 'wrist', 'hand', 'finger', 'hip', 'groin', 'thigh', 'femur', 'knee',
  'leg', 'tibia', 'ankle', 'foot', 'toe', 'breast', 'axilla', 'kidney', 'liver', 'pancreas', 'pancrea', 'spleen', 'bladder',
  'prostate', 'uterus', 'ovary', 'adnexal', 'adrenal', 'bowel', 'colon', 'rectum', 'stomach', 'esophagus', 'thyroid',
  'orbit', 'eye', 'ear', 'sinus', 'aorta', 'scrotum', 'flank', 'face', 'facial', 'jaw', 'mandibular', 'skull', 'rib',
  'extremity', 'mesenteric', 'biliary', 'gallbladder', 'ureter', 'cervix', 'vaginal', 'penis', 'nasal',
]);

// A side narrows the answer but ACR rarely names one, so it filters instead of
// being required: "left knee pain" reads as knee pain and excludes right-only.
const SIDES = new Set(['left', 'right']);

// Body regions. A scenario named for one region is no answer to a search whose
// study or soft words name another: "brain MR for new mass" is not an axillary
// lump. Spine words sit in both the spine and the back group on purpose.
const ANATOMY_GROUPS = [
  ['head', 'skull', 'face', 'facial', 'orbit', 'eye', 'ear', 'sinus', 'nasal', 'jaw', 'mandibular', 'sella', 'iac',
    'brain', 'pituitary', 'cerebral', 'intracranial'],
  ['cervical', 'spine', 'thoracic', 'lumbar', 'lowback', 'back', 'sacrum', 'thyroid'],
  ['chest', 'lung', 'heart', 'rib', 'thorax', 'breast', 'axilla', 'esophagus'],
  // "pancreas" stems to "pancrea", which is the form the index holds.
  ['abdomen', 'liver', 'kidney', 'pancreas', 'pancrea', 'spleen', 'bowel', 'colon', 'stomach', 'adrenal', 'biliary', 'gallbladder',
    'mesenteric', 'flank', 'ureter', 'aorta'],
  ['pelvis', 'bladder', 'prostate', 'uterus', 'ovary', 'adnexal', 'rectum', 'scrotum', 'cervix', 'vaginal', 'penis', 'hip', 'groin'],
  ['shoulder', 'elbow', 'forearm', 'wrist', 'hand', 'finger', 'thigh', 'femur', 'knee', 'leg', 'tibia', 'ankle', 'foot', 'toe', 'extremity',
    'bone', 'joint', 'muscle', 'tendon', 'ligament'],
];
const GROUP_OF = new Map(ANATOMY_GROUPS.flatMap((g, i) => g.map(t => [t, i])));
const groupsOf = terms => new Set(terms.map(t => GROUP_OF.get(t)).filter(g => g !== undefined));

// Study names inside a search. The modality is dropped; the body part becomes
// a soft term, so "cta neck for dissection" still prefers the cervical answer.
const MODALITY_WORDS = 'ct|cta|ctpa|mri|mr|mra|mrv|mrcp|us|ultrasound|xray|x ray|radiograph|radiographs|radiography|pet|angiography|angiogram|duplex|doppler|scan|imaging';
const STUDY_ANATOMY_WORDS = 'head|brain|neck|chest|thorax|abdomen|pelvis|spine|lumbar spine|cervical spine|thoracic spine|knee|hip|shoulder|mesenteric|renal|sinus|sinuses|orbit|orbits|sella|iac|face|maxillofacial|extremity|aorta|pulmonary arteries';
const STUDY_ANATOMY_LIST = `(?:${STUDY_ANATOMY_WORDS})(?: (?:and )?(?:${STUDY_ANATOMY_WORDS}))*`;
const STUDY_RE = new RegExp(`\\b(?:(?:${MODALITY_WORDS}) (${STUDY_ANATOMY_LIST})|(${STUDY_ANATOMY_LIST}) (?:${MODALITY_WORDS}))\\b`, 'g');

// A result word attached to a study or lab is not a clinical term to match:
// "negative CT", "troponin negative", "xray normal".
const RESULT_WORDS = 'negative|neg|positive|pos|normal|abnormal|unremarkable|equivocal|nondiagnostic|indeterminate|inconclusive|elevated|high|low';
const LAB_WORDS = 'ct|cta|ctpa|mri|mr|film|films|us|ultrasound|scan|imaging|cxr|kub|head ct|ct head|troponin|troponins|wbc|lipase|amylase|ua|urinalysis|ecg|ekg|cbc|crp|esr|lactate';
const RESULT_RE = new RegExp(`\\b(?:(?:${RESULT_WORDS}) (?:${LAB_WORDS})|(?:${LAB_WORDS}) (?:${RESULT_WORDS}))\\b`, 'g');

// Useful for ordering results, but a scenario without them is still a fair match.
const SOFT_TERMS = new Set([
  'acute', 'chronic', 'subacute', 'new', 'newly', 'recent', 'recently', 'elderly', 'severe', 'mild', 'moderate',
  'recurrent', 'high', 'low', 'risk', 'worsening', 'persistent', 'sudden', 'follow', 'adult', 'occult', 'solitary', 'fall',
  'incidental', 'indeterminate', 'progressive', 'early', 'late', 'gradual', 'intermittent', 'constant', 'ongoing',
  'prolonged', 'unexplained', 'nonspecific', 'atypical', 'typical', 'isolated', 'bilateral', 'unilateral', 'daily',
  'painless', 'female', 'male', 'young', 'younger', 'older', 'middle', 'positive', 'abnormal', 'stable',
  'symptomatic', 'asymptomatic', 'post', 'tension', 'spontaneous', 'primary', 'secondary', 'idiopathic', 'focal',
  'diffuse', 'generalized', 'localized', 'nonlocalized', 'pleuritic', 'exertional', 'exertion', 'postprandial',
  'minor', 'major', 'simple', 'uncomplicated', 'routine', 'emergent', 'anticoagulation', 'anticoagulated',
  'anticoagulant', 'anticoagulants', 'coumadin', 'warfarin', 'heparin', 'eliquis', 'xarelto', 'apixaban',
  'rivaroxaban', 'doac', 'thinners', 'thinner', 'antiplatelet', 'aspirin', 'plavix', 'clopidogrel', 'twisting',
  'velocity', 'reproductive', 'first', 'second', 'third', 'bear', 'weight', 'walk', 'pulseless', 'hypertensive',
  'nausea', 'vomiting', 'immunocompetent', 'ballistic', 'radiating', 'rupture', 'ruptured', 'tear', 'torn',
]);

// Different words for the same thing, applied to searches and scenarios alike.
const EQUIVALENT = {
  abdominal: 'abdomen', abd: 'abdomen', belly: 'abdomen', tummy: 'abdomen', renal: 'kidney', hepatic: 'liver',
  cardiac: 'heart', cardiovascular: 'heart', lump: 'mass', lumps: 'mass', bump: 'mass', gastrointestinal: 'gi',
  followup: 'follow', surveillance: 'follow', metastases: 'met', metastasis: 'met', metastatic: 'met', mets: 'met',
  injury: 'trauma', injuries: 'trauma', injured: 'trauma', traumatic: 'trauma', seizures: 'seizure', epilepsy: 'seizure',
  convulsion: 'seizure', convulsions: 'seizure', dizzy: 'dizziness', urolithiasis: 'stone', calculus: 'stone',
  calculi: 'stone', ache: 'pain', backache: 'back', painful: 'pain', hurts: 'pain', hurt: 'pain', sore: 'pain',
  pancreatic: 'pancreas', rhinosinusitis: 'sinusitis', replacement: 'arthroplasty', replaced: 'arthroplasty',
  sacral: 'sacrum', mandible: 'mandibular', abusive: 'abuse', postpartum: 'peripartum', pulmonary: 'lung', lungs: 'lung',
  pelvic: 'pelvis', scrotal: 'scrotum', testicle: 'testis', testicles: 'testis', testes: 'testis', brain: 'head',
  neck: 'cervical', htn: 'hypertension', embolus: 'embolism', emboli: 'embolism', embolic: 'embolism',
  bleed: 'bleeding', bleeds: 'bleeding', hemorrhagic: 'hemorrhage', fractured: 'fracture', fractures: 'fracture',
  fx: 'fracture', broken: 'fracture', tumour: 'tumor', tumours: 'tumor', oedema: 'edema', haematuria: 'hematuria',
  splenic: 'spleen', gastric: 'stomach', osseous: 'bone', bony: 'bone', ureteral: 'ureter', ovarian: 'ovary',
  febrile: 'fever', fevers: 'fever', pyrexia: 'fever', emesis: 'vomiting', vomit: 'vomiting', vomited: 'vomiting',
  nauseous: 'nausea', immunodeficiency: 'immunocompromised', immunosuppressed: 'immunocompromised',
  immunosuppression: 'immunocompromised', immunocompromise: 'immunocompromised', preop: 'preoperative',
  pathological: 'pathologic', cyclic: 'cyclical', twisted: 'twisting', twist: 'twisting', fell: 'fall', falls: 'fall',
  fallen: 'fall', falling: 'fall', worse: 'worsening', worsened: 'worsening', swollen: 'swelling', swelled: 'swelling',
  enlarged: 'enlarging', growing: 'enlarging', avn: 'osteonecrosis', osteonecrotic: 'osteonecrosis', cva: 'stroke',
  strokes: 'stroke', radiculopathies: 'radiculopathy', radicular: 'radiculopathy', myelopathic: 'myelopathy',
  parkinsons: 'parkinsonian', parkinson: 'parkinsonian', parkinsonism: 'parkinsonian', alzheimers: 'alzheimer',
  crohns: 'crohn', arthroplasties: 'arthroplasty', osteomyelitic: 'osteomyelitis', tendinopathy: 'tendon',
  tendinitis: 'tendon', tendonitis: 'tendon', tendons: 'tendon', women: 'female', woman: 'female', lady: 'female',
  girl: 'female', men: 'male', man: 'male', gentleman: 'male', boy: 'male', cancerous: 'cancer', malignancy: 'cancer',
  carcinoma: 'cancer', ca: 'cancer', neoplasm: 'tumor', neoplasms: 'tumor', gestations: 'gestation',
  pregnancies: 'pregnancy', bilat: 'bilateral', unilat: 'unilateral', ischaemia: 'ischemia', ischaemic: 'ischemic',
  anaemia: 'anemia', haemorrhage: 'hemorrhage', paediatric: 'pediatric', orthopnoea: 'orthopnea', dyspnoea: 'dyspnea',
  deteriorating: 'deterioration', deteriorate: 'deterioration', admitted: 'admission', hospitalization: 'admission',
  hospitalised: 'admission', hospitalized: 'admission', ribs: 'rib', colorectal: 'colon', hypotensive: 'hypotension',
  normotensive: 'normotension', limping: 'limp', diabetic: 'diabetes', diabetics: 'diabetes', incidentally: 'incidental',
  fibroid: 'fibroids', leiomyoma: 'fibroids', leiomyomas: 'fibroids', spinal: 'spine', axillary: 'axilla',
  dilated: 'dilation', dilatation: 'dilation', dilate: 'dilation', clinically: 'clinical', chemo: 'chemotherapy',
  flare: 'exacerbation', flares: 'exacerbation', murmurs: 'murmur',
  // Lay words no ACR scenario writes, read as the word ACR does write.
  swallowed: 'ingested', inhaled: 'aspirated', womb: 'uterus', windpipe: 'trachea', tracheal: 'trachea',
  collarbone: 'clavicle', narrowed: 'stenosis', narrowing: 'stenosis', nose: 'nasal',
};

// Phrases ACR writes two ways; both sides read the short one.
const TEXT_SYNONYMS = [
  ['abdominal aortic aneurysm', 'aaa'], ['deep vein thrombosis', 'dvt'], ['deep venous thrombosis', 'dvt'],
  ['transient ischemic attack', 'tia'], ['subarachnoid hemorrhage', 'sah'], ['urinary tract infection', 'uti'],
  ['urinary tract infections', 'uti'], ['coronary artery disease', 'cad'], ['benign prostatic hyperplasia', 'bph'],
  ['developmental dysplasia of the hip', 'ddh'], ['cervical cancer', 'cervix cancer'], ['low back', 'lowback back'],
  ['lower back', 'lowback back'], ['right lower quadrant', 'rlq'], ['left lower quadrant', 'llq'],
  ['right upper quadrant', 'ruq'], ['left upper quadrant', 'luq'], ['renovascular', 'renal vascular'],
  // A negative or normal radiograph is one idea ACR writes several ways, and
  // the one result word that picks a scenario branch.
  ['radiography negative', 'radiographynegative'], ['radiographs negative', 'radiographynegative'],
  ['negative radiography', 'radiographynegative'], ['negative radiographs', 'radiographynegative'],
  ['neg radiography', 'radiographynegative'], ['radiography normal', 'radiographynegative'],
  ['radiographs normal', 'radiographynegative'], ['normal radiographs', 'radiographynegative'],
  ['normal radiography', 'radiographynegative'], ['xray negative', 'radiographynegative'],
  ['negative xray', 'radiographynegative'], ['xray normal', 'radiographynegative'], ['normal xray', 'radiographynegative'],
  ['xrays negative', 'radiographynegative'], ['negative xrays', 'radiographynegative'], ['x ray negative', 'radiographynegative'],
  ['negative x ray', 'radiographynegative'], ['radiographs negative or equivocal', 'radiographynegative'],
  // Two ACR wordings for the unstable trauma patient.
  ['hemodynamically unstable', 'hypotension'], ['hemodynamically stable', 'normotension'],
  // ACR names say "hepatocellular cancer" and "cirrhotic" where the clinician
  // writes HCC and cirrhosis, and files cirrhosis under chronic liver disease.
  ['hepatocellular cancer', 'hcc'], ['hepatocellular carcinoma', 'hcc'], ['cirrhotic', 'liver disease chronic'],
  ['vesicoureteral reflux', 'vur'],
];

// Clinician shorthand and lay terms -> the wording ACR uses. Sorted longest
// first below, so a longer phrase wins over a shorter one inside it, and the
// output of one alias is never read again by another. Written by hand and
// verified against scenario names; the mined table (js/aliases-mined.js) is
// merged in after it, and a hand-written phrase always wins over a mined one.
const HAND_ALIASES = [
  // red flags
  ['with red flags', ''], ['and red flags', ''], ['red flags present', ''], ['positive red flags', ''],
  ['red flag symptoms', ''], ['red flag features', ''],
  // trauma mechanisms
  ['fall from height', 'major blunt trauma fall'], ['fall from ladder', 'major blunt trauma fall'],
  ['fall from roof', 'major blunt trauma fall'], ['fall down stairs', 'blunt trauma fall'],
  ['ground level fall', 'low velocity trauma fall'], ['fall from standing', 'low velocity trauma fall'],
  ['mechanical fall', 'low velocity trauma fall'], ['low energy fall', 'low velocity trauma fall'],
  ['minor fall', 'low velocity trauma fall'], ['fall from couch', 'fall'], ['fall off couch', 'fall'],
  ['fall from bed', 'fall'], ['fall off bed', 'fall'], ['fall from chair', 'fall'], ['fall off chair', 'fall'],
  ['fall from sofa', 'fall'], ['fell off', 'fall'], ['fall on outstretched hand', 'wrist trauma fall'],
  ['fall onto outstretched hand', 'wrist trauma fall'], ['fall on an outstretched hand', 'wrist trauma fall'],
  ['foosh', 'wrist trauma fall'], ['motor vehicle collision', 'blunt trauma'], ['motor vehicle accident', 'blunt trauma'],
  ['motor vehicle crash', 'blunt trauma'], ['car accident', 'blunt trauma'], ['car crash', 'blunt trauma'],
  ['motorcycle crash', 'blunt trauma'], ['motorcycle accident', 'blunt trauma'], ['mvc', 'blunt trauma'],
  ['mva', 'blunt trauma'], ['blunt abdominal trauma', 'major blunt trauma ~abdomen'], ['blunt torso trauma', 'major blunt trauma'],
  ['polytrauma', 'major blunt trauma'], ['multitrauma', 'major blunt trauma'], ['multi trauma', 'major blunt trauma'],
  ['pan scan', 'major blunt trauma'], ['panscan', 'major blunt trauma'], ['trauma activation', 'major blunt trauma'],
  ['atls', 'major blunt trauma'], ['seat belt sign', 'major blunt trauma bowel'], ['seatbelt sign', 'major blunt trauma bowel'],
  ['splenic laceration', 'major blunt trauma ~abdomen'], ['splenic injury', 'major blunt trauma ~abdomen'],
  ['liver laceration', 'major blunt trauma ~abdomen'],
  ['gunshot wound', 'penetrating ballistic'], ['gunshot', 'penetrating ballistic'], ['gsw', 'penetrating ballistic'],
  ['stab wound', 'penetrating'], ['stabbed', 'penetrating'], ['stabbing injury', 'penetrating'], ['knife wound', 'penetrating'],
  ['penetrating abdominal trauma', 'penetrating trauma abdomen pelvis'],
  ['shoulder trauma', 'shoulder pain acute'], ['shoulder injury', 'shoulder pain acute'],
  ['elbow trauma', 'elbow pain acute fracture'], ['elbow injury', 'elbow pain acute fracture'],
  ['hip trauma', 'hip pain acute traumatic'], ['hip injury', 'hip pain acute traumatic'],
  ['groin trauma', 'hip pain acute traumatic'], ['groin injury', 'hip pain acute traumatic'],
  ['hip fracture', 'hip pain acute traumatic fracture'], ['femoral neck fracture', 'hip pain acute traumatic fracture'],
  ['ankle sprain', 'ankle trauma'], ['sprained ankle', 'ankle trauma'], ['ankle injury', 'ankle trauma'],
  ['ankle fracture', 'ankle trauma fracture'], ['foot fracture', 'foot trauma fracture'],
  ['wrist fracture', 'wrist trauma fracture'], ['distal radius fracture', 'wrist trauma fracture'],
  ['colles fracture', 'wrist trauma fracture'], ['scaphoid fracture', 'wrist trauma fracture'],
  ['boxer fracture', 'hand trauma fracture'], ['boxers fracture', 'hand trauma fracture'], ['hand fracture', 'hand trauma fracture'],
  ['metacarpal fracture', 'hand trauma fracture'], ['finger fracture', 'hand trauma fracture'],
  ['toddler fracture', 'fracture tibia'], ['tendon rupture', 'tendon abnormality'], ['tendon tear', 'tendon abnormality'],
  ['achilles tendon rupture', 'ankle tendon abnormality'], ['achilles rupture', 'ankle tendon abnormality'],
  ['achilles tendon tear', 'ankle tendon abnormality'], ['achilles tendon', 'ankle tendon'], ['achilles', 'ankle tendon'],
  ['head strike', 'head trauma'], ['hit head', 'head trauma'],
  ['hit her head', 'head trauma'], ['hit his head', 'head trauma'], ['struck head', 'head trauma'], ['head injury', 'head trauma'],
  ['traumatic brain injury', 'head trauma'], ['tbi', 'head trauma'], ['minor head injury', 'head trauma mild'],
  ['mild head injury', 'head trauma mild'], ['minor head trauma', 'head trauma mild'], ['concussion', 'head trauma mild'],
  ['after head trauma', 'post traumatic'], ['after head injury', 'post traumatic'], ['post traumatic headache', 'headache post traumatic'],
  ['loss of consciousness', 'loc'], ['whiplash', 'cervical spine trauma'],
  ['abusive head trauma', 'physical abuse'], ['shaken', 'physical abuse'],
  ['nonaccidental trauma', 'physical abuse'], ['non accidental trauma', 'physical abuse'],
  ['non accidental injury', 'physical abuse'], ['nonaccidental injury', 'physical abuse'], ['child abuse', 'physical abuse'],
  ['nat', 'physical abuse'],
  // spine
  ['saddle anesthesia', 'cauda equina'], ['saddle anaesthesia', 'cauda equina'], ['cauda equina syndrome', 'cauda equina'],
  ['spinal cord compression', 'myelopathy'], ['cord compression', 'myelopathy'], ['cord signal', 'myelopathy'],
  ['epidural abscess', 'spine infection'], ['discitis', 'spine infection'], ['spondylodiscitis', 'spine infection'],
  ['vertebral osteomyelitis', 'spine infection'], ['spinal osteomyelitis', 'spine infection'],
  ['spinal infection', 'spine infection'], ['vertebral osteo', 'spine infection'],
  ['spinal stenosis', 'low back pain radiculopathy'], ['herniated disc', 'low back pain radiculopathy'],
  ['herniated disk', 'low back pain radiculopathy'], ['disc herniation', 'low back pain radiculopathy'],
  ['disk herniation', 'low back pain radiculopathy'], ['sciatica', 'low back pain radiculopathy'],
  ['lumbar radiculopathy', 'low back pain radiculopathy'], ['radiating to the leg', 'radiculopathy'],
  ['radiating to leg', 'radiculopathy'], ['radiating down the leg', 'radiculopathy'], ['radiating down leg', 'radiculopathy'],
  ['radiates to the leg', 'radiculopathy'], ['radiates to leg', 'radiculopathy'], ['radiates down the leg', 'radiculopathy'],
  ['radiating into the leg', 'radiculopathy'], ['shooting pain down the leg', 'radiculopathy'],
  ['shooting pain down leg', 'radiculopathy'], ['leg pain radiating', 'radiculopathy'], ['arm numbness', 'radiculopathy'],
  ['arm tingling', 'radiculopathy'], ['radiating to the arm', 'radiculopathy'], ['radiating to arm', 'radiculopathy'],
  ['radiating down the arm', 'radiculopathy'], ['radiating down arm', 'radiculopathy'],
  ['neck pain', 'cervical pain'], ['cervical radiculopathy', 'cervical pain radiculopathy'],
  ['lbp', 'low back pain'], ['upper back pain', 'thoracic back pain'], ['mid back pain', 'thoracic back pain'],
  ['midback pain', 'thoracic back pain'], ['c spine', 'cervical spine'], ['cspine', 'cervical spine'], ['l spine', 'lumbar spine'],
  ['lspine', 'lumbar spine'], ['t spine', 'thoracic spine'], ['tspine', 'thoracic spine'],
  ['compression fracture', 'vertebral compression fracture'], ['spondylolysis', 'lumbar spine pain repetitive activity'],
  ['ankylosing spondylitis', 'inflammatory back pain axial spondyloarthritis'], ['axial spondyloarthritis', 'inflammatory back pain axial spondyloarthritis'],
  ['spondyloarthropathy', 'inflammatory back pain axial spondyloarthritis'], ['sacroiliitis', 'inflammatory back pain axial spondyloarthritis'],
  ['lumbar fusion', 'prior lumbar surgery'], ['laminectomy', 'prior lumbar surgery'], ['discectomy', 'prior lumbar surgery'],
  ['failed back surgery', 'low back pain prior lumbar surgery'], ['post laminectomy', 'low back pain prior lumbar surgery'],
  ['insufficiency fracture', 'stress fracture'],
  // neuro
  ['worst headache of my life', 'headache severe sudden'], ['worst headache of life', 'headache severe sudden'],
  ['worst headache of her life', 'headache severe sudden'], ['worst headache of his life', 'headache severe sudden'],
  ['worst headache', 'headache severe sudden'], ['thunderclap headache', 'headache severe sudden'],
  ['thunderclap', 'headache severe sudden'], ['sudden onset severe headache', 'headache severe sudden'],
  ['sudden severe headache', 'headache severe sudden'], ['acute severe headache', 'headache severe sudden'],
  ['headache with fever', 'headache fever'], ['headache and fever', 'headache fever'], ['photophobia', ''],
  ['migraine with aura', 'migraine'], ['migraine without aura', 'migraine'], ['migraine headache', 'migraine'],
  ['tension headache', 'headache tension type'], ['tension type headache', 'headache tension type'],
  ['cluster headache', 'headache trigeminal autonomic'], ['cluster headaches', 'headache trigeminal autonomic'],
  ['post lp headache', 'headache intracranial hypotension dural puncture'], ['post lumbar puncture headache', 'headache intracranial hypotension dural puncture'],
  ['post dural puncture headache', 'headache intracranial hypotension dural puncture'], ['spinal headache', 'headache intracranial hypotension dural puncture'],
  ['positional headache', 'headache intracranial hypotension'], ['orthostatic headache', 'headache intracranial hypotension'],
  ['pseudotumor cerebri', 'headache intracranial hypertension'], ['idiopathic intracranial hypertension', 'headache intracranial hypertension'],
  ['iih', 'headache intracranial hypertension'], ['visual changes', 'visual'], ['vision changes', 'visual'],
  ['blurry vision', 'visual'], ['blurred vision', 'visual'], ['double vision', 'visual'], ['ha', 'headache'],
  ['transient ischemic attack', 'tia'], ['mini stroke', 'tia'], ['ministroke', 'tia'],
  ['wake up stroke', 'stroke'], ['wakeup stroke', 'stroke'], ['code stroke', 'stroke'], ['stroke alert', 'stroke'],
  ['stroke code', 'stroke'], ['last seen well', 'stroke'], ['lsw', 'stroke'], ['large vessel occlusion', 'stroke'],
  ['lvo', 'stroke'], ['cerebrovascular accident', 'stroke'], ['brain attack', 'stroke'],
  ['facial droop', 'stroke focal neuro deficit'], ['face droop', 'stroke focal neuro deficit'], ['facial drooping', 'stroke focal neuro deficit'],
  ['slurred speech', 'stroke focal neuro deficit'], ['aphasia', 'stroke focal neuro deficit'], ['dysarthria', 'stroke focal neuro deficit'],
  ['hemiparesis', 'stroke focal neuro deficit'], ['hemiplegia', 'stroke focal neuro deficit'],
  ['right sided weakness', 'stroke focal neuro deficit'], ['left sided weakness', 'stroke focal neuro deficit'],
  ['right side weakness', 'stroke focal neuro deficit'], ['left side weakness', 'stroke focal neuro deficit'],
  ['sided weakness', 'stroke focal neuro deficit'], ['one sided weakness', 'stroke focal neuro deficit'],
  ['unilateral weakness', 'stroke focal neuro deficit'], ['weakness on one side', 'stroke focal neuro deficit'],
  ['right arm weakness', 'stroke focal neuro deficit'], ['left arm weakness', 'stroke focal neuro deficit'],
  ['arm weakness', 'stroke focal neuro deficit'], ['focal neurologic deficit', 'focal neuro deficit'],
  ['focal neurological deficit', 'focal neuro deficit'], ['neurologic deficit', 'neuro deficit'],
  ['neurological deficit', 'neuro deficit'],
  ['intracranial hemorrhage', 'intraparenchymal hemorrhage'], ['intracerebral hemorrhage', 'intraparenchymal hemorrhage'],
  ['ich', 'intraparenchymal hemorrhage'], ['brain bleed', 'intraparenchymal hemorrhage'], ['brain hemorrhage', 'intraparenchymal hemorrhage'],
  ['hemorrhagic stroke', 'intraparenchymal hemorrhage'], ['brain aneurysm', 'cerebral aneurysm'],
  ['cerebral venous thrombosis', 'venous sinus thrombosis'], ['cerebral venous sinus thrombosis', 'venous sinus thrombosis'],
  ['dural sinus thrombosis', 'venous sinus thrombosis'], ['cvst', 'venous sinus thrombosis'], ['cvt', 'venous sinus thrombosis'],
  ['vertebral artery dissection', 'cervical vascular dissection'], ['carotid artery dissection', 'cervical vascular dissection'],
  ['carotid dissection', 'cervical vascular dissection'], ['vertebral dissection', 'cervical vascular dissection'],
  ['cervical artery dissection', 'cervical vascular dissection'], ['cervical dissection', 'cervical vascular dissection'],
  ['neck dissection', 'cervical vascular dissection'], ['blunt cerebrovascular injury', 'cervical vascular injury'],
  ['carotid bruit', 'cervical bruit'], ['altered ms', 'altered mental status'],
  ['ams', 'altered mental status'], ['confusion', 'altered mental status'], ['confused', 'altered mental status'],
  ['delirium', 'altered mental status'], ['encephalopathy', 'altered mental status'], ['memory loss', 'memory deficits'],
  ['memory problems', 'memory deficits'], ['memory impairment', 'memory deficits'], ['forgetfulness', 'memory deficits'],
  ['forgetful', 'memory deficits'], ['nph', 'normal pressure hydrocephalus'], ['status epilepticus', 'seizure'],
  ['breakthrough seizure', 'seizure disorder change'], ['first seizure', 'seizure new'], ['first time seizure', 'seizure new'],
  ['new onset seizure', 'seizure new'], ['first time', ''], ['first episode', ''], ['first presentation', ''],
  ['passing out', 'syncope'], ['passed out', 'syncope'], ['fainting', 'syncope'], ['fainted', 'syncope'], ['blackout', 'syncope'],
  ['lightheaded', 'dizziness'], ['light headed', 'dizziness'], ['lightheadedness', 'dizziness'],
  ['room spinning', 'vertigo'], ['bppv', 'vertigo episodic head movements'], ['benign paroxysmal positional vertigo', 'vertigo episodic head movements'],
  ['trouble walking', 'ataxia'], ['unsteady gait', 'ataxia'], ['gait instability', 'ataxia'], ['unsteadiness', 'ataxia'],
  ['multiple sclerosis', 'demyelinating disease cns'], ['ms', 'demyelinating disease cns'],
  ['bells palsy', 'bell palsy'], ['bell s palsy', 'bell palsy'], ['facial palsy', 'facial weakness'],
  ['ringing in the ears', 'tinnitus'], ['ringing in ears', 'tinnitus'], ['ear ringing', 'tinnitus'], ['deafness', 'hearing loss'],
  ['brain mets', 'head tumor met'], ['brain metastases', 'head tumor met'], ['brain metastasis', 'head tumor met'],
  ['brain mass', 'head tumor'], ['brain lesion', 'head tumor'], ['brain cancer', 'head tumor'], ['glioma', 'head tumor primary'],
  ['glioblastoma', 'head tumor primary'], ['gbm', 'head tumor primary'], ['meningioma', 'head tumor primary'],
  ['pituitary tumor', 'pituitary adenoma'], ['pituitary mass', 'pituitary adenoma'], ['sellar mass', 'pituitary adenoma'],
  ['alzheimer disease', 'alzheimer'], ['alzheimers disease', 'alzheimer'], ['early alzheimer', 'alzheimer'],
  ['cjd', 'creutzfeld jakob'], ['creutzfeldt jakob', 'creutzfeld jakob'],
  // head and neck
  ['sinus infection', 'sinusitis'], ['acute sinusitis', 'sinusitis acute uncomplicated'], ['chronic sinusitis', 'sinusitis chronic'],
  ['orbital complication', 'orbital complications'], ['ear infection', 'otitis'], ['malignant otitis externa', 'otitis externa complicated'],
  ['necrotizing otitis externa', 'otitis externa complicated'], ['swimmers ear', 'otitis externa'],
  ['mastoiditis', 'otitis media mastoid'], ['hoarseness', 'vocal cord paralysis'], ['hoarse voice', 'vocal cord paralysis'],
  ['neck lump', 'cervical mass'], ['lump in the neck', 'cervical mass'], ['lump in neck', 'cervical mass'], ['lump on neck', 'cervical mass'],
  ['lump on the neck', 'cervical mass'], ['lump under jaw', 'cervical mass'], ['lump under the jaw', 'cervical mass'],
  ['neck swelling', 'cervical mass'], ['goitre', 'goiter'], ['enlarged thyroid', 'goiter'], ['hyperthyroidism', 'thyrotoxicosis'],
  ['hyperthyroid', 'thyrotoxicosis'], ['graves disease', 'thyrotoxicosis'], ['hypothyroid', 'hypothyroidism'],
  ['thyroid eye disease', 'orbit thyroid'],
  ['periorbital cellulitis', 'periorbital infection'], ['preseptal cellulitis', 'periorbital infection'],
  ['orbital cellulitis', 'orbital cellulitis'], ['cellulitis', 'soft tissue infection'], ['necrotizing fasciitis', 'soft tissue infection necrotizing fasciitis'],
  ['nec fasc', 'soft tissue infection necrotizing fasciitis'], ['mandible fracture', 'mandibular fracture'], ['jaw fracture', 'mandibular fracture'],
  ['broken jaw', 'mandibular fracture'], ['facial fracture', 'facial trauma'], ['nasal fracture', 'facial trauma'],
  ['orbital fracture', 'orbital trauma'], ['foreign body aspiration', 'aspirated foreign body'],
  ['aspirated coin', 'aspirated foreign body'], ['swallowed coin', 'ingested foreign body'], ['swallowed battery', 'ingested foreign body'],
  ['swallowed foreign body', 'ingested foreign body'], ['foreign body ingestion', 'ingested foreign body'],
  // chest
  ['sob', 'dyspnea'], ['shortness of breath', 'dyspnea'], ['short of breath', 'dyspnea'], ['breathlessness', 'dyspnea'],
  ['breathless', 'dyspnea'], ['trouble breathing', 'dyspnea'], ['difficulty breathing', 'dyspnea'],
  ['dyspnea on exertion', 'dyspnea exertional'], ['doe', 'dyspnea exertional'], ['acute dyspnea', 'dyspnea acute'],
  ['coughing up blood', 'hemoptysis'], ['coughing blood', 'hemoptysis'], ['blood in sputum', 'hemoptysis'],
  ['bloody sputum', 'hemoptysis'], ['productive cough', 'cough'], ['rigors', 'fever'], ['chills', 'fever'],
  ['infiltrate on chest xray', 'pneumonia'], ['infiltrate on cxr', 'pneumonia'], ['infiltrate', 'pneumonia'],
  ['consolidation', 'pneumonia'], ['community acquired pneumonia', 'pneumonia'], ['cap', 'pneumonia'],
  ['pneumonia not improving', 'pneumonia not responding'], ['pneumonia not resolving', 'pneumonia not responding'],
  ['nonresolving pneumonia', 'pneumonia not responding'], ['febrile neutropenia', 'fever neutropenia'],
  ['neutropenic fever', 'fever neutropenia'], ['ptx', 'pneumothorax'], ['collapsed lung', 'pneumothorax'],
  ['pulmonary embolus', 'pulmonary embolism'], ['pulmonary emboli', 'pulmonary embolism'], ['pe', 'pulmonary embolism'],
  ['ctpa', 'pulmonary embolism'], ['vq scan', 'pulmonary embolism'], ['v q scan', 'pulmonary embolism'],
  ['saddle embolus', 'saddle pulmonary embolism'], ['saddle pe', 'saddle pulmonary embolism'],
  ['massive pe', 'pulmonary embolism acute hypotension'], ['submassive pe', 'pulmonary embolism acute right heart'],
  ['blood clot in the lung', 'pulmonary embolism'], ['blood clot in lung', 'pulmonary embolism'], ['lung clot', 'pulmonary embolism'],
  ['pulmonary hypertension', 'lung hypertension'], ['pulmonary htn', 'lung hypertension'],
  ['interstitial lung disease', 'diffuse lung disease'], ['ild', 'diffuse lung disease'], ['pulmonary fibrosis', 'diffuse lung disease'],
  ['idiopathic pulmonary fibrosis', 'diffuse lung disease'], ['ipf', 'diffuse lung disease'],
  ['solitary pulmonary nodule', 'lung nodule solitary'], ['spn', 'lung nodule solitary'], ['lung spot', 'lung nodule'],
  ['spot on lung', 'lung nodule'], ['spot on the lung', 'lung nodule'], ['spot on xray', 'lung nodule'],
  ['lung lesion', 'lung nodule'], ['lung mass', 'lung nodule'], ['nsclc', 'lung cancer non small cell'],
  ['non small cell lung cancer', 'lung cancer non small cell'], ['small cell lung cancer', 'lung cancer small cell'],
  ['sclc', 'lung cancer small cell'], ['lung ca', 'lung cancer'], ['tb', 'tuberculosis'],
  ['costochondritis', 'chest wall pain'], ['musculoskeletal chest pain', 'chest wall pain'],
  ['pericarditis', 'pericardial disease'], ['pericardial effusion', 'pericardial disease'],
  ['cardiac tamponade', 'pericardial disease'], ['tamponade', 'pericardial disease'], ['cardiac tumor', 'cardiac mass'],
  ['heart tumor', 'cardiac mass'], ['heart mass', 'cardiac mass'], ['chf', 'heart failure'],
  ['congestive heart failure', 'heart failure'], ['chf exacerbation', 'heart failure'], ['pulmonary edema', 'heart failure'],
  ['mi', 'acute coronary syndrome'], ['myocardial infarction', 'acute coronary syndrome'], ['heart attack', 'acute coronary syndrome'],
  ['acs', 'acute coronary syndrome'], ['nstemi', 'acute coronary syndrome'], ['stemi', 'acute coronary syndrome'],
  ['unstable angina', 'acute coronary syndrome'], ['crushing chest pain', 'chest pain acute coronary syndrome'],
  ['chest pressure', 'chest pain acute coronary syndrome'], ['stable angina', 'chest pain chronic cad'],
  ['angina', 'chest pain cad'], ['chest pain on exertion', 'chest pain chronic cad'], ['chest pain with exertion', 'chest pain chronic cad'],
  ['exertional chest pain', 'chest pain chronic cad'], ['coronary calcium score', 'cad asymptomatic'],
  ['calcium score', 'cad asymptomatic'], ['calcium scoring', 'cad asymptomatic'], ['cac score', 'cad asymptomatic'],
  ['tearing chest pain', 'chest pain acute aortic syndrome'], ['ripping chest pain', 'chest pain acute aortic syndrome'],
  ['chest pain radiating to back', 'chest pain acute aortic syndrome'], ['tearing pain', 'acute aortic syndrome'],
  ['chest and back pain tearing', 'chest pain acute aortic syndrome'], ['tearing chest and back pain', 'chest pain acute aortic syndrome'],
  ['chest back pain', 'chest pain acute aortic syndrome'], ['radiating to back', ''], ['radiating to the back', ''],
  ['radiates to back', ''], ['chest dissection', 'acute aortic syndrome'],
  ['thoracic dissection', 'acute aortic syndrome'], ['type b dissection', 'thoracic aortic dissection'],
  ['type a dissection', 'acute aortic syndrome'], ['blood pressure differential', ''], ['pulse deficit', ''],
  ['high blood pressure', 'hypertension'], ['elevated blood pressure', 'hypertension'], ['low blood pressure', 'hypotension'],
  ['taa', 'thoracic aortic aneurysm'],
  ['pre op', 'preoperative'], ['pre operative', 'preoperative'], ['pre procedure', 'preprocedure'],
  ['pre surgical', 'preoperative'], ['presurgical', 'preoperative'], ['low dose ct screening', 'lung cancer screening'],
  // vascular
  ['peripheral arterial disease', 'claudication'], ['peripheral artery disease', 'claudication'],
  ['peripheral vascular disease', 'claudication'], ['pad', 'claudication'], ['pvd', 'claudication'],
  ['leg pain when walking', 'claudication'], ['leg pain with walking', 'claudication'], ['leg pain on walking', 'claudication'],
  ['pain when walking', 'claudication'], ['pain with walking', 'claudication'], ['calf pain when walking', 'claudication'],
  ['calf pain with walking', 'claudication'], ['exertional leg pain', 'claudication'],
  ['acute limb ischemia', 'cold painful leg vascular compromise'], ['limb ischemia', 'cold painful leg vascular compromise'],
  ['pulseless leg', 'cold painful pulseless leg'], ['cold leg', 'cold painful leg'], ['leg clot', 'lower extremity dvt'],
  ['blood clot in the leg', 'lower extremity dvt'], ['blood clot in leg', 'lower extremity dvt'], ['blood clot leg', 'lower extremity dvt'],
  ['calf pain and swelling', 'lower extremity dvt'], ['calf swelling and pain', 'lower extremity dvt'],
  ['leg pain and swelling', 'lower extremity dvt'], ['leg swelling and pain', 'lower extremity dvt'],
  ['calf pain swelling', 'lower extremity dvt'], ['leg swelling', 'lower extremity dvt'], ['swollen leg', 'lower extremity dvt'],
  ['calf swelling', 'lower extremity dvt'], ['swollen calf', 'lower extremity dvt'], ['calf pain', 'lower extremity dvt'],
  ['arm swelling', 'upper extremity dvt'], ['swollen arm', 'upper extremity dvt'], ['calf', 'lower extremity'],
  ['arm', 'upper extremity'], ['chronic venous insufficiency', 'chronic venous disease'], ['venous insufficiency', 'chronic venous disease'],
  ['venous stasis', 'chronic venous disease'], ['renal artery stenosis', 'hypertension renal vascular'],
  ['renovascular hypertension', 'hypertension renal vascular'], ['renovascular', 'renal vascular'],
  ['ruptured aaa', 'pulsatile abdomen mass aaa'], ['ruptured aneurysm', 'pulsatile abdomen mass aaa'],
  ['pulsatile abdominal mass', 'pulsatile abdomen mass aaa'], ['known aaa', 'aaa surveillance'], ['endoleak', 'aaa post repair'],
  ['after evar', 'post repair'], ['post evar', 'post repair'], ['ischemic colitis', 'mesenteric ischemia'],
  ['ischemic bowel', 'mesenteric ischemia'], ['postprandial pain', 'mesenteric ischemia chronic'],
  ['weight loss', ''], ['night sweats', ''],
  ['avm', 'arteriovenous malformation'], ['pavm', 'lung arteriovenous malformation'],
  // abdomen and pelvis
  ['sbo', 'small bowel obstruction'], ['obstipation', 'small bowel obstruction'], ['no flatus', 'small bowel obstruction'],
  ['abdominal distension', 'small bowel obstruction'], ['distended abdomen', 'small bowel obstruction'],
  ['abdominal distention', 'small bowel obstruction'], ['distension', ''], ['distention', ''],
  ['incarcerated hernia', 'groin hernia'],
  ['strangulated hernia', 'groin hernia'], ['inguinal hernia', 'groin hernia'],
  ['appy', 'appendicitis'], ['acute appendicitis', 'appendicitis'], ['right sided abdominal pain', 'rlq pain'],
  ['right side abdominal pain', 'rlq pain'], ['right lower quadrant pain', 'rlq pain'], ['right lower quadrant', 'rlq'],
  ['left lower quadrant pain', 'llq pain'], ['left lower quadrant', 'llq'], ['right upper quadrant pain', 'ruq pain'],
  ['right upper quadrant', 'ruq'], ['left upper quadrant pain', 'luq pain'], ['left upper quadrant', 'luq'],
  ['left sided abdominal pain', 'llq pain'], ['left side abdominal pain', 'llq pain'], ['lower abdominal pain', 'pelvis pain'],
  ['upper abdominal pain', 'epigastric pain'], ['stomach pain', 'abdomen pain'], ['stomach ache', 'abdomen pain'],
  ['pain after fatty meal', 'ruq pain biliary disease'], ['pain after eating', 'abdomen pain postprandial'],
  ['acalculous cholecystitis', 'acalculous cholecystitis'], ['acute cholecystitis', 'ruq pain biliary disease'],
  ['cholecystitis', 'ruq pain biliary disease'], ['biliary colic', 'ruq pain biliary disease'],
  ['gallstones', 'ruq pain biliary disease'], ['gallstone', 'ruq pain biliary disease'], ['cholelithiasis', 'ruq pain biliary disease'],
  ['gallbladder', 'ruq pain biliary disease'], ['hida scan', 'ruq pain biliary disease'], ['hida', 'ruq pain biliary disease'],
  ['chole', 'ruq pain biliary disease'], ['choledocholithiasis', 'jaundice biliary obstruction'],
  ['cholangitis', 'jaundice biliary obstruction'], ['biliary obstruction', 'jaundice biliary obstruction'],
  ['obstructive jaundice', 'jaundice biliary obstruction'], ['painless jaundice', 'jaundice'], ['yellow eyes', 'jaundice'],
  ['yellow skin', 'jaundice'], ['icterus', 'jaundice'], ['elevated bilirubin', 'hyperbilirubinemia'],
  ['high bilirubin', 'hyperbilirubinemia'], ['elevated lfts', 'abnormal liver function tests'], ['abnormal lfts', 'abnormal liver function tests'],
  ['lfts', 'abnormal liver function tests'], ['elevated lft', 'abnormal liver function tests'], ['abnormal lft', 'abnormal liver function tests'],
  ['transaminitis', 'abnormal liver function tests'], ['elevated transaminases', 'abnormal liver function tests'],
  ['elevated alk phos', 'alkaline phosphatase'], ['alk phos', 'alkaline phosphatase'], ['liver mass', 'liver lesion'],
  ['hepatic hemangioma', 'liver lesion'], ['liver hemangioma', 'liver lesion'],
  ['liver mets', 'liver met'], ['liver metastases', 'liver met'], ['hepatic metastases', 'liver met'],
  ['cirrhosis', 'liver disease chronic'], ['cirrhotic', 'liver disease chronic'], ['hepatocellular carcinoma', 'hcc'],
  ['liver cancer', 'hcc'], ['pancreatic cancer', 'pancreas ductal adenocarcinoma'], ['pancreatic adenocarcinoma', 'pancreas ductal adenocarcinoma'],
  ['pancreatic mass', 'pancreas ductal adenocarcinoma'], ['pancreatic cyst', 'pancreas cyst'], ['ipmn', 'pancreas cyst'],
  ['pancreatic net', 'pancreas neuroendocrine tumor'], ['pnet', 'pancreas neuroendocrine tumor'],
  ['kidney stones', 'flank pain stone disease'], ['kidney stone', 'flank pain stone disease'], ['renal stones', 'flank pain stone disease'],
  ['renal stone', 'flank pain stone disease'], ['ureteral stone', 'flank pain stone disease'], ['ureteric stone', 'flank pain stone disease'],
  ['renal colic', 'flank pain stone disease'], ['ureteric colic', 'flank pain stone disease'], ['nephrolithiasis', 'flank pain stone disease'],
  ['ureterolithiasis', 'flank pain stone disease'], ['flank pain hematuria', 'flank pain stone disease'],
  ['pyelo', 'pyelonephritis'], ['complicated uti', 'pyelonephritis complicated'], ['bladder infection', 'uti'],
  ['kidney mass', 'renal mass'], ['renal cyst', 'renal mass'],
  ['kidney cyst', 'renal mass'], ['bosniak', 'renal mass'], ['rcc', 'renal cell carcinoma'],
  ['adrenal incidentaloma', 'adrenal mass'], ['adrenal adenoma', 'adrenal mass'], ['adrenal nodule', 'adrenal mass'], ['adrenal lesion', 'adrenal mass'],
  ['incidentaloma', 'mass incidental'], ['pheochromocytoma', 'adrenal mass'], ['pheo', 'adrenal mass'],
  ['elevated psa', 'prostate cancer suspected no prior biopsy'], ['high psa', 'prostate cancer suspected no prior biopsy'],
  ['rising psa', 'prostate cancer suspected no prior biopsy'], ['psa', 'prostate cancer'],
  ['prostate enlargement', 'bph'], ['enlarged prostate', 'bph'], ['lower urinary tract symptoms', 'bph'], ['luts', 'bph'],
  ['gi bleed', 'gi bleeding'], ['melena', 'upper gi bleeding'], ['black tarry stools', 'upper gi bleeding'], ['tarry stools', 'upper gi bleeding'],
  ['black stools', 'upper gi bleeding'], ['hematemesis', 'upper gi bleeding'], ['coffee ground emesis', 'upper gi bleeding'],
  ['vomiting blood', 'upper gi bleeding'], ['upper gi bleed', 'upper gi bleeding'], ['ugib', 'upper gi bleeding'],
  ['blood in stool', 'lower gi bleeding'], ['bloody stool', 'lower gi bleeding'], ['bloody stools', 'lower gi bleeding'],
  ['brbpr', 'lower gi bleeding'], ['hematochezia', 'lower gi bleeding'], ['rectal bleeding', 'lower gi bleeding'],
  ['lower gi bleed', 'lower gi bleeding'], ['lgib', 'lower gi bleeding'], ['colonoscopy', 'colorectal cancer screening'],
  ['colon cancer screening', 'colorectal cancer screening'],
  ['inflammatory bowel disease', 'crohn disease'], ['ibd', 'crohn disease'], ['crohn flare', 'crohn disease acute exacerbation'],
  ['crohns flare', 'crohn disease acute exacerbation'], ['crohn disease flare', 'crohn disease acute exacerbation'],
  ['uc', 'ulcerative colitis'], ['gastric bypass', 'bariatric procedure'],
  ['sleeve gastrectomy', 'bariatric procedure'], ['bariatric surgery', 'bariatric procedure'], ['post bariatric', 'bariatric procedure'],
  ['gerd', 'acid reflux'], ['heartburn', 'acid reflux'], ['nec', 'necrotizing enterocolitis'],
  ['pyloric stenosis', 'hypertrophic pyloric stenosis'], ['projectile vomiting', 'vomiting nonbilious hypertrophic pyloric stenosis'],
  ['bilious emesis', 'vomiting bilious'], ['fever of unknown origin', 'fever unknown origin'],
  ['fuo', 'fever unknown origin'], ['fever without a source', 'fever without source'], ['fever no source', 'fever without source'],
  ['sepsis unknown source', 'sepsis unknown origin'], ['sepsis no source', 'sepsis unknown origin'],
  ['septic shock', 'sepsis'], ['retroperitoneal hematoma', 'retroperitoneal bleed'], ['retroperitoneal hemorrhage', 'retroperitoneal bleed'],
  // gynecology and obstetrics
  ['ovarian torsion', 'pelvis pain gynecological'], ['adnexal torsion', 'pelvis pain gynecological'],
  ['ovary torsion', 'pelvis pain gynecological'], ['pelvic inflammatory disease', 'pelvis pain gynecological'],
  ['pid', 'pelvis pain gynecological'], ['tubo ovarian abscess', 'pelvis pain gynecological'],
  ['tuboovarian abscess', 'pelvis pain gynecological'], ['toa', 'pelvis pain gynecological'], ['ovarian cyst', 'adnexal mass'],
  ['ovarian mass', 'adnexal mass'], ['ovarian lesion', 'adnexal mass'], ['adnexal cyst', 'adnexal mass'],
  ['ruptured ectopic', 'first trimester vaginal bleeding'], ['ectopic', 'first trimester vaginal bleeding'],
  ['miscarriage', 'first trimester vaginal bleeding'], ['threatened abortion', 'first trimester vaginal bleeding'],
  ['threatened miscarriage', 'first trimester vaginal bleeding'], ['bleeding in early pregnancy', 'first trimester vaginal bleeding'],
  ['early pregnancy bleeding', 'first trimester vaginal bleeding'], ['first trimester bleeding', 'first trimester vaginal bleeding'],
  ['placental abruption', 'vaginal bleeding after first trimester painful'], ['abruption', 'vaginal bleeding after first trimester painful'],
  ['postpartum hemorrhage', 'peripartum hemorrhage'], ['pph', 'peripartum hemorrhage'],
  ['retained products of conception', 'peripartum hemorrhage'], ['retained products', 'peripartum hemorrhage'], ['rpoc', 'peripartum hemorrhage'],
  ['heavy menstrual bleeding', 'uterine bleeding abnormal'], ['menorrhagia', 'uterine bleeding abnormal'],
  ['heavy periods', 'uterine bleeding abnormal'], ['abnormal uterine bleeding', 'uterine bleeding abnormal'],
  ['aub', 'uterine bleeding abnormal'], ['postmenopausal bleeding', 'uterine bleeding abnormal ~postmenopausal'],
  ['bleeding after menopause', 'uterine bleeding abnormal ~postmenopausal'],
  ['spotting after menopause', 'uterine bleeding abnormal ~postmenopausal'],
  ['post menopausal', 'postmenopausal'], ['pre menopausal', 'premenopausal'], ['peri menopausal', 'perimenopausal'],
  ['twin pregnancy', 'multiple gestations'], ['twins', 'multiple gestations'], ['twin gestation', 'multiple gestations'],
  ['triplets', 'multiple gestations'], ['anatomy scan', 'fetal anomaly screening'], ['fetal anatomy survey', 'fetal anomaly screening'],
  ['small for gestational age', 'fetal growth restriction'], ['sga', 'fetal growth restriction'], ['iugr', 'fetal growth restriction'],
  ['intrauterine growth restriction', 'fetal growth restriction'], ['short cervix', 'gravid cervix'],
  ['cervical length', 'gravid cervix'], ['cervical insufficiency', 'gravid cervix'], ['preterm labor', 'gravid cervix preterm labor'],
  ['pcos', 'polycystic ovary syndrome'], ['leiomyoma', 'fibroids'], ['leiomyomas', 'fibroids'],
  // urology
  ['testicular torsion', 'scrotum pain acute'], ['testicular pain', 'scrotum pain'], ['scrotal pain', 'scrotum pain'],
  ['acute scrotum', 'scrotum pain acute'], ['epididymitis', 'scrotum pain'], ['orchitis', 'scrotum pain'],
  ['epididymo orchitis', 'scrotum pain'], ['testicular mass', 'scrotum abnormality palpable'], ['testicular lump', 'scrotum abnormality palpable'],
  ['scrotal mass', 'scrotum abnormality palpable'], ['scrotal lump', 'scrotum abnormality palpable'],
  ['scrotal swelling', 'scrotum abnormality palpable'], ['testicular swelling', 'scrotum abnormality palpable'],
  ['varicocele', 'scrotum abnormality palpable'], ['hydrocele', 'scrotum abnormality palpable'],
  ['spermatocele', 'scrotum abnormality palpable'], ['urinary retention', 'bph'],
  ['blood in urine', 'hematuria'], ['microscopic hematuria', 'microhematuria'], ['gross hematuria', 'hematuria gross'],
  ['painless hematuria', 'hematuria'], ['urothelial cancer', 'bladder cancer'],
  // musculoskeletal
  ['rotator cuff tear', 'shoulder pain rotator cuff'], ['rotator cuff', 'shoulder pain rotator cuff'],
  ['frozen shoulder', 'shoulder pain adhesive capsulitis'], ['adhesive capsulitis', 'shoulder pain adhesive capsulitis'],
  ['shoulder dislocation', 'shoulder pain acute dislocation'], ['dislocated shoulder', 'shoulder pain acute dislocation'],
  ['cant move arm', 'shoulder pain acute'], ['cannot move arm', 'shoulder pain acute'], ['unable to move arm', 'shoulder pain acute'],
  ['cant lift arm', 'shoulder pain'], ['cannot lift arm', 'shoulder pain'], ['unable to lift arm', 'shoulder pain'],
  ['cant raise arm', 'shoulder pain'], ['lift arm overhead', ''], ['lift arm', ''], ['raise arm', ''],
  ['meniscal tear', 'knee internal derangement'], ['meniscus tear', 'knee internal derangement'],
  ['torn meniscus', 'knee internal derangement'], ['acl tear', 'knee internal derangement'], ['torn acl', 'knee internal derangement'],
  ['acl injury', 'knee internal derangement'], ['ligament tear', 'internal derangement'], ['locking and catching', 'knee internal derangement'],
  ['knee locking', 'knee internal derangement'], ['knee giving way', 'knee internal derangement'], ['knee instability', 'knee internal derangement'],
  ['twisted knee', 'knee trauma twisting'], ['knee twisted', 'knee trauma twisting'], ['twisting injury', 'trauma twisting'],
  ['rheumatoid arthritis', 'inflammatory arthritis'], ['psoriatic arthritis', 'inflammatory arthritis'],
  ['gout', 'crystalline arthritis'], ['pseudogout', 'crystalline arthritis'], ['cppd', 'crystalline arthritis'],
  ['juvenile idiopathic arthritis', 'idiopathic arthritis'], ['jia', 'idiopathic arthritis'], ['juvenile arthritis', 'idiopathic arthritis'],
  ['avascular necrosis', 'osteonecrosis'], ['aseptic necrosis', 'osteonecrosis'],
  ['bone density', 'osteoporosis'], ['bone mineral density', 'osteoporosis'], ['dexa', 'osteoporosis'], ['dxa', 'osteoporosis'],
  ['osteopenia', 'osteoporosis'], ['bone mets', 'bone met'], ['bone metastases', 'bone met'], ['skeletal metastases', 'bone met'],
  ['osseous metastases', 'bone met'], ['bone lesion', 'bone tumor'], ['lytic lesion', 'bone tumor'],
  ['soft tissue sarcoma', 'soft tissue mass'], ['sarcoma', 'soft tissue mass'], ['lipoma', 'soft tissue mass'],
  ['soft tissue lump', 'soft tissue mass'], ['lump on thigh', 'soft tissue mass thigh'], ['lump on the thigh', 'soft tissue mass thigh'],
  ['hard lump', 'mass'], ['septic joint', 'septic arthritis'], ['joint infection', 'septic arthritis'],
  ['diabetic foot ulcer', 'foot diabetic osteomyelitis'], ['diabetic foot infection', 'foot diabetic osteomyelitis'],
  ['osteo', 'osteomyelitis'], ['bone infection', 'osteomyelitis'],
  ['refusal to bear weight', 'limp'], ['refuses to bear weight', 'limp'], ['refusing to bear weight', 'limp'],
  ['wont bear weight', 'limp'], ['will not bear weight', 'limp'], ['not bearing weight', 'limp'], ['limping', 'limp'],
  ['hip click', 'ddh'], ['developmental dysplasia', 'ddh'], ['hip dysplasia', 'ddh'],
  ['slipped capital femoral epiphysis', 'scfe'], ['total knee arthroplasty', 'knee arthroplasty'],
  ['total hip arthroplasty', 'hip arthroplasty'], ['knee replacement', 'knee arthroplasty'], ['hip replacement', 'hip arthroplasty'],
  ['shoulder replacement', 'shoulder arthroplasty'], ['tka', 'knee arthroplasty'], ['tha', 'hip arthroplasty'],
  ['heel pain', 'plantar heel pain'], ['plantar fasciitis', 'plantar heel pain'],
  // breast
  ['mammography screening', 'breast cancer screening'], ['screening mammography', 'breast cancer screening'],
  ['screening mammogram', 'breast cancer screening'], ['annual mammogram', 'breast cancer screening'],
  ['mammogram screening', 'breast cancer screening'], ['routine mammogram', 'breast cancer screening'],
  ['breast screening', 'breast cancer screening'], ['mammogram', 'breast cancer screening'], ['mammography', 'breast cancer screening'],
  ['brca', 'breast cancer screening pathogenic mutation'],
  ['breast lump', 'breast mass palpable'], ['lump in breast', 'breast mass palpable'], ['lump in the breast', 'breast mass palpable'],
  ['palpable breast mass', 'breast mass palpable'], ['mastitis', 'breast infection'],
  ['bloody nipple discharge', 'nipple discharge pathologic'], ['cyclic breast pain', 'breast pain cyclical'],
  ['cyclical breast pain', 'breast pain cyclical'], ['lump under arm', 'axillary lump'], ['lump under the arm', 'axillary lump'],
  ['underarm lump', 'axillary lump'], ['armpit lump', 'axillary lump'], ['armpit', 'axilla'], ['underarm', 'axilla'],
  // ACR files axillary nodes under the axillary lump; "adenopathy" only orders.
  ['axillary lymphadenopathy', 'axillary lump ~adenopathy'], ['axillary adenopathy', 'axillary lump ~adenopathy'],
  ['axillary lymph node', 'axillary lump ~adenopathy'], ['axillary lymph nodes', 'axillary lump ~adenopathy'],
  ['ductal carcinoma in situ', 'dcis'],
  ['breast implant', 'breast implant'],
  // ordering phrases that are not clinical
  ['of choice', ''], ['first line', ''], ['next step', ''], ['what next', ''], ['when to', ''], ['do i need', ''],
  ['is this normal', ''], ['pack year', ''], ['pack years', ''], ['former smoker', ''], ['ex smoker', ''],
  ['with picc', ''], ['picc line', ''],
  // two complaints ACR files as one presentation
  ['cough and fever', 'acute respiratory illness'], ['fever and cough', 'acute respiratory illness'],
  ['cough with fever', 'acute respiratory illness'], ['fever with cough', 'acute respiratory illness'],
  ['cough fever', 'acute respiratory illness'], ['fever cough', 'acute respiratory illness'],
  ['leg pain and back pain', 'low back pain radiculopathy'], ['back pain and leg pain', 'low back pain radiculopathy'],
  ['back and leg pain', 'low back pain radiculopathy'],
  ['jaw pain and chest pain', 'chest pain acute coronary syndrome'], ['chest pain and jaw pain', 'chest pain acute coronary syndrome'],
  ['chest pain radiating to jaw', 'chest pain acute coronary syndrome'], ['chest pain radiating to the jaw', 'chest pain acute coronary syndrome'],
  ['arm pain and chest pain', 'chest pain acute coronary syndrome'], ['chest pain and arm pain', 'chest pain acute coronary syndrome'],
  ['chest pain radiating to the arm', 'chest pain acute coronary syndrome'], ['chest pain radiating to arm', 'chest pain acute coronary syndrome'],
  ['chest pain radiating to the left arm', 'chest pain acute coronary syndrome'], ['chest pain radiating to left arm', 'chest pain acute coronary syndrome'],
  ['chest pain and back pain', 'acute aortic syndrome and chest pain and back pain'],
  ['back pain and chest pain', 'acute aortic syndrome and chest pain and back pain'],
  ['chest and back pain', 'acute aortic syndrome and chest pain and back pain'],
  // lay terms, eponyms and shorthand
  ['cp', 'chest pain'], ['blacked out', 'syncope'], ['dizzy spells', 'dizziness'], ['dizzy spell', 'dizziness'],
  ['seeing double', 'visual'], ['numb hand', 'cervical radiculopathy'], ['hand numbness', 'cervical radiculopathy'],
  ['tingling fingers', 'cervical radiculopathy'], ['finger tingling', 'cervical radiculopathy'], ['hand tingling', 'cervical radiculopathy'],
  ['face drooping', 'stroke focal neuro deficit'], ['amaurosis fugax', 'tia visual'],
  ['buckle fracture', 'wrist trauma fracture'], ['torus fracture', 'wrist trauma fracture'], ['greenstick fracture', 'forearm trauma fracture'],
  ['jersey finger', 'hand trauma'], ['mallet finger', 'hand trauma'], ['skiers thumb', 'hand trauma'], ['skier s thumb', 'hand trauma'],
  ['gamekeeper thumb', 'hand trauma'], ['gamekeepers thumb', 'hand trauma'], ['gamekeeper s thumb', 'hand trauma'],
  ['fnof', 'hip pain acute traumatic fracture'], ['bimalleolar fracture', 'ankle trauma fracture'], ['trimalleolar fracture', 'ankle trauma fracture'],
  ['jones fracture', 'foot trauma fracture'], ['lisfranc', 'foot trauma'], ['acetabular fracture', 'hip pain acute traumatic fracture'],
  ['snuffbox tenderness', 'wrist trauma fall'], ['wrist sprain', 'wrist trauma'], ['sternal fracture', 'chest trauma blunt'],
  ['flail chest', 'chest trauma blunt rib fracture'], ['blowout fracture', 'orbital trauma'], ['eye injury', 'orbital trauma'],
  ['quad tendon rupture', 'knee trauma'], ['quadriceps tendon rupture', 'knee trauma'], ['quadriceps rupture', 'knee trauma'],
  ['patellar dislocation', 'knee trauma dislocation'], ['patella dislocation', 'knee trauma dislocation'],
  ['ac joint separation', 'shoulder pain acute'], ['ac joint injury', 'shoulder pain acute'], ['ac separation', 'shoulder pain acute'],
  ['slap tear', 'shoulder pain labral'], ['shoulder impingement', 'shoulder pain chronic'], ['impingement shoulder', 'shoulder pain chronic'],
  ['tennis elbow', 'elbow pain chronic epicondylalgia'], ['lateral epicondylitis', 'elbow pain chronic epicondylalgia'],
  ['golfers elbow', 'elbow pain chronic epicondylalgia'], ['golfer s elbow', 'elbow pain chronic epicondylalgia'],
  ['medial epicondylitis', 'elbow pain chronic epicondylalgia'], ['cubital tunnel', 'elbow pain chronic'],
  ['de quervain', 'wrist pain chronic'], ['de quervains', 'wrist pain chronic'], ['trigger finger', 'hand pain chronic'],
  ['tfcc tear', 'wrist pain chronic'], ['tfcc', 'wrist pain chronic'], ['kienbock', 'wrist pain chronic'],
  ['ganglion cyst', 'soft tissue mass wrist'], ['bakers cyst', 'knee pain chronic'], ['baker s cyst', 'knee pain chronic'],
  ['baker cyst', 'knee pain chronic'], ['popliteal cyst', 'knee pain chronic'], ['prepatellar bursitis', 'knee pain'],
  ['olecranon bursitis', 'elbow pain'], ['it band', 'knee pain chronic'], ['iliotibial band', 'knee pain chronic'],
  ['jumpers knee', 'knee pain chronic'], ['jumper s knee', 'knee pain chronic'], ['patellar tendinitis', 'knee pain chronic'],
  ['patellar tendinopathy', 'knee pain chronic'], ['osgood schlatter', 'knee pain chronic child'],
  ['severs disease', 'heel pain child'], ['sever s disease', 'heel pain child'], ['perthes', 'limp hip child'],
  ['legg calve perthes', 'limp hip child'], ['transient synovitis', 'limp hip child'], ['toxic synovitis', 'limp hip child'],
  ['clicky hip', 'ddh'], ['clicky hips', 'ddh'], ['refusing to walk', 'limp'], ['refuses to walk', 'limp'],
  ['wont walk', 'limp'], ['will not walk', 'limp'], ['mcl tear', 'knee internal derangement'], ['pcl tear', 'knee internal derangement'],
  ['lcl tear', 'knee internal derangement'], ['fai', 'hip pain chronic'], ['femoroacetabular impingement', 'hip pain chronic'],
  ['hip impingement', 'hip pain chronic'], ['bunion', 'foot pain chronic'], ['hallux valgus', 'foot pain chronic'],
  ['gout toe', 'foot pain chronic crystalline arthritis gout'], ['podagra', 'foot pain chronic crystalline arthritis gout'],
  ['shin splints', 'stress fracture tibia'], ['charcot foot', 'foot diabetic'], ['charcot', 'foot diabetic'],
  ['felon', 'soft tissue infection hand'], ['paronychia', 'soft tissue infection hand'], ['fight bite', 'soft tissue infection hand'],
  ['dog bite', 'soft tissue infection'], ['cat bite', 'soft tissue infection'], ['flexor tenosynovitis', 'soft tissue infection hand'],
  ['menieres', 'vertigo hearing loss'], ['meniere s', 'vertigo hearing loss'], ['meniere', 'vertigo hearing loss'],
  ['acoustic neuroma', 'hearing loss sensorineural'], ['vestibular schwannoma', 'hearing loss sensorineural'],
  ['ear drainage', 'otitis'], ['otorrhea', 'otitis'], ['tongue deviation', 'cranial nerve palsy'], ['ptosis', 'horner syndrome'],
  ['anisocoria', 'horner syndrome'], ['proptosis', 'exophthalmos'], ['parotitis', 'cervical mass'], ['salivary stone', 'cervical mass'],
  ['sialadenitis', 'cervical mass'], ['thyroglossal duct cyst', 'cervical mass'], ['branchial cleft cyst', 'cervical mass'],
  ['thyroid storm', 'thyrotoxicosis'], ['graves', 'thyrotoxicosis'], ['hashimoto', 'hypothyroidism'], ['hashimotos', 'hypothyroidism'],
  ['hashimoto s', 'hypothyroidism'], ['hypercalcemia', 'hyperparathyroidism'], ['laryngeal cancer', 'head and neck cancer'],
  ['globus', 'dysphagia'], ['odynophagia', 'dysphagia'], ['food stuck in throat', 'dysphagia'],
  ['foreign body throat', 'ingested foreign body'], ['foreign body in throat', 'ingested foreign body'],
  ['essential tremor', 'parkinsonian'], ['tremor', 'parkinsonian'], ['dystonia', 'parkinsonian'],
  ['syrinx', 'myelopathy'], ['syringomyelia', 'myelopathy'], ['near syncope', 'presyncope'], ['pots', 'syncope'],
  ['headache after lp', 'headache intracranial hypotension dural puncture'],
  ['headache after lumbar puncture', 'headache intracranial hypotension dural puncture'],
  ['pseudotumor', 'headache intracranial hypertension'], ['cavernoma', 'vascular malformation ~head'],
  ['cavernous malformation', 'vascular malformation ~head'], ['rcvs', 'headache severe sudden'], ['prolactinoma', 'pituitary adenoma'],
  ['sinus pain', 'sinusitis'], ['sinus pressure', 'sinusitis'], ['sinus congestion', 'sinusitis'], ['sinus headache', 'sinusitis headache'],
  ['ear pain', 'otitis'], ['earache', 'otitis'], ['heart murmur', 'heart disease'],
  ['open book pelvis', 'major blunt trauma ~pelvis'], ['open book fracture', 'major blunt trauma ~pelvis'],
  ['pelvic fracture', 'major blunt trauma ~pelvis'], ['pelvic ring fracture', 'major blunt trauma ~pelvis'],
  // entities ACR does not cover at all; nothing is offered for them
  ['nursemaid elbow', ''], ['nursemaids elbow', ''], ['nursemaid s elbow', ''], ['pulled elbow', ''], ['sacral dimple', ''],
  ['post concussion syndrome', 'head trauma mild'], ['post concussive', 'head trauma mild'], ['second impact', 'head trauma'],
  ['afib', 'atrial fibrillation'], ['a fib', 'atrial fibrillation'], ['myocarditis', 'cardiomyopathy'], ['cardiomegaly', 'heart failure'],
  ['asthma attack', 'asthma acute exacerbation'], ['asthma exacerbation', 'asthma acute exacerbation'],
  ['cold foot', 'cold painful leg'], ['cold toes', 'cold painful leg'], ['blue toe', 'cold painful leg'],
  ['choking child', 'aspirated foreign body child'], ['ibd flare', 'crohn disease acute exacerbation'],
  ['volvulus', 'bowel obstruction'], ['ileus', 'small bowel obstruction'], ['perforated ulcer', 'abdomen pain acute'],
  ['free air', 'abdomen pain acute'], ['pneumoperitoneum', 'abdomen pain acute'], ['renal abscess', 'pyelonephritis complicated'],
  ['perinephric abscess', 'pyelonephritis complicated'], ['fournier', 'soft tissue infection necrotizing fasciitis'],
  ['fourniers gangrene', 'soft tissue infection necrotizing fasciitis'], ['fournier s gangrene', 'soft tissue infection necrotizing fasciitis'],
  ['hepatitis', 'liver disease'], ['spitting up', 'vomiting infant'], ['currant jelly stool', 'intussusception'],
  ['currant jelly', 'intussusception'], ['handlebar injury', 'blunt trauma abdomen child'], ['impalement', 'penetrating trauma'],
  ['blast injury', 'major blunt trauma'], ['sickle cell crisis', 'sickle cell'], ['sickle cell chest syndrome', 'chest pain sickle cell'],
  ['acute chest syndrome', 'chest pain sickle cell'], ['giant cell arteritis', 'vasculitis'], ['temporal arteritis', 'vasculitis'],
  ['gca', 'vasculitis'], ['aortic root', 'thoracic aorta'], ['ascending aorta', 'thoracic aorta'], ['ascending aortic', 'thoracic aorta'],
  ['aortic injury', 'chest trauma blunt aorta'], ['traumatic aortic injury', 'chest trauma blunt aorta'],
  ['cardiac contusion', 'chest trauma blunt cardiac injury'], ['myocardial contusion', 'chest trauma blunt cardiac injury'],
  ['lymph node', 'adenopathy'], ['lymph nodes', 'adenopathy'], ['enlarged lymph node', 'adenopathy'],
  ['swollen glands', 'neck adenopathy'], ['swollen gland', 'neck adenopathy'],
  ['enlarged lymph nodes', 'adenopathy'], ['lymphadenopathy', 'adenopathy'], ['dysuria', 'uti'],
  // ACR's words for the features a measured lesion is described with
  ['mural nodule', 'high risk features'], ['worrisome features', 'high risk features'], ['high risk stigmata', 'high risk features'],
  ['after neoadjuvant chemotherapy', 'neoadjuvant chemotherapy completed'], ['after neoadjuvant chemo', 'neoadjuvant chemotherapy completed'],
  ['post neoadjuvant chemotherapy', 'neoadjuvant chemotherapy completed'], ['post neoadjuvant chemo', 'neoadjuvant chemotherapy completed'],
  ['completed neoadjuvant chemotherapy', 'neoadjuvant chemotherapy completed'],
  ['completion of neoadjuvant chemotherapy', 'neoadjuvant chemotherapy completed'],
  ['right upper lobe', 'lung'], ['left upper lobe', 'lung'], ['right lower lobe', 'lung'], ['left lower lobe', 'lung'],
  ['right middle lobe', 'lung'], ['upper lobe', 'lung'], ['lower lobe', 'lung'], ['middle lobe', 'lung'], ['lingula', 'lung'],
  // Lay wording for a finding or a place ACR names directly (not yet clinician reviewed).
  ['peeing blood', 'hematuria'], ['pee blood', 'hematuria'], ['blood in pee', 'hematuria'], ['blood in my pee', 'hematuria'],
  ['bloody urine', 'hematuria'], ['yellow skin and eyes', 'jaundice'], ['turned yellow', 'jaundice'],
  ['stomach ulcer', 'peptic ulcer'], ['overactive thyroid', 'thyrotoxicosis'], ['underactive thyroid', 'hypothyroidism'],
  ['bulging eye', 'exophthalmos'], ['bulging eyes', 'exophthalmos'], ['going deaf', 'hearing loss'], ['deaf', 'hearing loss'],
  ['deafness', 'hearing loss'], ['fluid around lung', 'pleural effusion'], ['fluid around lungs', 'pleural effusion'],
  ['fluid on lungs', 'pleural effusion'], ['water on lungs', 'pleural effusion'],
  ['inflamed pancreas', 'pancreatitis'], ['belly aneurysm', 'aaa'], ['abdominal aneurysm', 'aaa'], ['stomach aneurysm', 'aaa'],
  ['bowel cancer', 'colon cancer'], ['after giving birth', 'postpartum'], ['after childbirth', 'postpartum'],
  ['after delivery', 'postpartum'], ['gave birth', 'postpartum'], ['giving birth', 'postpartum'],
  ['throwing up green', 'bilious vomiting'], ['green vomit', 'bilious vomiting'], ['vomiting green', 'bilious vomiting'],
  ['throwing up', 'vomiting'], ['threw up', 'vomiting'], ['chest infection', 'pneumonia'], ['thigh bone', 'femur'],
  ['shoulder blades', 'thoracic back'], ['shoulder blade', 'scapula'], ['cannot get pregnant', 'infertility'],
  ['cant get pregnant', 'infertility'], ['can not get pregnant', 'infertility'], ['unable to get pregnant', 'infertility'],
  ['trouble getting pregnant', 'infertility'], ['difficulty getting pregnant', 'infertility'], ['not getting pregnant', 'infertility'],
  ['trouble conceiving', 'infertility'], ['unable to conceive', 'infertility'], ['cannot conceive', 'infertility'],
  ['swollen kidneys', 'hydronephrosis'], ['keep coming back', 'recurrent'], ['keeps coming back', 'recurrent'],
  ['coming back', 'recurrent'], ['came back', 'recurrent'], ['bladder infections', 'uti'], ['kidney infection', 'pyelonephritis'],
  ['kidney infections', 'pyelonephritis'], ['narrowed windpipe', 'tracheal stenosis'],
];

// The hand-written table, then the mined phrases it does not already name,
// longest phrase first. Equal lengths keep this order, so a hand-written
// phrase is read before a mined one of the same length.
function mergeAliases(hand, mined) {
  const seen = new Set(hand.map(([from]) => from));
  const merged = [...hand];
  for (const pair of mined) {
    if (seen.has(pair[0])) continue;
    seen.add(pair[0]);
    merged.push(pair);
  }
  return merged.sort((a, b) => b[0].length - a[0].length);
}
let ALIASES = mergeAliases(HAND_ALIASES, MINED_ALIASES);

// "history of colon cancer" beside a measured lesion is ACR's "hx of
// malignancy": the lesion's scenarios split on that, not on the cancer's site.
const LESION_WORDS = /\b(mass|lesion|nodule|cyst|incidentaloma|adenoma)\b/;
const CANCER_HISTORY_RE = /\b(?:history of|hx of|known|prior|previous|with|has|and|in (?:a )?patient with|patient with)\s+(?:a |an |history of )?(?:[a-z]+ ){0,2}(?:cancer|carcinoma|malignancy|melanoma|lymphoma|sarcoma)\b/g;

// Aliases that depend on the rest of the search. "urinary retention" with back
// pain means cauda equina; alone it is a bladder question. Those marked
// `before` run ahead of the plain aliases, the rest on what is left after them.
const CONTEXT_ALIASES = [
  { phrase: 'urinary retention', when: /\b(back|lumbar|spine|spinal|leg|legs|saddle|weakness|incontinence|lbp|cauda)\b/, to: 'cauda equina', before: true },
  { phrase: 'bowel or bladder dysfunction', when: /\b(back|lumbar|spine|leg|legs|lbp)\b/, to: 'cauda equina', before: true },
  { phrase: 'bladder dysfunction', when: /\b(back|lumbar|spine|leg|legs|lbp)\b/, to: 'cauda equina', before: true },
  { phrase: 'incontinence', when: /\b(back|lumbar|spine|leg|legs|lbp|saddle)\b/, to: 'cauda equina', before: true },
  { phrase: 'bilateral leg weakness', when: /\b(retention|saddle|cauda|incontinence)\b/, to: '', before: true },
  { phrase: 'leg weakness', when: /\b(retention|saddle|cauda|incontinence)\b/, to: '', before: true },
  { phrase: 'bilateral leg weakness', when: /\b(back|spine|lumbar|thoracic|fever|infection)\b/, to: 'neuro deficit', before: true },
  { phrase: 'leg weakness', when: /\b(back|spine|lumbar|thoracic|fever|infection)\b/, to: 'neuro deficit', before: true },
  { phrase: 'bilateral leg weakness', when: /./, to: 'myelopathy', before: true },
  { phrase: 'leg weakness', when: /./, to: 'myelopathy', before: true },
  { phrase: 'hiv', when: /\b(cough|pneumonia|respiratory|dyspnea|infiltrate|fever|headache|ha)\b/, to: 'immunocompromised', before: true },
  { phrase: 'aids', when: /\b(cough|pneumonia|respiratory|dyspnea|infiltrate|fever|headache|ha)\b/, to: 'immunocompromised', before: true },
  { phrase: 'transplant', when: /\b(cough|pneumonia|respiratory|dyspnea|infiltrate)\b/, to: 'immunocompromised', before: true },
  { phrase: 'chemotherapy', when: /\b(cough|pneumonia|respiratory|dyspnea|infiltrate)\b/, to: 'immunocompromised', before: true },
  { phrase: 'ivdu', when: /./, to: 'iv drug use', before: true },
  { phrase: 'ivda', when: /./, to: 'iv drug use', before: true },
  { phrase: 'iv drug user', when: /./, to: 'iv drug use', before: true },
  { phrase: 'iv drug abuse', when: /./, to: 'iv drug use', before: true },
  { phrase: 'intravenous drug use', when: /./, to: 'iv drug use', before: true },
  { phrase: 'injection drug use', when: /./, to: 'iv drug use', before: true },
  // Associated symptoms ACR never uses to split these topics.
  { phrase: 'vomiting', when: /\b(headache|ha)\b/, to: '', before: true },
  { phrase: 'nausea', when: /\b(headache|ha)\b/, to: '', before: true },
  // An isolated facial droop is a cranial neuropathy, not a stroke.
  { phrase: 'facial droop', when: /\b(isolated|bell|bells|palsy|peripheral)\b|\bno (?:stroke|cva|tia)\b/, to: 'facial weakness', before: true },
  { phrase: 'face droop', when: /\b(isolated|bell|bells|palsy|peripheral)\b|\bno (?:stroke|cva|tia)\b/, to: 'facial weakness', before: true },
  { phrase: 'torsion', when: /\b(scrotum|scrotal|testis|testicle|testicular|testes)\b/, to: 'scrotum pain acute' },
  { phrase: 'torsion', when: /\b(ovary|ovarian|adnexa|adnexal|pelvis|pelvic)\b/, to: 'pelvis pain gynecological' },
  { phrase: 'abscess', when: /\b(thigh|leg|arm|forearm|hand|foot|calf|shoulder|hip|knee|elbow|wrist|ankle|neck|extremity|buttock|gluteal|groin|lower|upper)\b/, to: 'soft tissue infection' },
  // A stiff neck beside a headache changes nothing; beside a fever it is the
  // neck that is asked about, softly.
  { phrase: 'neck stiffness', when: /\b(headache|ha|migraine)\b/, to: '', before: true },
  { phrase: 'stiff neck', when: /\b(headache|ha|migraine)\b/, to: '', before: true },
  { phrase: 'neck stiffness', when: /./, to: '~cervical', before: true },
  { phrase: 'stiff neck', when: /./, to: '~cervical', before: true },
  // A skeletal survey is ACR's abuse workup when it is the whole search or
  // abuse or a child is named; a myeloma skeletal survey is not an accusation.
  { phrase: 'skeletal survey', when: /^\s*$|\b(abuse|nonaccidental|non accidental|nat|infant|baby|toddler|child|pediatric)\b/, to: 'physical abuse skeletal survey', before: true },
  // The renal pelvis of a hydronephrosis is the kidney itself.
  { phrase: 'renal pelvis', when: /\b(hydronephrosis|dilat\w*|aprpd|apd)\b/, to: '', before: true },
  { phrase: 'renal pelvic', when: /\b(hydronephrosis|dilat\w*|aprpd|apd)\b/, to: '', before: true },
  // A blunt mechanism makes the headache, the neck pain and the back a
  // question of injury to the head and spine.
  { phrase: 'headache', when: /\bblunt\b/, to: 'head trauma' },
  { phrase: 'cervical pain', when: /\bblunt\b/, to: 'cervical spine trauma' },
  { phrase: 'back', when: /\bblunt\b/, to: 'spine' },
  // Beside an injury or a bleed, "unstable" is the hemodynamically unstable
  // patient; elsewhere it describes a joint, a fracture or angina.
  { phrase: 'unstable', when: /\b(trauma|blunt|penetrating|crash|accident|collision|mvc|mva|gunshot|stab|stabbed|bleeding|hemorrhage|polytrauma)\b/, to: 'hypotension', before: true },
];

// "<part> pain after a fall" asks about the injury, so the mechanism replaces
// the pain, matching how ACR names trauma scenarios.
const PAIN_AFTER_TRAUMA_RE = /\bpain (?:after|following|from|since|post|s p|status post) (?:a |an |the |minor |mechanical |ground level |recent )?(fall|falling|accident|collision|crash|mvc|mva|injury|trauma|assault|tackle|twist|twisting|sport|sports|game|lifting|foosh)\b/g;

// Applied only when these are the whole clinical content of a query, because
// ACR files the acute presentation under a different name from the disease's
// follow-up scenarios.
const WHOLE_QUERY_ALIASES = {
  'aortic dissection': 'acute aortic syndrome',
  'aortic dissection acute': 'acute aortic syndrome',
  'dissection aortic': 'acute aortic syndrome',
  'dissection aortic acute': 'acute aortic syndrome',
  'dissection aorta': 'acute aortic syndrome',
  'aorta dissection': 'acute aortic syndrome',
  'dissection chest': 'acute aortic syndrome',
  'dissection cervical': 'cervical vascular dissection',
  'dissection head cervical': 'cervical vascular dissection',
  pneumonia: 'acute respiratory illness',
  'cough fever': 'acute respiratory illness',
  'fever cough': 'acute respiratory illness',
};

// Terms a search can fall back to when the exact word finds nothing: an
// infant's femur "fracture" is ACR's femur "injury"; a limping child's fever is
// its "concern for infection".
const FALLBACK_EQUIVALENT = { fracture: 'trauma', fever: 'infection', infection: 'fever' };

// Qualifiers a generic search should not lead with: a later stage, a narrower
// population or a specific subtype. Each unasked one costs a little.
const UNASKED_QUALIFIERS = ['follow', 'preoperative', 'preprocedure', 'tevar', 'repair', 'post',
  'posttreatment', 'arthroplasty', 'treated', 'recurrence', 'recurrent', 'prior', 'next', 'stress', 'occult',
  'pathologic', 'insufficiency', 'acalculous', 'fungal', 'invasive', 'complicated', 'immunocompromised', 'neutropenia',
  'screening', 'sepsis', 'abuse', 'transplant', 'pavm', 'postmenopausal', 'premenopausal', 'sickle', 'arteriopathy',
  'hiv', 'diabetes', 'diabetic', 'cancer', 'tumor', 'exacerbation', 'management', 'intervention', 'candidate',
  'silicone', 'saline', 'implant', 'cutaneous', 'revasc', 'revascularization', 'penetrating', 'transgender',
  'transfeminine', 'transmasculine', 'neoadjuvant', 'chemotherapy', 'planning', 'surgical', 'inflammatory', 'wall',
  'infection'];

// Topic titles a generic search should not open when a plainer title also
// fits: procedure planning and the immunocompromised branch are asked for.
const TITLE_UNASKED = ['management', 'planning', 'interventional', 'immunocompromised'];

// Opposites: a search for one is never answered with the other.
const ANTONYMS = [['acute', 'chronic'], ['blunt', 'penetrating'], ['upper', 'lower'], ['premenopausal', 'postmenopausal'],
  ['immunocompetent', 'immunocompromised'], ['ballistic', 'nonballistic'], ['painful', 'painless'], ['pulsatile', 'nonpulsatile'],
  ['bilious', 'nonbilious'], ['gynecological', 'nongynecological'], ['ischemic', 'nonischemic'], ['focal', 'nonlocalized'],
  ['postmenopausal', 'reproductive'], ['first', 'second'], ['first', 'third'], ['second', 'third'], ['positive', 'negative'],
  ['hypothyroidism', 'thyrotoxicosis'], ['euthyroid', 'thyrotoxicosis'], ['euthyroid', 'hypothyroidism'], ['benign', 'malignant'],
  ['met', 'primary'], ['gross', 'microscopic'], ['conductive', 'sensorineural'], ['primary', 'secondary'],
  ['hypotension', 'normotension'], ['ingested', 'aspirated'],
  // A chronic scenario is the opposite of an injury even when its name
  // mentions an old one ("post trauma osteoarthritis"): judged by what was
  // asked, not by what the name also happens to say.
  ['trauma', 'chronic', 'strict']];

// Whether a scenario or title states the opposite of a word the search asked,
// by an antonym or, when `negation` is checked, by negating the word itself
// ("nontraumatic", "no high risk features"). A name that says both words of a
// pair is not the opposite of either, unless the pair is marked strict.
function opposes({ positive, negative }, asked, { negation = true } = {}) {
  if (negation && negatesAsked({ positive, negative }, asked)) return true;
  return ANTONYMS.some(([a, b, strict]) => {
    const clear = (want, other) => (strict ? !asked.has(other) : !positive.has(want));
    return (asked.has(a) && positive.has(b) && clear(a, b)) || (asked.has(b) && positive.has(a) && clear(b, a));
  });
}

function negatesAsked({ positive, negative }, asked) {
  return Boolean(negative) && [...asked].some(t => negative.has(t) && !positive.has(t));
}

// A negated word also rules out scenarios built on what implies it: "no fever"
// excludes sepsis, "no red flags" the red-flag headache branches.
const IMPLIES = {
  fever: ['sepsis'],
  flag: ['fever', 'neuro', 'deficit', 'cancer', 'immunocompromised', 'thunderclap', 'sudden', 'hypotension', 'hypertension',
    'older', 'increasing', 'pregnant', 'peripartum', 'hiv', 'papilledema', 'post', 'trauma', 'tension', 'cervicogenic',
    'intracranial', 'otitis', 'sinusitis', 'migraine', 'cluster', 'trigeminal'],
  trauma: ['fall', 'blunt', 'penetrating', 'ballistic'],
  cancer: ['met'],
  infection: ['septic', 'sepsis', 'osteomyelitis', 'abscess', 'cellulitis'],
  projectile: ['pyloric'],
  dissection: ['aortic'],
};

// Words an alias writes for a diagnosis ("tearing chest pain" is read as acute
// aortic syndrome): when the search rules the diagnosis out, they go with it.
const NEGATION_KIN = {
  dissection: ['aortic', 'aorta', 'syndrome'],
  stroke: ['ischemic', 'tia'],
};

// Scenario names this long are the variant text itself, not a name.
const MAX_NAME_WORDS = 22;

// "antenatal" is not here: an antenatal diagnosis (hydronephrosis) describes
// the infant, so it sits with the pediatric words.
const PREGNANT_RE = /\b(pregnant|pregnancy|expecting|expectant|gravid|gravida|trimester|gestation|gestational|prenatal|obstetric|obstetrical|fetal|fetus|g\d+p\d+|\d+\s*(?:weeks|wks|wk)\s*(?:pregnant|gestation|ga|ega|gestational age)|iugr)\b/;
const NOT_PREGNANT_RE = /\b((?:cannot|cant|can not|unable to|not able to|failing to|struggling to|trouble|difficulty) (?:get|getting|become|becoming|fall|falling) pregnant|not getting pregnant|never been pregnant|not pregnant|non pregnant|nonpregnant|negative pregnancy test|pregnancy test negative|negative hcg|hcg negative|negative beta hcg|beta hcg negative|not currently pregnant)\b/;
const PEDIATRIC_RE = /\b(child|children|kid|kids|pediatric|pediatrics|peds|ped|infant|infants|toddler|neonate|neonatal|newborn|baby|babies|adolescent|teen|teenager|teenage|preemie|preterm infant|nicu|school age|boy|girl|antenatal|kindergartner|kindergartener|kindergarten|preschooler|preschool|schoolchild|schoolboy|schoolgirl|grader|preteen|tween|youngster)\b/;
// Sex words in a search and in ACR titles and names. "Evaluation of the
// Symptomatic Male Breast" is no answer to a search that never says male.
const MALE_RE = /\b(male|males|man|men|boy|boys|gentleman)\b/i;
const FEMALE_RE = /\b(female|females|woman|women|girl|girls|lady|pregnant|gravid)\b/i;
const INFANT_RE = /\b(infant|infants|toddler|neonate|neonatal|newborn|baby|babies|preemie|nicu)\b/;
const ADULT_RE = /\b(adult|adults|geriatric|elderly)\b/;
// Ages as clinicians write them: "68F", "45 yo M", "2 month old", "age 40", "under 30".
// A bare "68F" needs two digits: "Bosniak 2F" is a cyst class, not a toddler.
const AGE_YEARS_RE = /\b(?:(\d{1,3})\s*(?:yo[mf]?|y o|yr old|yrs old|year old|years old|year|years|yr|yrs)|(\d{2,3})\s*(?:f|m))\b/;
const AGE_INFANT_RE = /\b(\d{1,2})\s*(?:month|months|mo|mos|week|weeks|wk|wks|day|days)\s*(?:old|of age)\b/;
const AGE_WORD_RE = /\b(?:age|aged)\s*(?:of\s*)?(?:over|under|greater than|less than|above|below|>|<)?\s*(\d{1,3})\b/;
const AGE_BOUND_RE = /\b(?:under|over|older than|younger than|less than|greater than|above|below|>|<)\s*(?:age\s*)?(\d{2,3})\b(?!\s*(?:cm|mm|%|percent|pack|weeks|wks|hours|hrs|days|minutes|min))/;
const AGE_DECADE_RE = /\b(?:in (?:his|her|their) )?([2-9])0s\b/;
const GCS_QUERY_RE = /\bgcs\s*(?:of\s*|=\s*)?(\d{1,2})\b/;
const GCS_TEXT_RE = /gcs\s*(<=|>=|<|>|=)?\s*(\d{1,2})(?:\s*[-–]\s*(\d{1,2}))?/i;

// Clause-scope negation words. "non" and the a- prefix negate one word.
const NEGATION_WORDS = ['no', 'not', 'without', 'denies', 'denied', 'denying', 'excluding', 'excludes', 'absent', 'absence', 'never'];
// In a search, a negation stops at these words: "no fever with abdominal pain".
// "or" continues it, as in ACR's own "no fever or leukocytosis".
const NEGATION_BOUNDARY = new Set(['and', 'but', 'with', 'plus', 'in', 'on', 'at', 'after', 'before', 'since',
  'who', 'which', 'that', 'when', 'while', 'then', 'now', 'also', 'initial', 'next', 'follow', 'imaging', 'xbreakx',
  'xcommax']);
const NEGATION_REACH = 3;

// Words that join one complaint to the next. Commas and sentence breaks are
// kept as tokens by normalizeSearch so they can split complaints too.
const CONJUNCTIONS = new Set(['and', 'with', 'plus', 'also', 'xcommax', 'xbreakx']);

// One-word searches too general to point at any one topic.
const TOO_BROAD = new Set(['pain', 'mass', 'lesion', 'tumor', 'cancer', 'trauma', 'fracture', 'infection', 'normal',
  'bleeding', 'swelling', 'disease']);

// Words that cannot stand for a complaint or point a recovery at a topic on
// their own: generic findings, sides of a region, stages of care, and the
// fragments of longer terms ("cell" of sickle cell, "loss" of hearing loss).
const RECOVERY_GENERIC = new Set([...TOO_BROAD, 'upper', 'lower', 'extremity', 'staging', 'screening', 'follow',
  'initial', 'imaging', 'suspected', 'known', 'next', 'acute', 'chronic', 'loss', 'cell', 'syndrome', 'type', 'grade',
  'stage', 'small', 'large', 'giant', 'body', 'wall', 'duct', 'node', 'tissue', 'soft', 'weakness', 'symptom', 'history',
  'left', 'right', 'features', 'feature', 'high', 'low', 'risk', 'dysfunction', 'short', 'long', 'term', 'radiation',
  'therapy', 'treatment', 'injury', 'transient', 'density', 'iron', 'deficiency', 'survey']);
// A one-word search is also too broad when its scenarios spread over the
// body: "fever" alone names headaches, bellies and spines.
const MIN_BROAD_NAMES = 8;
// A word named in more than this share of ACR scenarios is a modifier, not a topic.
const MAX_SPECIFIC_SHARE = 0.1;
// How much of the vote one region needs before recovery names it, and before
// a word in a search naming no body part counts as pointing anywhere: the
// scenarios naming "abscess" spread over several regions, those naming
// "headache" do not.
const MIN_REGION_SHARE = 0.6;
// A topic is offered for a word when its title names the word, or when enough
// of its scenarios do: this share of the topic, or this many scenarios.
const MIN_TOPIC_SHARE = 0.15;
const MIN_TOPIC_SCENARIOS = 3;
// A data region counts as one a body part lives in when this share of the
// scenarios naming the part sit there, or this many of them do.
const MIN_GROUP_REGION_SHARE = 0.05;
const MIN_REGION_NAMES = 3;
// Adult scenarios this scarce among those naming a word make it a child's word.
const MIN_ADULT_SHARE = 0.2;
const MAX_RECOVERY_TOPICS = 5;
const MAX_RECOVERY_SCENARIOS = 3;
// An age that picks out more scenarios than this leaves the topic's guide to answer.
const MAX_AGE_LIST = 4;

// Sizes. A search's "8 mm", "4.5cm" or "1.5-cm" is read in millimetres and
// checked against the range a scenario names.
const SIZE_UNIT_RE = 'mm|cm|millimet(?:er|re)s?|centimet(?:er|re)s?';
const SIZE_NUM = '\\d+(?:\\.\\d+)?';
const QUERY_SIZE_RE = new RegExp(`(?<![\\d.])(${SIZE_NUM})\\s*-?\\s*(${SIZE_UNIT_RE})\\b`, 'g');
const REGION_LABELS = {
  neuro: 'Neuro', spine: 'Spine', chest: 'Chest', abdomen: 'Abdomen', msk: 'Musculoskeletal', vascular: 'Vascular',
  breast: 'Breast', peds: 'Pediatric', other: 'General',
};

const SOFT_MATCH_BONUS = 0.08;
const KEYWORD_BONUS = 0.03;
const NAME_MATCH_BONUS = 0.12;
const INITIAL_BONUS = 0.03;
const SIZE_FIT_BONUS = 0.15;
const POPULATION_PENALTY = 0.3;
const UNASKED_PENALTY = 0.12;
const EXTRA_WORD_PENALTY = 0.006;
const MIN_DROPPABLE_FREQUENCY = 10;
const MIN_CORRECTABLE_LENGTH = 5;

function stem(word) {
  const mapped = EQUIVALENT[word] || word;
  const base = mapped.length > 3 && mapped.endsWith('s') && !/(ss|is|us|itis)$/.test(mapped) ? mapped.slice(0, -1) : mapped;
  return EQUIVALENT[base] || base;
}

// Shared cleaning for searches and ACR text: possessives, dashes and symbols
// go, so "crohn's" reads as crohn and "GCS 13–15" splits into words.
function cleanWords(text) {
  const plain = String(text).replace(/\((e?s)\)/g, '').replace(/[’'“”]/g, '').replace(/[–—]/g, ' ').replace(/[<>≤≥=+%&#*"°|]/g, ' ');
  let out = ` ${conceptNormalize(plain)} `;
  for (const [from, to] of TEXT_SYNONYMS) out = out.split(` ${from} `).join(` ${to} `);
  return out.trim();
}

// Slash shorthand must be read before "/" becomes a space: "w/u" is workup,
// "r/o" is rule out, "s/p" is status post.
const SLASH_SHORTHAND = [
  [/\bw\/u\b/g, ' workup '], [/\bf\/u\b/g, ' follow up '], [/\br\/o\b/g, ' rule out '], [/\bs\/p\b/g, ' status post '],
  [/\bh\/o\b/g, ' history of '], [/\bc\/o\b/g, ' complains of '], [/\bn\/v\b/g, ' nausea vomiting '], [/\bb\/l\b/g, ' bilateral '],
  [/\by\/o\b/g, ' year old '], [/\bw\/o\b/g, ' without '], [/\bw\//g, ' with '], [/\bp\/w\b/g, ' presents with '],
  [/\bu\/s\b/g, ' ultrasound '], [/\bd\/t\b/g, ' due to '], [/\bl\/e\b/g, ' lower extremity '], [/\bu\/e\b/g, ' upper extremity '],
  [/\bv\/q\b/g, ' vq '], [/\ba\/w\b/g, ' with '], [/\bpt\.\s/g, ' patient '],
];

// A negation written after what it negates: "PE ruled out", "abuse not
// suspected", "endocarditis excluded", and the active "CT ruled out a bleed".
// Each is rewritten as "no <words>" with a break after it, so the usual
// negation reading applies. After a comma or a joining word the two words
// before the phrase are negated ("pulmonary embolism ruled out"); elsewhere
// only the last one, so "chest pain PE ruled out" keeps the chest pain.
// "rule out PE" (present tense) still means PE is suspected and is untouched.
const NEGATED_AFTER = '(?:(?:has|have|had) been |was |were |is |are |been |already |now |essentially |effectively )*(?:ruled out|excluded|not suspected|not likely|unlikely|not a concern|not present|not seen|not found)';
const CLAUSE_END = '(?=\\s*(?:$|[,;.:]|\\band\\b|\\bbut\\b|\\bso\\b|\\bnow\\b|\\bwith\\b))';
const NEGATED_AFTER_CLAUSE_RE = new RegExp(`(^|[,;.:]\\s*|\\b(?:and|but|with|then|so)\\s+)([a-z]+(?: [a-z]+)?) ${NEGATED_AFTER}${CLAUSE_END}`, 'g');
const NEGATED_AFTER_WORD_RE = new RegExp(`\\b([a-z]+) ${NEGATED_AFTER}${CLAUSE_END}`, 'g');
const NEGATING_VERB_RE = /\b(?:(?:has|have|had|was|were|been) )*(?:ruled out|excluded|negative for)\s+(?:a |an |the |any )?(?=[a-z])/g;
function readTrailingNegation(q) {
  for (const [re, to] of NEGATIVE_TESTS) q = q.replace(re, to);
  return q
    .replace(NEGATED_AFTER_CLAUSE_RE, (m, lead, words) => `${lead} no ${words} xbreakx `)
    .replace(NEGATED_AFTER_WORD_RE, ' no $1 xbreakx ')
    .replace(NEGATING_VERB_RE, ' no ');
}

// A side and a level of the abdomen are one place, not two independent words:
// "right upper abdominal pain" is the right upper quadrant and never the left
// upper one. Written either way round, with lay words for the abdomen, and as
// "under the left ribs".
const QUADRANT = { right: { upper: 'ruq', lower: 'rlq' }, left: { upper: 'luq', lower: 'llq' } };
const BELLY_WORDS = '(?:abdominal|abdomen|abd|belly|tummy|stomach|quadrant)';
const SIDE_LEVEL_RE = new RegExp(`\\b(right|left) (?:sided |side )?(upper|lower) (?:side of (?:the |my |her |his )?|part of (?:the |my |her |his )?)?${BELLY_WORDS}(?: quadrant)?\\b`, 'g');
const LEVEL_SIDE_RE = new RegExp(`\\b(upper|lower) (right|left) (?:sided |side )?(?:side of (?:the |my |her |his )?|part of (?:the |my |her |his )?|of (?:the |my |her |his )?)?${BELLY_WORDS}(?: quadrant)?\\b`, 'g');
const UNDER_RIBS_RE = /\b(?:under|below|beneath|underneath) (?:the |my |her |his )?(right|left) (?:ribs|rib cage|ribcage|rib)\b/g;
function readQuadrants(q) {
  return q
    .replace(SIDE_LEVEL_RE, (m, side, level) => QUADRANT[side][level])
    .replace(LEVEL_SIDE_RE, (m, level, side) => QUADRANT[side][level])
    .replace(UNDER_RIBS_RE, (m, side) => QUADRANT[side].upper);
}
const QUADRANTS = new Set(['ruq', 'rlq', 'luq', 'llq']);
const SIDE_WORDS = { left: ['left', 'luq', 'llq'], right: ['right', 'ruq', 'rlq'] };
const SIDES_LIST = ['left', 'right'];
// Diagnoses and organs that belong to one quadrant: a search for one is not
// answered by a scenario named for another quadrant.
const QUADRANT_OF = {
  diverticulitis: 'llq', appendicitis: 'rlq', appendix: 'rlq', spleen: 'luq', splenomegaly: 'luq', gallbladder: 'ruq',
  cholecystitis: 'ruq', biliary: 'ruq', liver: 'ruq',
};

// The stage of pregnancy a search states, in ACR's two bins: "first" (before
// 14 weeks) or "late". Null when none is stated.
function trimesterOf(q) {
  if (/\b(?:first|1st) trimester\b/.test(q)) return 'first';
  if (/\b(?:second|third|2nd|3rd) trimester\b/.test(q)) return 'late';
  const weeks = q.match(/\b(\d{1,2})\s*(?:weeks|wks|wk)\b(?!\s*(?:old|ago|postpartum|post|after|of age|of pain|of symptoms|history))/);
  return weeks ? (Number(weeks[1]) < 14 ? 'first' : 'late') : null;
}

// "ectopic pregnancy" names a diagnosis, not a pregnant patient to filter on.
// Commas are kept as tokens only when the caller splits complaints on them;
// otherwise they vanish so "fever, no source" still reads as one phrase.
function normalizeSearch(query, { keepCommas = false } = {}) {
  let q = String(query).toLowerCase();
  for (const [re, to] of SLASH_SHORTHAND) q = q.replace(re, to);
  q = readTrailingNegation(q);
  // Contrast phrases carry no clinical meaning and "without" would otherwise
  // negate the next clinical word.
  q = q.replace(/\b(with|without|w|wo|w o|no|non|pre|post)\s*(and\s*(with|without)\s*)?(iv\s*)?(contrast|con|gad|gadolinium)\b/g, ' ');
  // "w/ and w/o" means contrast even when the word is left out.
  q = q.replace(/\b(with|w)\s+(and|&)\s+(without|wo|w o)\b/g, ' ');
  // A measurement is read separately by extractSizes; here it would only
  // split "4.5" into two numbers.
  q = q.replace(QUERY_SIZE_RE, ' ')
    .replace(/\bsub\s*-?\s*centimet(?:er|re)\b|\bsubcentimet(?:er|re)\b|\bsub\s*-?\s*cm\b|\bsubcm\b|\bmillimetric\b/g, ' ');
  // A sentence break ends a negation: "Not goiter. Euthyroid." negates goiter only.
  q = q.replace(/[.;]\s/g, ' xbreakx ');
  // A comma or "+" joins one complaint to the next, like "and".
  // A comma ends a negation when a phrase of its own follows it: "no
  // deformity, elbow pain only" negates the deformity alone. A list goes on
  // being negated: "no fever, chills" and "no fever, chills, or night sweats".
  q = q.replace(/\b(no|not|without|denies|denied|denying|never)\b([^,.;]*),\s*(?=([^,.;]*))/g, (m, neg, scope, next) => {
    const words = next.trim().split(/\s+/).filter(Boolean);
    const list = words.length <= 1 || /^(or|nor|and)\b/.test(next.trim()) || /\b(or|nor)\b/.test(next);
    return list ? m : `${neg}${scope} xbreakx `;
  });
  if (keepCommas) q = q.replace(/\s*[&+]\s*/g, ' and ').replace(/,\s*/g, ' xcommax ');
  q = cleanWords(q)
    .replace(/\b(ectopic|molar) pregnancy\b/g, (m, w) => (w === 'molar' ? 'gestational trophoblastic disease' : w))
    .replace(/\bmolar\b/g, 'gestational trophoblastic disease');
  q = readQuadrants(q);
  return ` ${q} `.replace(RESULT_RE, ' ').replace(/\s+/g, ' ').trim();
}

// "low back" is one idea; "low" alone is only a soft word like "low risk". ACR
// text keeps "back" too, so a search for "back pain" still reaches it.
function joinLowBack(text, { keepBack = false } = {}) {
  return text.replace(/\blow(?:er)? back\b/g, keepBack ? 'lowback back' : 'lowback');
}

// Alias output is joined with "_" so later aliases and qualifier patterns do
// not read it again; parseQuery splits it back into words.
const protect = text => joinLowBack(text).trim().split(' ').filter(Boolean).join('_');

function applyAliases(text, { age } = {}) {
  let out = ` ${text.replace(/\bthe\b/g, ' ').replace(/\s+/g, ' ')} `;
  let mechanism = false;
  out = out.replace(PAIN_AFTER_TRAUMA_RE, (m, cause) => {
    mechanism = true;
    if (/^(fall|falling)$/.test(cause)) return 'trauma fall';
    if (/^(twist|twisting)$/.test(cause)) return 'trauma twisting';
    if (/^(accident|collision|crash|mvc|mva)$/.test(cause)) return 'blunt trauma';
    if (/^foosh$/.test(cause)) return 'wrist trauma fall';
    return 'trauma';
  });
  // The mechanism belongs to every painful part named: "ankle pain and knee
  // pain after a fall" is two injuries.
  if (mechanism) out = out.replace(/ pain /g, ' trauma ');
  // A cancer in the history of a measured lesion is ACR's "hx of malignancy".
  if (LESION_WORDS.test(out)) out = out.replace(CANCER_HISTORY_RE, ' malignancy ');
  // A phrase an earlier alias produced is joined with "_" and matched as such.
  const context = ({ phrase, when, to }) => {
    for (const form of [phrase, phrase.replace(/ /g, '_')]) {
      if (out.includes(` ${form} `) && when.test(out.replace(` ${form} `, ' ').replace(/_/g, ' '))) {
        out = out.split(` ${form} `).join(` ${protect(to)} `);
      }
    }
  };
  for (const c of CONTEXT_ALIASES) if (c.before) context(c);
  // "back pain red flags" asks about the whole topic; "no red flags" is kept
  // for the negation to read.
  out = out.replace(/(?<! (?:no|not|without|denies|denied|negative) )red flags? /g, ' ');
  // A child who will not bear weight is limping; an adult with the same
  // complaint after an injury is asking about that injury.
  if (age === 'pediatric') out = out.replace(/ (cant|cannot|unable to|not) (bear weight|bearing weight|walk) /g, ' limp ');
  for (const [from, to] of ALIASES) out = out.split(` ${from} `).join(` ${protect(to)} `);
  for (const c of CONTEXT_ALIASES) if (!c.before) context(c);
  // ACR files an adult's cough and fever under acute respiratory illness and
  // a child's under pneumonia; a child's skeletal survey is the abuse workup.
  if (age === 'pediatric') {
    out = out.split(' acute_respiratory_illness ').join(' pneumonia ');
    out = out.split(' skeletal survey ').join(' physical_abuse_skeletal_survey ');
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** Pulls out the qualifiers that act as filters. */
export function extractQualifiers(query) {
  const q = normalizeSearch(query);
  const notPregnant = NOT_PREGNANT_RE.test(q);
  let age = null;
  let years = null;
  const infantMatch = q.match(AGE_INFANT_RE);
  const yearsMatch = q.match(AGE_YEARS_RE) || q.match(AGE_WORD_RE) || q.match(AGE_BOUND_RE);
  if (infantMatch) age = 'pediatric';
  else if (yearsMatch) {
    years = Number(yearsMatch[1] || yearsMatch[2]);
    age = years < 18 ? 'pediatric' : 'adult';
  } else if (AGE_DECADE_RE.test(q)) {
    years = Number(q.match(AGE_DECADE_RE)[1]) * 10;
    age = 'adult';
  } else if (PEDIATRIC_RE.test(q)) age = 'pediatric';
  else if (ADULT_RE.test(q)) age = 'adult';
  const infant = Boolean(infantMatch) || INFANT_RE.test(q) || (years !== null && years <= 2);
  // ACR files teenagers under both adult and child topics; neither is excluded.
  const teen = years !== null && years >= 13 && years < 18;
  if (teen) age = null;
  const sides = new Set();
  // A quadrant carries its side: "RUQ pain" is a right-sided search.
  const saysLeft = /\b(left|luq|llq)\b/.test(q);
  const saysRight = /\b(right|ruq|rlq)\b/.test(q);
  if (saysLeft && !saysRight) sides.add('left');
  if (saysRight && !saysLeft) sides.add('right');
  const gcs = q.match(GCS_QUERY_RE);
  const pregnant = !notPregnant && PREGNANT_RE.test(q);
  const sex = pregnant || FEMALE_RE.test(q) ? 'female' : MALE_RE.test(q) ? 'male' : null;
  return {
    pregnant, notPregnant, age, years, infant, teen, sides, sex, gcs: gcs ? Number(gcs[1]) : null,
    sizes: extractSizes(query), trimester: pregnant ? trimesterOf(q) : null,
  };
}

// Ages go before aliases are read ("neck pain child after fall" is a neck
// injury); pregnancy words go after, because aliases produce and consume them
// ("twin pregnancy", "first trimester bleeding").
function withoutAge(text) {
  return text
    .replace(new RegExp(AGE_INFANT_RE.source, 'g'), ' ')
    .replace(new RegExp(AGE_YEARS_RE.source, 'g'), ' ')
    .replace(new RegExp(AGE_WORD_RE.source, 'g'), ' ')
    .replace(new RegExp(AGE_BOUND_RE.source, 'g'), ' ')
    .replace(new RegExp(AGE_DECADE_RE.source, 'g'), ' ')
    .replace(new RegExp(PEDIATRIC_RE.source, 'g'), ' ')
    .replace(/\b(adult|adults|geriatric)\b/g, ' ')
    .replace(new RegExp(GCS_QUERY_RE.source, 'g'), ' gcs ')
    .replace(/\s+/g, ' ')
    .trim();
}

function withoutPregnancy(text) {
  return text
    .replace(new RegExp(NOT_PREGNANT_RE.source, 'g'), ' ')
    .replace(new RegExp(PREGNANT_RE.source, 'g'), ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Removes "ct head" / "head ct" and returns the body parts named by the study.
function splitStudyPhrases(text) {
  const anatomy = new Set();
  const words = [];
  const rest = text.replace(STUDY_RE, (m, a, b) => {
    for (const w of (a || b).split(' ')) {
      if (w === 'and') continue;
      anatomy.add(stem(w));
      words.push(w);
    }
    return ' ';
  });
  return { rest: rest.replace(/\s+/g, ' ').trim(), anatomy, words };
}

function negationScope(words, i, { bounded }) {
  const negated = [];
  let reach = 0;
  for (let j = i + 1; j < words.length; j++) {
    const w = words[j];
    if (NEGATION_WORDS.includes(w)) break;
    if (bounded && NEGATION_BOUNDARY.has(w)) break;
    if (STOPWORDS.has(w) || /^\d/.test(w)) continue;
    negated.push(w);
    if (bounded && ++reach >= NEGATION_REACH) break;
  }
  return negated;
}

// An unknown word built from a negating prefix and a known one: afebrile is
// "no fever", atraumatic "no trauma".
function negatedBase(word, known) {
  if (known && !known.has(stem(word))) {
    for (const prefix of ['a', 'non', 'un']) {
      if (word.startsWith(prefix) && word.length - prefix.length >= 5 && known.has(stem(word.slice(prefix.length)))) {
        return stem(word.slice(prefix.length));
      }
    }
  }
  return null;
}

/** Splits a search into { required, soft, negated } stemmed terms. */
function parseQuery(query, index) {
  const parsed = parseWords(query, index);
  // "how to image suspected aortic dissection" is the whole-query alias once
  // the question words are gone, unless a child or pregnancy was named.
  const { age, pregnant } = extractQualifiers(query);
  const whole = WHOLE_QUERY_ALIASES[[...parsed.required, ...parsed.soft].join(' ')];
  if (whole && age !== 'pediatric' && !pregnant && parsed.negated.length === 0) return parseWords(whole, index);
  return parsed;
}

// The clinical words of a search after shorthand, aliases, ages and pregnancy
// words are read, with the body parts its study names kept apart.
function aliasedWords(query, options = {}) {
  const { age } = extractQualifiers(query);
  const { rest, anatomy: studyAnatomy, words: studyWords } = splitStudyPhrases(normalizeSearch(query, options));
  const words = joinLowBack(withoutPregnancy(applyAliases(withoutAge(rest), { age })))
    .replace(/\bnon(?=[a-z]{5,})/g, 'non ')
    .split(/[ _]/)
    .filter(Boolean);
  return { words, rest, studyAnatomy, studyWords };
}

function parseWords(query, index) {
  const { words, rest, studyAnatomy, studyWords } = aliasedWords(query);
  const parsed = classifyWords(words, index, studyAnatomy, ownPositiveWords(rest));
  const { required } = parsed;
  // A study's body part with only generic words left ("brain MR for new mass")
  // means that body part's mass: read it again with the body part placed
  // before the generic word, so "brain mass" reaches its alias.
  const generic = required.filter(t => DROPPABLE.includes(t));
  if (studyAnatomy.size && required.length && generic.length === required.length) {
    const placed = rest.replace(new RegExp(`\\b(${generic.join('|')})\\b`), `${studyWords.join(' ')} $1`);
    if (placed !== rest) return parseWords(placed, index);
  }
  // A search that is only a study ("xray knee") asks about that body part.
  if (required.length === 0) for (const t of studyAnatomy) required.push(t);
  return { ...parsed, required: [...new Set(required)], soft: parsed.soft.filter(t => !required.includes(t)) };
}

/** Sorts aliased words into { required, soft, negated } stemmed terms. */
function classifyWords(words, index, studyAnatomy = new Set(), ownWords = null) {
  const required = [];
  const soft = [...studyAnatomy];
  const negated = [];
  const known = index ? index.docFreq : null;
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (word === 'non') {
      if (words[i + 1]) negated.push(stem(words[i + 1]));
      i += 1;
      continue;
    }
    if (NEGATION_WORDS.includes(word)) {
      const scope = negationScope(words, i, { bounded: true });
      for (const w of scope) negated.push(stem(w));
      i += scope.length ? words.slice(i + 1).indexOf(scope[scope.length - 1]) + 1 : 0;
      continue;
    }
    if (STOPWORDS.has(word) || SIDES.has(word) || /^\d/.test(word) || /^[clst]\d{1,2}$/.test(word)) continue;
    // A single letter is kept only where ACR itself pairs it with its
    // neighbour ("type b"); "45 yo m" leaves a stray m otherwise.
    if (word.length === 1) {
      const bigrams = index ? index.bigrams : null;
      if (!bigrams || !(bigrams.has(`${words[i - 1]} ${word}`) || bigrams.has(`${word} ${words[i + 1]}`))) continue;
    }
    // An alias may hand over a soft word with a "~" mark: "blunt abdominal
    // trauma" keeps the abdomen as a soft term for the body-part check.
    if (word.startsWith('~')) {
      soft.push(stem(word.slice(1)));
      continue;
    }
    const term = stem(word);
    if (STOPWORDS.has(term)) continue;
    const base = negatedBase(word, known);
    if (base) {
      negated.push(base);
      continue;
    }
    (SOFT_TERMS.has(term) ? soft : required).push(term);
  }
  // "Suspected cardiac mass, no known cardiac mass" asks about the mass: a
  // term stated positively keeps its positive reading.
  // That holds only for a term the search itself wrote: one that an alias
  // inferred ("leg swelling" read as DVT) gives way to the search's own
  // negation ("leg swelling, DVT ruled out").
  const own = ownWords ? t => ownWords.has(t) : () => true;
  const overruled = new Set(negated.filter(t => !own(t)));
  // A negated diagnosis takes the words an alias wrote for it along.
  for (const t of [...overruled]) for (const kin of NEGATION_KIN[t] || []) if (!own(kin)) overruled.add(kin);
  const stated = new Set([...required, ...soft].filter(t => !overruled.has(t)));
  const negatedSet = new Set(negated.filter(t => !stated.has(t)));
  return {
    required: [...new Set(required)].filter(t => !overruled.has(t)),
    soft: [...new Set(soft)].filter(t => !required.includes(t) && !overruled.has(t)),
    negated: [...negatedSet],
    studyAnatomy: [...studyAnatomy],
  };
}

// The stemmed words a search states positively in its own wording, before any
// alias is read.
function ownPositiveWords(text) {
  const words = joinLowBack(text).replace(/\bnon(?=[a-z]{5,})/g, 'non ').split(/[ _]/).filter(Boolean);
  const own = new Set();
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (word === 'non') { i += 1; continue; }
    if (NEGATION_WORDS.includes(word)) {
      const scope = negationScope(words, i, { bounded: true });
      i += scope.length ? words.slice(i + 1).indexOf(scope[scope.length - 1]) + 1 : 0;
      continue;
    }
    own.add(stem(word));
  }
  return own;
}

/**
 * The complaints of a search, split at "and", "with", commas and sentence
 * breaks after aliases are read, so "shortness of breath" stays one complaint.
 * Each is parsed on its own; the whole search's negation applies to all.
 */
function splitComplaints(query, index) {
  const { words, studyAnatomy } = aliasedWords(query, { keepCommas: true });
  const segments = [];
  let current = [];
  for (const w of words) {
    if (CONJUNCTIONS.has(w)) {
      if (current.length) segments.push(current);
      current = [];
    } else current.push(w);
  }
  if (current.length) segments.push(current);
  const parsed = segments.map(seg => classifyWords(seg, index)).filter(p => p.required.length);
  // The user's own words for each complaint, aligned when the split agrees.
  const raw = joinLowBack(withoutPregnancy(withoutAge(splitStudyPhrases(normalizeSearch(query, { keepCommas: true })).rest)))
    .split(' ').filter(Boolean);
  const labels = [];
  current = [];
  for (const w of raw) {
    if (CONJUNCTIONS.has(w)) {
      if (current.length) labels.push(current);
      current = [];
    } else current.push(w);
  }
  if (current.length) labels.push(current);
  // Labels keep inner words ("shortness of breath") and lose only filler at the
  // edges and numbers.
  const clean = seg => {
    const words = seg.filter(w => !/^\d/.test(w) && !NEGATION_WORDS.includes(w));
    while (words.length && STOPWORDS.has(words[0])) words.shift();
    while (words.length && STOPWORDS.has(words[words.length - 1])) words.pop();
    return words.join(' ');
  };
  const labelled = labels.map(clean).filter(Boolean);
  return parsed.map((p, i) => ({
    ...p,
    label: labelled.length === parsed.length ? labelled[i] : [...p.required, ...p.soft].join(' '),
    studyAnatomy: [...studyAnatomy],
  }));
}

/**
 * Tokens of ACR text, split by polarity: "headache, no red flags" gives
 * positive {headache} and negative {red, flag}.
 */
function parseText(text) {
  const positive = new Set();
  const negative = new Set();
  const clean = String(text).toLowerCase().replace(/\bwith or without\b/g, ' any ').replace(/\bwithout or with\b/g, ' any ');
  for (const clause of clean.split(/[,.;:()\[\]]/)) {
    const words = cleanWords(clause).replace(/\bnon(?=[a-z]{5,})/g, 'non ').split(' ').filter(Boolean);
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      if (word === 'non') {
        if (words[i + 1]) negative.add(stem(words[i + 1]));
        i += 1;
        continue;
      }
      if (NEGATION_WORDS.includes(word)) {
        for (const w of negationScope(words, i, { bounded: false })) negative.add(stem(w));
        // The rest of the clause is negated; move on to the next clause.
        break;
      }
      positive.add(stem(word));
    }
  }
  // ACR says "lumbar ... back pain" where a clinician says low back pain, and
  // "torso" where a clinician names the chest or abdomen.
  if (positive.has('lumbar') && positive.has('back')) positive.add('lowback');
  if (positive.has('torso')) for (const t of ['chest', 'abdomen', 'pelvis']) positive.add(t);
  return { positive, negative };
}

// A GCS range named in a scenario: "GCS 13-15", "GCS<=13", "GCS=15".
function gcsRange(name) {
  const m = name.match(GCS_TEXT_RE);
  if (!m) return null;
  const a = Number(m[2]);
  if (m[3]) return [a, Number(m[3])];
  if (m[1] === '<=') return [3, a];
  if (m[1] === '<') return [3, a - 1];
  if (m[1] === '>=') return [a, 15];
  if (m[1] === '>') return [a + 1, 15];
  return [a, a];
}

// ---- Sizes --------------------------------------------------------------

// ACR writes bounds in words and symbols; both become <, <=, > or >=.
function normalizeSizeText(text) {
  return String(text).toLowerCase()
    .replace(/≤/g, ' <= ').replace(/≥/g, ' >= ')
    .replace(/\b(?:less than or equal to|equal to or less than|no more than|no larger than|not more than|up to|at most)\b/g, ' <= ')
    .replace(/\b(?:greater than or equal to|equal to or greater than|equal to or more than|more than or equal to|at least|no less than|no smaller than)\b/g, ' >= ')
    .replace(/\b(?:less than|smaller than|under|below)\b/g, ' < ')
    .replace(/\b(?:greater than|larger than|more than|over|above|exceeding)\b/g, ' > ')
    .replace(/\s+/g, ' ');
}

const unitMm = unit => (/^c/.test(unit) ? 10 : 1);
const SIZE_RANGE_RE = new RegExp(`(${SIZE_NUM})\\s*(${SIZE_UNIT_RE})?\\s*(?:to|-|–|through|and)\\s*(${SIZE_NUM})\\s*(${SIZE_UNIT_RE})\\b`, 'g');
const SIZE_BOUND_RE = new RegExp(`(<=|>=|<|>)\\s*(${SIZE_NUM})\\s*(${SIZE_UNIT_RE})\\b`, 'g');
const SIZE_TRAILING_RE = new RegExp(`(${SIZE_NUM})\\s*(${SIZE_UNIT_RE})\\s*(?:or|and) (larger|greater|more|bigger|smaller|less|fewer)\\b`, 'g');

/**
 * Size ranges named in ACR text, in millimetres, in order of appearance:
 * "<6mm", ">=6mm", "1-2cm", "1 to 3 cm", "2 cm or less", and "greater than
 * 2 cm and less than 4 cm" as one range. Bounds without a unit (days, pack
 * years, GCS, percentages) are not sizes.
 */
export function parseSizeRanges(text) {
  return sizeSpans(normalizeSizeText(text)).map(({ min, max, minInc, maxInc }) => ({ min, max, minInc, maxInc }));
}

function sizeSpans(t) {
  const found = [];
  const free = (a, b) => !found.some(r => a < r.end && b > r.at);
  const add = (m, range) => found.push({ ...range, at: m.index, end: m.index + m[0].length });
  for (const m of t.matchAll(SIZE_RANGE_RE)) {
    // "> 2 cm and < 4 cm" is two bounds, merged below, not a range of 2 to 4.
    if (/[<>=]\s*$/.test(t.slice(0, m.index))) continue;
    const unit = unitMm(m[4]);
    const lo = Number(m[1]) * (m[2] ? unitMm(m[2]) : unit);
    const hi = Number(m[3]) * unit;
    if (lo <= hi) add(m, { min: lo, max: hi, minInc: true, maxInc: true });
  }
  for (const m of t.matchAll(SIZE_BOUND_RE)) {
    if (!free(m.index, m.index + m[0].length)) continue;
    const v = Number(m[2]) * unitMm(m[3]);
    const op = m[1];
    add(m, op[0] === '<' ? { min: null, max: v, minInc: false, maxInc: op === '<=' } : { min: v, max: null, minInc: op === '>=', maxInc: false });
  }
  for (const m of t.matchAll(SIZE_TRAILING_RE)) {
    if (!free(m.index, m.index + m[0].length)) continue;
    const v = Number(m[1]) * unitMm(m[2]);
    const upward = /^(larger|greater|more|bigger)$/.test(m[3]);
    add(m, upward ? { min: v, max: null, minInc: true, maxInc: false } : { min: null, max: v, minInc: false, maxInc: true });
  }
  found.sort((a, b) => a.at - b.at);
  // A lower bound followed by an upper bound, joined by "and" or a comma, is one range.
  const merged = [];
  for (const r of found) {
    const prev = merged[merged.length - 1];
    if (prev && prev.max === null && r.min === null && r.max !== null && r.max > prev.min &&
        /^[\s,]*(?:and|but)?[\s,]*$/.test(t.slice(prev.end, r.at))) {
      merged[merged.length - 1] = { ...prev, max: r.max, maxInc: r.maxInc, end: r.end };
      continue;
    }
    merged.push(r);
  }
  return merged;
}

const rangeFits = (r, v) =>
  (r.min === null || (r.minInc ? v >= r.min - 1e-9 : v > r.min + 1e-9)) &&
  (r.max === null || (r.maxInc ? v <= r.max + 1e-9 : v < r.max - 1e-9));

// Whether two ranges share any value. Ranges that only touch share the point
// when both include it: "<6mm" and "6 mm" do not, ">=6mm" and "6 mm" do.
function rangesOverlap(a, b) {
  const lo = Math.max(a.min ?? -Infinity, b.min ?? -Infinity);
  const hi = Math.min(a.max ?? Infinity, b.max ?? Infinity);
  if (lo < hi - 1e-9) return true;
  if (Math.abs(lo - hi) > 1e-9) return false;
  const includes = (r, v) => rangeFits(r, v);
  return includes(a, lo) && includes(b, lo);
}

/**
 * Whether a scenario's sizes admit a search's. Sizes are compared in the order
 * each writes them, so "vulvar cancer 1 cm with 0.5 mm invasion" meets ACR's
 * "primary tumor <=2cm, <=1mm stromal invasion" bound for bound.
 */
function sizesFit(docRanges, queryRanges) {
  const n = Math.min(docRanges.length, queryRanges.length);
  for (let i = 0; i < n; i++) if (!rangesOverlap(docRanges[i], queryRanges[i])) return false;
  return true;
}

/**
 * Measurements in a search, as ranges in millimetres: "8 mm" and "4.5cm" are
 * points, "<6mm" and "subcentimeter" are bounds, "1-2 cm" a range.
 */
export function extractSizes(query) {
  const t = normalizeSizeText(query)
    .replace(/\bsub\s*-?\s*centimet(?:er|re)\b|\bsubcentimet(?:er|re)\b|\bsub\s*-?\s*cm\b|\bsubcm\b|\bmillimetric\b/g, ' < 1 cm ');
  const spans = sizeSpans(t);
  const taken = (a, b) => spans.some(s => a < s.end && b > s.at);
  const points = [];
  for (const m of t.matchAll(QUERY_SIZE_RE)) {
    if (taken(m.index, m.index + m[0].length)) continue;
    const v = Number(m[1]) * unitMm(m[2]);
    points.push({ min: v, max: v, minInc: true, maxInc: true, at: m.index });
  }
  return [...spans, ...points].sort((a, b) => a.at - b.at).map(({ min, max, minInc, maxInc }) => ({ min, max, minInc, maxInc }));
}

export function formatSize(mm) {
  return mm < 10 ? `${Number(mm.toFixed(1))} mm` : `${Number((mm / 10).toFixed(1))} cm`;
}

/** A size range as the user would write it: "8 mm", "under 6 mm", "1 cm to 2 cm". */
export function formatRange(r) {
  if (r.min !== null && r.max !== null) return Math.abs(r.min - r.max) < 1e-9 ? formatSize(r.min) : `${formatSize(r.min)} to ${formatSize(r.max)}`;
  if (r.max !== null) return `${r.maxInc ? 'up to' : 'under'} ${formatSize(r.max)}`;
  return `${r.minInc ? 'at least' : 'over'} ${formatSize(r.min)}`;
}

// ---- Ages -------------------------------------------------------------------

// Age ranges in ACR text, in years: "(male<25y)", ">60yo", "Ped 0-9y", "Age
// less than 30", "40 years of age or older", "younger than 25 years of age",
// "Patient 50 to 80 years of age". A number of years is an age only when it
// is written as one: with a cue word before it or "of age" or "old" after it,
// or in ACR's compact "60yo" and "0-9y". Hormone years, pack years and years
// since surgery are not ages.
const AGE_CUE = '(?:age|aged|ped|peds|child|children|adult|adults|male|males|female|females|patient|patients|individuals|women|men|person|persons)';
const AGE_UNIT = '(?:yo|y|yrs?|years?)';
function parseAgeRanges(text) {
  const t = normalizeSizeText(text).replace(/\b(\d{1,3})(yo|y)\b/g, '$1 $2 of age');
  const found = [];
  const add = (m, r) => found.push({ ...r, at: m.index });
  // "age 30 to 39", "ped 0 to 9 y", "adult 30 to 39 years of age"
  for (const m of t.matchAll(new RegExp(`\\b${AGE_CUE}\\b[^.,;:()]{0,24}?\\b(\\d{1,3})\\s*(?:-|to|–)\\s*(\\d{1,3})(?:\\s*${AGE_UNIT}\\b)?(?!\\s*(?:mm|cm|%|pack|month|week|day|hour|min))`, 'g'))) {
    add(m, { min: Number(m[1]), max: Number(m[2]), minInc: true, maxInc: true });
  }
  // "age < 30", "male >= 25 y of age", "age > 65 years"
  for (const m of t.matchAll(new RegExp(`\\b${AGE_CUE}\\b[^.,;:()]{0,24}?(<=|>=|<|>)\\s*(\\d{1,3})(?:\\s*${AGE_UNIT}\\b)?(?!\\s*(?:mm|cm|%|pack|month|week|day|hour|min))`, 'g'))) {
    const v = Number(m[2]);
    add(m, m[1][0] === '<' ? { min: null, max: v, minInc: false, maxInc: m[1] === '<=' } : { min: v, max: null, minInc: m[1] === '>=', maxInc: false });
  }
  // "younger than 25 years", "older than 65"
  for (const m of t.matchAll(new RegExp(`\\b(younger|older) than (\\d{1,3})(?:\\s*${AGE_UNIT}\\b)?(?!\\s*(?:month|week|day))`, 'g'))) {
    const v = Number(m[2]);
    add(m, m[1] === 'younger' ? { min: null, max: v, minInc: false, maxInc: false } : { min: v, max: null, minInc: false, maxInc: false });
  }
  // "40 years of age or older", "5 years of age or older", "25 years or older"
  for (const m of t.matchAll(new RegExp(`\\b(\\d{1,3})\\s*${AGE_UNIT}\\b(?:\\s*of age|\\s*old)?\\s*(?:or|and) (older|greater|more|younger|less)\\b`, 'g'))) {
    const v = Number(m[1]);
    add(m, /^(older|greater|more)$/.test(m[2]) ? { min: v, max: null, minInc: true, maxInc: false } : { min: null, max: v, minInc: false, maxInc: true });
  }
  found.sort((a, b) => a.at - b.at);
  return found.map(({ min, max, minInc, maxInc }) => ({ min, max, minInc, maxInc }));
}

// The ranges a parser finds in a scenario's name, else in its longer text;
// null when neither names any.
function rangesOf(parse, name, text) {
  const inName = parse(name);
  if (inName.length) return inName;
  const inText = parse(text);
  return inText.length ? inText : null;
}

const indexCache = new WeakMap();

const INFANT_TEXT_RE = /\b(infant|infants|newborn|neonate|neonatal|toddler|child|children|pediatric|adolescent|after birth|of life|preterm|premature|months? of age)\b/i;
const PREGNANT_NAME_RE = /\b(pregnan\w*|gestation\w*|trimester|gravid|fetal|fetus|placenta\w*|nuchal translucency|positive beta hcg|hcg positive|twins?)\b/i;

// Data tags a few infant scenarios as adult and a few "adult or skeletally
// mature child" scenarios as pediatric; the text says otherwise.
function populationOf(scenario) {
  const tagged = scenario.age || scenario.ageGroup;
  const text = `${scenario.name} ${scenario.search || scenario.variant || ''} ${scenario.topic || ''}`;
  if (tagged === 'adult' && INFANT_TEXT_RE.test(text) && !/\badult\b/i.test(text)) return 'pediatric';
  if (tagged === 'pediatric' && /\badult or\b/i.test(text)) return 'any';
  return tagged;
}

// A scenario written for one sex, read from its title and name: "Evaluation
// of the Symptomatic Male Breast", "Female Infertility". Null when either.
function sexOf(text) {
  const male = MALE_RE.test(text);
  const female = FEMALE_RE.test(text);
  if (male && !female) return 'male';
  if (female && !male) return 'female';
  return null;
}

function buildIndex(scenarios) {
  const cached = indexCache.get(scenarios);
  if (cached) return cached;
  const docFreq = new Map();
  const nameFreq = new Map();
  const detailFreq = new Map();
  const bigrams = new Set();
  const docs = scenarios.map(s => {
    const shortName = s.name.replace(` (${s.topic})`, '');
    const longName = cleanWords(shortName).split(' ').length > MAX_NAME_WORDS;
    const nameText = longName ? { positive: new Set(), negative: new Set() } : parseText(shortName);
    const detail = parseText(`${longName ? shortName : ''}. ${s.search || ''}. ${s.variant || ''}. ${s.topic || ''}`);
    const keywords = new Set((s.keywords || []).flatMap(k => cleanWords(k).split(' ').map(stem)));
    const named = new Set([...nameText.positive, ...detail.positive]);
    const all = new Set([...named, ...keywords]);
    for (const t of all) docFreq.set(t, (docFreq.get(t) || 0) + 1);
    for (const t of named) detailFreq.set(t, (detailFreq.get(t) || 0) + 1);
    for (const t of nameText.positive) nameFreq.set(t, (nameFreq.get(t) || 0) + 1);
    const words = cleanWords(`${shortName} ${s.search || ''}`).split(' ');
    for (let i = 1; i < words.length; i++) if (words[i - 1].length === 1 || words[i].length === 1) bigrams.add(`${words[i - 1]} ${words[i]}`);
    const lowerName = s.name.toLowerCase();
    const isPregnant = PREGNANT_NAME_RE.test(cleanWords(shortName)) && !/\b(not pregnant|nonpregnant|postpartum|peripartum)\b/i.test(shortName);
    return {
      scenario: s, nameText, detail, keywords, named, all, lowerName, longName, population: populationOf(s), isPregnant,
      // The side a scenario is written for, by a side word or a quadrant; a
      // name too long to be a name is read from its text.
      sides: new Set(SIDES_LIST.filter(side => SIDE_WORDS[side].some(w => (longName ? detail : nameText).positive.has(w)))),
      trimester: /after first trimester|second (?:and|or) third trimester|second trimester|third trimester/.test(lowerName) ? 'late'
        : /first trimester/.test(lowerName) ? 'first' : null,
      literal: new Set(cleanWords(shortName).split(' ').map(stem)),
      sex: sexOf(`${s.topic || ''} . ${shortName}`),
      gcs: gcsRange(shortName),
      // The size and age ranges named, from the name before the longer text.
      sizeRanges: rangesOf(parseSizeRanges, shortName, `${s.search || ''}. ${s.variant || ''}`),
      ageRange: (rangesOf(parseAgeRanges, shortName, `${s.search || ''}. ${s.variant || ''}`) || [])[0] || null,
    };
  });
  const topicCounts = new Map();
  const topicRegionVotes = new Map();
  for (const s of scenarios) {
    if (!s.topic) continue;
    topicCounts.set(s.topic, (topicCounts.get(s.topic) || 0) + 1);
    const votes = topicRegionVotes.get(s.topic) || new Map();
    votes.set(s.region, (votes.get(s.region) || 0) + 1);
    topicRegionVotes.set(s.topic, votes);
  }
  // The data region most of a topic's scenarios sit in.
  const topicRegion = new Map([...topicRegionVotes].map(([topic, votes]) =>
    [topic, [...votes.entries()].sort((a, b) => b[1] - a[1])[0][0]]));
  const titles = new Map();
  const titleKeys = new Map();
  for (const s of scenarios) {
    if (!s.topic || titles.has(s.topic)) continue;
    const parsed = parseText(s.topic.replace(/\bchild\b/gi, ' '));
    const joined = joinLowBack([...parsed.positive].join(' '), { keepBack: true }).split(' ').filter(Boolean).map(stem);
    titles.set(s.topic, { positive: new Set(joined), negative: parsed.negative, key: cleanWords(s.topic).replace(/\s/g, ''), sex: sexOf(s.topic) });
  }
  // Two spellings of one topic title are one topic for choosing purposes.
  for (const [topic, title] of titles) {
    if (!titleKeys.has(title.key)) titleKeys.set(title.key, []);
    titleKeys.get(title.key).push(topic);
  }
  // The data regions each body part's scenarios sit in, read from the data:
  // chest words live in chest, breast and vascular scenarios; a "Headache,
  // fever" scenario names no body part but sits in neuro, where a search for
  // the chest must not reach. A topic whose title names the part counts
  // whatever its share.
  // Only names that write the part itself count, not "torso" standing for it;
  // a region holds the part when it has a fair share or several of its names.
  const termRegions = new Map();
  for (const term of GROUP_OF.keys()) {
    const counts = new Map();
    let total = 0;
    for (const doc of docs) {
      if (!doc.literal.has(term)) continue;
      counts.set(doc.scenario.region, (counts.get(doc.scenario.region) || 0) + 1);
      total++;
    }
    const regions = new Set([...counts].filter(([, n]) => n >= total * MIN_GROUP_REGION_SHARE || n >= MIN_REGION_NAMES).map(([r]) => r));
    // A title that writes the part itself (not "torso" standing for it).
    for (const [topic] of titles) {
      if (cleanWords(topic).split(' ').map(stem).includes(term) && topicRegion.has(topic)) regions.add(topicRegion.get(topic));
    }
    if (regions.size) termRegions.set(term, regions);
  }
  const index = {
    docs, docFreq, nameFreq, detailFreq, bigrams, total: scenarios.length, titles, titleKeys, topicCounts, topicRegion,
    termRegions,
  };
  indexCache.set(scenarios, index);
  return index;
}

function fitsPopulation(doc, { pregnant, notPregnant, age, years, sides, gcs, sex, sizes, trimester }) {
  if (pregnant && !doc.isPregnant) return false;
  if (notPregnant && doc.isPregnant) return false;
  // 8 weeks is not answered by "after first trimester", nor 30 weeks by "first trimester".
  if (trimester && doc.trimester && doc.trimester !== trimester) return false;
  if (age && doc.population !== age && doc.population !== 'any') return false;
  if (sex && doc.sex && doc.sex !== sex) return false;
  // An age in the search must sit inside the age range a scenario names, and
  // a size inside its size range.
  if (years !== null && years !== undefined && doc.ageRange && !rangeFits(doc.ageRange, years)) return false;
  if (sizes && sizes.length && doc.sizeRanges && !sizesFit(doc.sizeRanges, sizes)) return false;
  // Life stage follows a stated age: no postmenopausal answer for a 17 year old.
  if (years !== null && years !== undefined) {
    if (years < 40 && doc.nameText.positive.has('postmenopausal')) return false;
    if (years >= 55 && (doc.nameText.positive.has('premenopausal') || doc.detail.positive.has('reproductive'))) return false;
  }
  if (sides && sides.size) {
    for (const side of SIDES) if (!sides.has(side) && doc.sides.has(side)) return false;
  }
  if (gcs && doc.gcs && (gcs < doc.gcs[0] || gcs > doc.gcs[1])) return false;
  return true;
}

// Negation in the search excludes a scenario that states the term positively,
// unless the scenario itself also negates it somewhere. What implies the term
// counts too: "no fever" rules out sepsis.
function contradictsNegation(doc, negated, { nameOnly = false } = {}) {
  // For a model suggestion the name alone decides: "Seizure, post head trauma"
  // is no answer to "no head injury" whatever its longer text also negates.
  // A name too long to be a name (the variant text itself) is read from its text.
  const stated = doc.longName ? doc.detail : doc.nameText;
  const statesPositively = t => stated.positive.has(t) && !stated.negative.has(t) && (nameOnly || !doc.detail.negative.has(t));
  return negated.some(t => statesPositively(t) || (IMPLIES[t] || []).some(statesPositively));
}

function scoreDocs(parsed, index, qualifiers, { scope } = {}) {
  const scored = [];
  const asked = new Set([...parsed.required, ...parsed.soft]);
  // Regions the search names, through any of its words or its study, as
  // body-part groups for the words a scenario names and as data regions for
  // where it lives. One complaint of several may be held to its own.
  const { groups: askedRegions, anatomy } = scope || scopeOf([...asked]);
  const allowed = allowedRegions(index, anatomy);
  for (const doc of index.docs) {
    const { scenario, nameText, keywords, named } = doc;
    if (!fitsPopulation(doc, qualifiers)) continue;
    if (!parsed.required.every(t => named.has(t))) continue;
    if (contradictsNegation(doc, parsed.negated)) continue;
    // A scenario that names a body part is judged by it; one that names none
    // ("LUQ pain, fever") is judged by the region it lives in.
    const docRegions = groupsOf([...nameText.positive]);
    if (askedRegions.size && docRegions.size && ![...docRegions].some(g => askedRegions.has(g))) continue;
    if (allowed && !docRegions.size && !allowed.has(scenario.region)) continue;
    // Abuse is an accusation: never surfaced unless asked for or the search is
    // about an infant, the population ACR's abuse scenarios describe.
    if (named.has('abuse') && !asked.has('abuse') && !qualifiers.infant) continue;
    // The opposite of what was asked is no answer.
    if (opposes(nameText, asked, { negation: false })) continue;

    let score = 0;
    for (const t of parsed.required) score += nameText.positive.has(t) ? 1 + NAME_MATCH_BONUS : 0.8;
    score /= parsed.required.length || 1;
    for (const t of parsed.soft) {
      if (named.has(t)) score += SOFT_MATCH_BONUS;
      else if (keywords.has(t)) score += KEYWORD_BONUS;
    }
    for (const t of parsed.negated) if (nameText.negative.has(t)) score += NAME_MATCH_BONUS;
    // A scenario whose size range admits the measurement leads those that name none.
    if (qualifiers.sizes && qualifiers.sizes.length && doc.sizeRanges) score += SIZE_FIT_BONUS;

    if (!qualifiers.age && doc.population === 'pediatric') score -= POPULATION_PENALTY;
    if (!qualifiers.pregnant && doc.isPregnant) score -= POPULATION_PENALTY;
    if (nameText.positive.has('initial')) score += INITIAL_BONUS;
    for (const t of UNASKED_QUALIFIERS) if (nameText.positive.has(t) && !asked.has(t)) score -= UNASKED_PENALTY;
    score -= [...nameText.positive].filter(t => !asked.has(t)).length * EXTRA_WORD_PENALTY;
    scored.push({ scenario, score, doc });
  }
  let ranked = scored.sort((a, b) => b.score - a.score);
  // A scenario that negates a word the search asked ("no high risk features"
  // for "high risk features", "no red flags" for "with red flags") gives way
  // to one that states it; alone, it is still the nearest ACR comes.
  if (ranked.some(h => !negatesAsked(h.doc.nameText, asked))) ranked = ranked.filter(h => !negatesAsked(h.doc.nameText, asked));
  // A search that names no age is an adult search when adult scenarios exist;
  // ACR's child scenarios appear only when nothing else fits. A teenager's
  // search keeps both.
  if (!qualifiers.age && !qualifiers.teen && ranked.some(h => h.doc.population !== 'pediatric')) {
    ranked = ranked.filter(h => h.doc.population !== 'pediatric');
  }
  // Likewise, a search that never says male is not answered by scenarios
  // written for men when others fit.
  if (!qualifiers.sex && ranked.some(h => h.doc.sex !== 'male')) ranked = ranked.filter(h => h.doc.sex !== 'male');
  // A search that negates a term ACR itself negates in a name wants those
  // scenarios: "headache no red flags" is the "no red flags" branch.
  if (parsed.negated.length && ranked.some(h => parsed.negated.every(t => h.doc.nameText.negative.has(t)))) {
    ranked = ranked.filter(h => parsed.negated.every(t => h.doc.nameText.negative.has(t)));
  }
  return ranked;
}

function dedupe(scored, max) {
  const seen = new Set();
  const results = [];
  for (const { scenario } of scored) {
    const proc = scenario.top_procedure || scenario.topProcedure;
    const key = `${scenario.name}|${proc ? proc.name : ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(scenario);
    if (results.length >= max) break;
  }
  return results;
}

/**
 * Ranks scenarios for a query. Every required term must match.
 * @param {string} query
 * @param {Array} scenarios
 * @param {Object} options
 * @param {number} options.max - maximum results
 * @param {boolean} options.relaxQualifiers - ignore pregnancy and age, to show
 *   the nearest match when no scenario fits them
 */
export function rankScenarios(query, scenarios, { max = 8, relaxQualifiers = false } = {}) {
  if (!scenarios || scenarios.length === 0) return [];
  const index = buildIndex(scenarios);
  const parsed = parseQuery(query, index);
  if (parsed.required.length === 0 && parsed.soft.length === 0) return [];
  const all = extractQualifiers(query);
  const qualifiers = relaxQualifiers ? { sides: all.sides, sizes: all.sizes } : all;
  return dedupe(scoreDocs(parsed, index, qualifiers), max);
}

/** ACR topics whose titles contain the whole search, closest title first. */
function topicsNaming(parsed, qualifiers, scenarios) {
  if (parsed.required.length === 0) return [];
  const { age, pregnant, notPregnant } = qualifiers;
  const { titles, titleKeys, docs } = buildIndex(scenarios);
  const counts = new Map();
  const pediatric = new Map();
  const pregnantCount = new Map();
  for (const doc of docs) {
    const topic = doc.scenario.topic;
    counts.set(topic, (counts.get(topic) || 0) + 1);
    if (doc.population === 'pediatric') pediatric.set(topic, (pediatric.get(topic) || 0) + 1);
    if (doc.isPregnant) pregnantCount.set(topic, (pregnantCount.get(topic) || 0) + 1);
  }
  const matches = [];
  const asked = new Set([...parsed.required, ...parsed.soft]);
  for (const [topic, title] of titles) {
    if (!parsed.required.every(t => title.positive.has(t))) continue;
    // "(Excluding Spine and Diabetic Foot)" must not open for a diabetic foot.
    if (parsed.required.some(t => title.negative.has(t))) continue;
    const isChildTopic = (pediatric.get(topic) || 0) > counts.get(topic) / 2;
    if ((age === 'pediatric') !== isChildTopic) continue;
    // A topic written for one sex opens only for that sex; a search that
    // names none is not about the male breast.
    if (title.sex === 'male' && qualifiers.sex !== 'male') continue;
    if (title.sex === 'female' && qualifiers.sex === 'male') continue;
    // Life stage follows a stated age here too, as in fitsPopulation.
    if (qualifiers.years != null && qualifiers.years < 40 && title.positive.has('postmenopausal')) continue;
    if (qualifiers.years != null && qualifiers.years >= 55 && title.positive.has('reproductive')) continue;
    const isPregnantTopic = (pregnantCount.get(topic) || 0) > counts.get(topic) / 2;
    if (pregnant && !isPregnantTopic) continue;
    if (notPregnant && isPregnantTopic) continue;
    // Of two spellings of one title, keep the larger topic.
    const twins = titleKeys.get(title.key) || [];
    if (twins.length > 1 && twins.some(t => counts.get(t) > counts.get(topic))) continue;
    const unasked = TITLE_UNASKED.filter(t => title.positive.has(t) && !asked.has(t)).length;
    const extra = [...title.positive].filter(t => !STOPWORDS.has(t) && !asked.has(t)).length + unasked;
    let softHits = parsed.soft.filter(t => title.positive.has(t)).length;
    // A follow-up question prefers the "known" or "treated" topic.
    if (asked.has('follow') && ['known', 'treated', 'post'].some(t => title.positive.has(t))) softHits += 1;
    matches.push({ topic, extra, softHits, unasked, count: counts.get(topic) });
  }
  const best = Math.max(0, ...matches.map(m => m.softHits));
  return matches
    .filter(m => m.softHits === best)
    .sort((a, b) => a.unasked - b.unasked || a.extra - b.extra || b.count - a.count);
}

/** The ACR topic a query most likely means. */
export function chooseTopic(query, scenarios) {
  const parsed = parseQuery(query, buildIndex(scenarios));
  const named = topicsNaming(parsed, extractQualifiers(query), scenarios);
  if (named.length > 0) return { topic: named[0].topic, related: named.slice(1, 4).map(n => n.topic) };
  const hits = rankScenarios(query, scenarios, { max: 40 });
  const scores = new Map();
  hits.forEach((s, rank) => {
    if (s.topic) scores.set(s.topic, (scores.get(s.topic) || 0) + 1 / (rank + 1));
  });
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
  return ranked.length ? { topic: ranked[0], related: ranked.slice(1, 4) } : null;
}

/**
 * Turns one ACR topic into generic guidance: its scenarios grouped by what they
 * recommend, so each group reads as one branch of "it depends".
 */
export function buildTopicGuide(topic, scenarios) {
  const groups = new Map();
  for (const s of scenarios) {
    if (s.topic !== topic || !s.top_tier) continue;
    const key = `${s.top_tier.level}|${[...s.top_tier.studies].sort().join('|')}`;
    if (!groups.has(key)) {
      groups.set(key, { level: s.top_tier.level, studies: s.top_tier.studies, disagreement: false, scenarios: [] });
    }
    const group = groups.get(key);
    group.scenarios.push(s);
    group.disagreement = group.disagreement || s.top_tier.disagreement;
  }
  const order = { 'Usually Appropriate': 0, 'May Be Appropriate': 1, 'Usually Not Appropriate': 2 };
  return [...groups.values()].sort((a, b) =>
    order[a.level] - order[b.level] || b.scenarios.length - a.scenarios.length);
}

// A search that is only a study name ("mra head") asks when to order that study.
function scenariosUsingStudy(query, scenarios) {
  const filler = new Set(['and', 'with', 'without', 'contrast', 'iv', 'of', 'the', 'w', 'wo', 'for']);
  const words = cleanWords(query).split(' ').filter(w => w && !filler.has(w));
  const modalities = new Set(['ct', 'cta', 'mri', 'mra', 'mrv', 'us', 'ultrasound', 'radiography', 'pet']);
  if (words.length < 2 || !words.some(w => modalities.has(w))) return [];
  return scenarios.filter(s => s.top_tier && s.top_tier.level === 'Usually Appropriate' &&
    s.top_tier.studies.some(study => {
      const tokens = new Set(cleanWords(study).split(' '));
      return words.every(w => tokens.has(w));
    }));
}

/**
 * Rule check for suggestions from the semantic model, which reads wording well
 * but cannot be trusted with the details: a suggestion must respect pregnancy,
 * age, side and negation, and must contain every body part the search named.
 */
export function guardSuggestions(query, suggestions, scenarios) {
  const ctx = guardContext(query, scenarios);
  return suggestions.filter(s => guardReason(ctx, s) === null);
}

// ---- Guard equivalences (not yet clinician reviewed) ----
// A word of the search on the left is also named by a scenario that writes
// any entry on the right; an entry that is a list needs all of its words
// ("lower" and "extremity" for the leg). Used for the body-part rule and the
// shared-word rule of the guard only: these say "the same place or thing",
// never "the answer", so they let a correct suggestion through without
// turning a search into one. Written from the train split of the mined
// phrasings (tools/guard_diagnose.mjs) and the red-team gold
// (tests/guard-inference-gold.json); measured on the hold-out.
const GUARD_COVER_SOURCE = {
  // spine
  lowback: ['lumbar', 'lumbosacral', 'thoracolumbar'],
  lumbar: ['lowback', 'lumbosacral', 'thoracolumbar'],
  back: ['spine', 'lumbar', 'thoracic', 'lowback', 'lumbosacral', 'thoracolumbar'],
  spine: ['vertebral', 'lumbar', 'thoracic', 'lumbosacral', 'thoracolumbar', 'lowback'],
  thoracic: ['thoracolumbar', ['mid', 'back']],
  // limbs: a whole limb is named by any of its parts, a part by its bone
  arm: [['upper', 'extremity'], 'humerus', 'forearm', 'elbow', 'wrist', 'hand', 'radius', 'ulna'],
  leg: [['lower', 'extremity'], 'femur', 'thigh', 'tibia', 'fibula', 'knee', 'ankle', 'foot', 'claudication'],
  thigh: ['femur', ['lower', 'extremity']],
  femur: ['thigh', 'hip'],
  hip: ['femur', 'pelvis', 'groin'],
  groin: ['hip', 'inguinal'],
  foot: ['metatarsal', 'metatarsalgia', 'forefoot', 'plantar', 'heel', 'toe', 'calcaneus', 'leg', ['lower', 'extremity']],
  toe: ['foot', 'forefoot', 'metatarsal', 'metatarsalgia'],
  heel: ['foot', 'plantar', 'calcaneus'],
  forearm: ['radius', 'ulna'],
  finger: ['hand'],
  thumb: ['hand'],
  hand: ['finger', 'metacarpal'],
  shoulder: ['humerus', 'clavicle', 'rotator', 'glenohumeral', 'scapula'],
  clavicle: ['shoulder'],
  // chest
  chest: ['thoracic', 'thorax', 'lung', 'mediastinal', 'pleural', 'respiratory', 'rib'],
  lung: ['respiratory', 'pneumonia', 'pleural'],
  heart: ['cad', 'coronary', 'myocardial', 'cardiomyopathy'],
  rib: ['chest'],
  trachea: ['airway'],
  esophagus: ['esophageal', 'dysphagia'],
  breast: ['mammography', 'mammo', 'dcis', 'mastectomy', 'nipple'],
  // head and neck
  head: ['intracranial', 'cerebral', 'cranial', 'skull'],
  cerebral: ['head', 'intracranial', 'cranial'],
  intracranial: ['head', 'cerebral', 'cranial'],
  skull: ['head', 'cranial', 'calvarium'],
  face: ['facial', 'midface', 'zygoma', 'zygomatic', 'maxillofacial', 'hemifacial', 'rhinosinusitis', 'sinusitis'],
  facial: ['face', 'midface', 'maxillofacial', 'hemifacial'],
  jaw: ['mandibular', 'tmj'],
  mandibular: ['jaw', 'tmj'],
  nasal: ['sinonasal', 'rhinosinusitis', 'epistaxis'],
  eye: ['orbit', 'orbital', 'ocular', 'visual', 'vision', 'exophthalmo', 'optic'],
  orbit: ['orbital', 'eye', 'ocular', 'exophthalmo'],
  ear: ['hearing', 'tinnitus', 'otitis', 'vertigo'],
  sinus: ['paranasal', 'sinusitis', 'rhinosinusitis', 'sinonasal'],
  thyroid: ['goiter', 'thyrotoxicosis', 'hypothyroidism', 'hyperthyroidism'],
  // abdomen and pelvis
  abdomen: ['luq', 'ruq', 'rlq', 'llq', 'epigastric', 'abdominopelvic', 'aaa', 'appendicitis'],
  stomach: ['abdomen', 'epigastric', 'peptic', 'gastritis', 'luq', 'ruq', 'rlq', 'llq'],
  pelvis: ['adnexal', 'ovary', 'uterus', 'uterine', 'endometrial', 'gynecological', 'cervix', 'vaginal', 'rlq', 'llq'],
  flank: ['kidney', 'stone', 'pyelonephritis', 'ureter', 'hydronephrosis'],
  kidney: ['pyelonephritis', 'hydronephrosis'],
  bladder: ['urinary', 'uti', 'void'],
  ureter: ['flank', 'stone', 'urinary'],
  liver: ['hcc', 'hepatocellular', 'cirrhosis', 'hepatobiliary'],
  biliary: ['ruq', 'gallbladder', 'cholecystitis', 'cholangitis', 'jaundice'],
  gallbladder: ['ruq', 'biliary', 'cholecystitis'],
  spleen: ['splenomegaly', 'luq'],
  pancrea: ['pancreatitis'],
  bowel: ['colon', 'intestinal', 'enterocolitis', 'crohn'],
  colon: ['bowel', 'diverticulitis', 'colitis'],
  rectum: ['rectal', 'anal', 'anorectal', 'proctitis', 'perianal'],
  aorta: ['aortic', 'aaa', 'aortopathy'],
  uterus: ['uterine', 'endometrial', 'endometrium', 'fibroids', 'adenomyosis'],
  ovary: ['adnexal'],
  adnexal: ['ovary', 'tubal'],
  vaginal: ['vagina', 'gynecological'],
  scrotum: ['testis', 'testicular', 'epididymitis'],
  testis: ['scrotum', 'testicular'],
  prostate: ['bph', 'psa'],
  // lay words for a finding
  appendix: ['appendicitis', 'appendiceal'],
  cramp: ['claudication'],
  wobbly: ['ataxia'],
  unsteady: ['ataxia'],
  clumsy: ['ataxia'],
  droopy: ['weakness', 'palsy'],
  stuffy: ['rhinosinusitis', 'sinusitis'],
  choked: ['aspirated'],
  choking: ['aspirated'],
  birth: ['neonatal', 'antenatal'],
};
const GUARD_COVER = new Map(Object.entries(GUARD_COVER_SOURCE).map(([term, alts]) =>
  [stem(term), alts.map(a => (Array.isArray(a) ? a.map(stem) : [stem(a)]))]));
// Body parts for the guard: the answer rules' list plus parts ACR has no
// scenario named for, so they are never matched by the word alone.
const GUARD_PARTS = new Set([...ANATOMY, 'heel', 'thumb', 'testis', 'trachea', 'clavicle', 'cerebral', 'intracranial', 'arm'].map(stem));
// Body parts too broad to make a scenario about another part "the wrong organ".
const GUARD_BROAD = new Set(['upper', 'lower', 'extremity', 'back', 'lowback', 'spine', 'cervical', 'thoracic', 'lumbar', 'sacrum', 'abdomen', 'pelvis', 'chest', 'head', 'face', 'facial', 'leg', 'arm', 'bone', 'joint',
  'muscle', 'tendon', 'ligament', 'stomach', 'bowel', 'flank', 'groin']);

const SPINE_WORDS = new Set(['lumbar', 'lowback', 'spine', 'back', 'thoracic', 'sacrum']);

// Whether a scenario names a word of the search, in its own words or through
// an equivalence.
function covers(doc, term) {
  if (doc.all.has(term)) return true;
  const alts = GUARD_COVER.get(term);
  return Boolean(alts) && alts.some(words => words.every(w => doc.all.has(w)));
}
const sameThing = (a, b) => a === b || (GUARD_COVER.get(a) || []).some(words => words.includes(b)) ||
  (GUARD_COVER.get(b) || []).some(words => words.includes(a));

// A scenario named for another organ of the same region and not for the one
// asked: womb cancer is not cervical or ovarian cancer, a broken nose not a
// mandibular fracture. Organs an equivalence ties together do not conflict.
function guardWrongOrgan(doc, anatomy) {
  const named = [...doc.nameText.positive].filter(t => GROUP_OF.has(t) && !GUARD_BROAD.has(t));
  return anatomy.some(a => !GUARD_BROAD.has(a) && GROUP_OF.has(a) && !named.some(b => sameThing(a, b)) &&
    named.some(b => !anatomy.some(x => sameThing(x, b)) && GROUP_OF.get(b) === GROUP_OF.get(a)));
}

function guardContext(query, scenarios) {
  const index = buildIndex(scenarios);
  const parsed = parseQuery(query, index);
  const qualifiers = extractQualifiers(query);
  if (!index.docsById) index.docsById = new Map(index.docs.map(d => [String(d.scenario.id), d]));
  const asked = new Set([...parsed.required, ...parsed.soft]);
  // "upper extremity" is the arm and "lower extremity" the leg: one place.
  let anatomy = parsed.required.filter(t => GUARD_PARTS.has(t));
  for (const [level, limb] of [['upper', 'arm'], ['lower', 'leg']]) {
    if (anatomy.includes(level) && anatomy.includes('extremity')) {
      anatomy = [...anatomy.filter(t => t !== level && t !== 'extremity' && t !== limb), limb];
    }
  }
  anatomy = anatomy.filter(t => t !== 'extremity' || !anatomy.some(x => x === 'arm' || x === 'leg'));
  // An abdominal aortic aneurysm is in the aorta, though "AAA" names no part.
  if (asked.has('aaa') && !anatomy.includes('aorta')) anatomy.push('aorta');
  // The quadrant the search names, or the one its diagnosis belongs to.
  let quadrants = [...asked].filter(t => QUADRANTS.has(t));
  if (!quadrants.length) quadrants = [...new Set([...asked].map(t => QUADRANT_OF[t]).filter(Boolean))];
  // A teenager's search is answered from ACR's child scenarios when one fits.
  const childFits = qualifiers.teen && index.docs.some(d => d.population === 'pediatric' && parsed.required.every(t => covers(d, t)));
  return { index, parsed, qualifiers, anatomy, asked, quadrants, childFits };
}

// Why the guard removes a suggestion, or null when it may be shown.
function guardReason({ index, parsed, qualifiers, anatomy, asked, quadrants, childFits }, s) {
  const doc = index.docsById.get(String(s.id));
  if (!doc) return 'unknown';
  if (!fitsPopulation(doc, qualifiers)) return 'population';
  if (!qualifiers.pregnant && doc.isPregnant) return 'pregnant';
  if (!qualifiers.age && !qualifiers.teen && doc.population === 'pediatric') return 'pediatric';
  if (childFits && doc.population === 'adult' && !doc.ageRange) return 'teen';
  if (!qualifiers.sex && doc.sex === 'male') return 'sex';
  if (doc.named.has('abuse') && !asked.has('abuse')) return 'abuse';
  if (contradictsNegation(doc, parsed.negated, { nameOnly: true })) return 'negated';
  // The opposite of what was asked (chronic for acute, nonpulsatile for
  // pulsatile, "no trauma" for an injury) is no suggestion.
  if (opposes(doc.nameText, asked)) return 'opposite';
  // A lumbar hernia is in the abdominal wall, not the lumbar spine.
  if (doc.nameText.positive.has('hernia') && !asked.has('hernia') && anatomy.some(t => SPINE_WORDS.has(t))) return 'homonym';
  const docQuadrants = [...doc.nameText.positive].filter(t => QUADRANTS.has(t));
  if (quadrants.length && docQuadrants.length && !docQuadrants.some(q => quadrants.includes(q))) return 'quadrant';
  // Sharing no clinical word is a guess (varicocele -> varicose veins).
  if (parsed.required.length > 0 && !parsed.required.some(t => covers(doc, t))) return 'shared';
  const missing = anatomy.find(t => !covers(doc, t));
  if (missing) return `anatomy:${missing}`;
  return guardWrongOrgan(doc, anatomy) ? 'organ' : null;
}

/** For tooling: why the guard removes a scenario for a search (null when it passes), and how the search was read. */
export function _guardReason(query, scenario, scenarios) {
  const ctx = guardContext(query, scenarios);
  return { reason: guardReason(ctx, scenario), required: ctx.parsed.required, soft: ctx.parsed.soft, negated: ctx.parsed.negated };
}

// Damerau-Levenshtein, so a swapped pair ("thyriod") is one edit.
function editDistance(a, b, cap) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const rows = [Array.from({ length: b.length + 1 }, (_, i) => i)];
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      let best = Math.min(rows[i - 1][j] + 1, row[j - 1] + 1, rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) best = Math.min(best, rows[i - 2][j - 2] + 1);
      row[j] = best;
    }
    rows.push(row);
  }
  return rows[a.length][b.length];
}

const aliasWords = table => new Set(table.flatMap(([from]) => from.split(' ')).concat(CONTEXT_ALIASES.map(c => c.phrase).flatMap(p => p.split(' '))));
let ALIAS_WORDS = aliasWords(ALIASES);

/**
 * For the alias-mining tools: swaps the mined table in place so candidates can
 * be tried without reloading the module. The hand-written table is untouched.
 */
export function _setMinedAliases(mined) {
  ALIASES = mergeAliases(HAND_ALIASES, mined);
  ALIAS_WORDS = aliasWords(ALIASES);
}

/** For tooling: the alias table in force, and the hand-written part of it. */
export function _aliasTables() {
  return { all: ALIASES.map(p => [...p]), hand: HAND_ALIASES.map(p => [...p]) };
}

/**
 * For tooling: a phrase as the alias step sees it, so a mined alias is written
 * in the form that will match: lowercase, punctuation and "the" gone, ACR's
 * two-way phrases in their short form ("dvt"), ages and study names removed.
 */
export function _normalizeAliasPhrase(text) {
  return withoutAge(splitStudyPhrases(normalizeSearch(text)).rest).replace(/\bthe\b/g, ' ').replace(/\s+/g, ' ').trim();
}

// Corrects misspelled words against the vocabulary of ACR scenario names, one
// edit at most. Short words, known words, and negating forms of known words
// (afebrile) are left alone: one letter separates many unrelated clinical terms.
function correctSpelling(query, scenarios) {
  const index = buildIndex(scenarios);
  const { docFreq, nameFreq } = index;
  let changed = false;
  const words = normalizeSearch(query).split(' ').map(word => {
    if (word.length < MIN_CORRECTABLE_LENGTH || STOPWORDS.has(word) || /\d/.test(word)) return word;
    if (docFreq.has(stem(word)) || EQUIVALENT[word] || ALIAS_WORDS.has(word) || SOFT_TERMS.has(word)) return word;
    if (negatedBase(word, docFreq)) return word;
    let best = null;
    for (const [term, freq] of nameFreq) {
      if (term.length < MIN_CORRECTABLE_LENGTH || STOPWORDS.has(term) || SOFT_TERMS.has(term)) continue;
      if (editDistance(word, term, 1) <= 1 && (!best || freq > nameFreq.get(best))) best = term;
    }
    if (!best) return word;
    changed = true;
    return best;
  });
  return changed ? words.join(' ') : null;
}

/**
 * Decides what a search should show. Returns one of:
 *   { mode: 'guide', topic, related, notice? }   a search that names one ACR topic
 *   { mode: 'choose', topics, notice?, groups? } several topics fit; the user picks.
 *                                               groups: [{ complaint, topics }] when
 *                                               each complaint of several has its own
 *   { mode: 'list', scenarios, notice? }         specific search
 *   { mode: 'too-broad' }                        a word that points at no one topic
 *   { mode: 'recover', understood, unknown, groups, region }
 *                                               nothing matched; places to explore:
 *                                               groups [{ term, display, topics }],
 *                                               region { key, label } or null
 *   { mode: 'none', understood, unknown, reason } nothing matched and nothing to
 *                                               suggest; ACR does not cover it
 * Topics carry { topic, count, query }: query is the search a chip should run,
 * which keeps the search's pregnancy or age.
 */
export function resolveQuery(query, scenarios) {
  const corrected = correctSpelling(query, scenarios);
  const result = resolveExact(query, scenarios);
  if (!corrected) return result;
  const fixed = resolveExact(corrected, scenarios);
  const answered = r => !['none', 'recover'].includes(r.mode);
  if (answered(fixed)) return { ...fixed, corrected };
  if (answered(result)) return result;
  // Neither is an answer; the corrected spelling explains more when it has topics.
  return fixed.mode === 'recover' && result.mode !== 'recover' ? { ...fixed, corrected } : result;
}

function withPopulationNotice(scenarios, docsById, { age, pregnant }) {
  if (age || pregnant) return undefined;
  const pediatricOnly = scenarios.every(s => docsById.get(String(s.id))?.population === 'pediatric');
  return pediatricOnly ? 'Only pediatric scenarios match this search; ACR has no adult scenario for it.' : undefined;
}

// Generic words that may be dropped from a search that otherwise matches
// nothing, least informative first: "swollen painful knee" keeps knee pain.
// Not "trauma", "fracture" or "tumor": those carry the question ("wrist trauma
// deformity" is not a wrist vascular malformation).
const DROPPABLE = ['swelling', 'normal', 'disease', 'lesion', 'pain', 'mass'];

// Body parts too large to point at one ACR question by themselves.
const VAGUE_PARTS = new Set(['arm', 'leg', 'extremity', 'limb', 'upper', 'lower']);
// Generic, or only the mechanism: "leg trauma" is as unspecific as "leg pain".
const VAGUE_COMPANIONS = new Set(['trauma']);

// The words a search would drop if nothing matches: a generic word ("pain",
// "mass") or a modifier ACR uses often in variant text but never in a name. A
// disease word is never dropped, so "tension pneumothorax" cannot become
// tension headache and "lymphoma staging" cannot become melanoma staging.
function droppableTerms(parsed, index) {
  // Dropping the only clinical word leaves just a body part: "arm pain" is not
  // a question about whatever ACR files under "upper extremity" (DVT, dialysis
  // access). That search belongs on the recovery screen instead.
  if (parsed.required.filter(t => !ANATOMY.has(t)).length <= 1) return [];
  const rank = t => (DROPPABLE.includes(t) ? DROPPABLE.indexOf(t) : DROPPABLE.length);
  return parsed.required
    .filter(t => !ANATOMY.has(t) && (DROPPABLE.includes(t) ||
      ((index.nameFreq.get(t) || 0) === 0 && (index.detailFreq.get(t) || 0) >= MIN_DROPPABLE_FREQUENCY)))
    .sort((a, b) => rank(a) - rank(b) || (index.docFreq.get(b) || 0) - (index.docFreq.get(a) || 0));
}

// A word that can stand for a complaint on its own or point a recovery at a
// topic: named by some scenario, by few enough to mean something, and not a
// generic finding or a stage of care.
function isSpecific(term, index) {
  if (RECOVERY_GENERIC.has(term) || SOFT_TERMS.has(term) || UNASKED_QUALIFIERS.includes(term)) return false;
  const named = index.nameFreq.get(term) || 0;
  return named > 0 && named <= index.total * MAX_SPECIFIC_SHARE;
}

// The body parts some words name: as groups, for the words a scenario or
// title names, and as the words themselves, for the data regions they live in.
function scopeOf(terms) {
  const anatomy = terms.filter(t => GROUP_OF.has(t));
  return { groups: groupsOf(anatomy), anatomy };
}

// The data regions a scenario may come from when the search names body parts:
// the regions those parts' scenarios sit in, plus the general ones. Null when
// the search names no body part.
function allowedRegions(index, anatomy) {
  const known = anatomy.filter(t => index.termRegions.has(t));
  if (!known.length) return null;
  return new Set(['other', ...known.flatMap(t => [...index.termRegions.get(t)])]);
}

// A scenario that names a different organ of the same region, and not the one
// asked, is about that other organ: a renal cyst search is not answered by a
// pancreatic cyst. Spine words are near-synonyms and are not held to this;
// nor are sides and limbs in general.
const ORGAN_EXEMPT = new Set(['upper', 'lower', 'extremity', 'back', 'lowback', 'spine', 'cervical', 'thoracic', 'lumbar', 'sacrum']);
function wrongOrgan(doc, anatomy) {
  const docAnatomy = [...doc.nameText.positive].filter(t => GROUP_OF.has(t) && !ORGAN_EXEMPT.has(t));
  // A part the search also named is never the wrong organ ("groin and hip").
  return anatomy.some(a => !ORGAN_EXEMPT.has(a) && !doc.nameText.positive.has(a) &&
    docAnatomy.some(b => b !== a && !anatomy.includes(b) && GROUP_OF.get(b) === GROUP_OF.get(a)));
}

// A topic title offered as a suggestion must sit in a region the search named
// (by its words and by where its scenarios live), must not be the opposite of
// what was asked, and must not state a word the search negated.
function titleCompatible(topic, index, asked, scope, negated) {
  const title = index.titles.get(topic);
  if (!title) return false;
  const groups = groupsOf([...title.positive]);
  if (scope.groups.size && groups.size && ![...groups].some(g => scope.groups.has(g))) return false;
  const allowed = allowedRegions(index, scope.anatomy);
  if (allowed && !groups.size && !allowed.has(index.topicRegion.get(topic))) return false;
  if (negated.some(t => title.positive.has(t))) return false;
  return !opposes(title, asked);
}

// A scenario offered as a suggestion passes every check an answer passes:
// population, negation, body region and organ, side, the abuse rule and
// antonyms. The organ check always uses every body part the search named.
function suggestible(doc, index, parsed, qualifiers, asked, scope, population = qualifiers) {
  if (!fitsPopulation(doc, population)) return false;
  // A search that names no pregnancy is not shown a scenario written for one.
  if (!qualifiers.pregnant && doc.isPregnant) return false;
  if (contradictsNegation(doc, parsed.negated)) return false;
  const docRegions = groupsOf([...doc.nameText.positive]);
  if (scope.groups.size && docRegions.size && ![...docRegions].some(g => scope.groups.has(g))) return false;
  const allowed = allowedRegions(index, scope.anatomy);
  if (allowed && !docRegions.size && !allowed.has(doc.scenario.region)) return false;
  if (wrongOrgan(doc, [...asked].filter(t => GROUP_OF.has(t)))) return false;
  if (doc.named.has('abuse') && !asked.has('abuse') && !qualifiers.infant) return false;
  return !opposes(doc.nameText, asked);
}

// The share of a list held by its commonest value, and that value.
function dominant(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  const [best, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] || [null, 0];
  return { best, share: values.length ? n / values.length : 0 };
}

// Whether a word belongs to one body region by itself: the scenarios naming
// "headache" sit in neuro and those naming "dyspnea" in the chest, while
// "fever" and "abscess" name topics all over the body, however many of them
// happen to be abdominal.
function localizes(term, index) {
  if (!index.localizing) index.localizing = new Map();
  if (index.localizing.has(term)) return index.localizing.get(term);
  const naming = index.docs.filter(d => d.nameText.positive.has(term));
  const { best, share } = dominant(naming.map(d => d.scenario.region));
  const elsewhere = new Set(naming.filter(d => d.scenario.region !== best && d.scenario.region !== 'other').map(d => d.scenario.topic));
  const result = share >= MIN_REGION_SHARE && elsewhere.size <= 1;
  index.localizing.set(term, result);
  return result;
}

// The body regions suggestions for some words are held to. Words that are
// body parts, or that belong to one region by themselves, carry their own:
// in "headache and knee pain" the headache is not a knee question. A word
// that belongs nowhere in particular ("fever") borrows the regions the rest
// of the search named.
function scopeFor(terms, index, asked) {
  const own = scopeOf(terms);
  if (own.groups.size) return own;
  return terms.some(t => localizes(t, index)) ? scopeOf([]) : scopeOf([...asked]);
}

/**
 * Ranks the topics of scenarios that name some words: topics whose title
 * names one of the words first, then by how many scenarios point there. A
 * topic pointed at only in passing (few of its scenarios, a small share of
 * them) is left out, and so is one whose title adds a stage or population
 * that was not asked, unless its title names the word itself.
 */
function topicsFor(terms, docs, index, asked) {
  const votes = new Map();
  const named = new Map();
  for (const doc of docs) {
    const topic = doc.scenario.topic;
    if (!topic) continue;
    // A scenario that also names another asked word points more surely.
    const weight = 1 + [...asked].filter(t => !terms.includes(t) && doc.nameText.positive.has(t)).length;
    votes.set(topic, (votes.get(topic) || 0) + weight);
    named.set(topic, (named.get(topic) || 0) + 1);
  }
  const title = topic => index.titles.get(topic);
  const titleNames = topic => Boolean(title(topic) && terms.some(t => title(topic).positive.has(t)));
  return [...votes.keys()]
    .filter(topic => {
      const n = named.get(topic);
      // A topic that holds every scenario naming the word is the word's home
      // ("Inflammatory Ear Disease" for otitis), whatever its title adds.
      if (n < docs.length && unaskedTitle(topic, index, asked)) return false;
      if (titleNames(topic)) return true;
      // Enough of the topic, enough scenarios, or most of what names the word at all.
      return n / (index.topicCounts.get(topic) || 1) >= MIN_TOPIC_SHARE || n >= MIN_TOPIC_SCENARIOS || n * 2 >= docs.length;
    })
    .sort((a, b) => Number(titleNames(b)) - Number(titleNames(a)) || votes.get(b) - votes.get(a));
}

// A title that adds a stage, mechanism or population the search never named.
function unaskedTitle(topic, index, asked) {
  const title = index.titles.get(topic);
  return Boolean(title) && [...UNASKED_QUALIFIERS, ...TITLE_UNASKED].some(t => title.positive.has(t) && !asked.has(t));
}

// The search a topic chip runs: the title, kept to the search's pregnancy or
// age so what it opens is still filtered.
function topicQuery(topic, qualifiers) {
  if (qualifiers.pregnant && !/pregnan/i.test(topic)) return `${topic} pregnant`;
  if (qualifiers.age === 'pediatric' && !/child|infant|pediatric|neonat/i.test(topic)) return `${topic} child`;
  return topic;
}

// Topics for one complaint of several: titles naming it, else the topics its
// best scenarios belong to, held to the whole search's regions, population
// and negation.
function complaintTopics(seg, parsed, qualifiers, index, scenarios) {
  const segParsed = { ...seg, negated: parsed.negated };
  const asked = new Set([...parsed.required, ...parsed.soft]);
  const scope = scopeFor([...seg.required, ...seg.soft], index, asked);
  // Of the titles naming the complaint, the plain ones first.
  const named = topicsNaming(segParsed, qualifiers, scenarios);
  const plain = named.filter(n => !unaskedTitle(n.topic, index, asked));
  let topics = (plain.length ? plain : named).map(n => n.topic);
  if (topics.length === 0) {
    const hits = scoreDocs(segParsed, index, qualifiers, { scope })
      .filter(h => suggestible(h.doc, index, parsed, qualifiers, asked, scope))
      .map(h => h.doc);
    topics = topicsFor(seg.required.filter(t => isSpecific(t, index)), hits, index, asked);
  }
  return topics
    .filter(t => titleCompatible(t, index, asked, scope, parsed.negated))
    .slice(0, MAX_RECOVERY_TOPICS)
    .map(t => ({ topic: t, count: index.topicCounts.get(t) || 0, query: topicQuery(t, qualifiers) }));
}

/**
 * A search of several complaints that no one scenario covers: each
 * complaint's topics, grouped by complaint, instead of dropping a complaint.
 * Needs two complaints that each carry a specific word and each find topics.
 */
function multiComplaint(query, parsed, qualifiers, index, scenarios) {
  const segments = splitComplaints(query, index).filter(seg => seg.required.some(t => isSpecific(t, index)));
  if (segments.length < 2) return null;
  const groups = segments
    .map(seg => ({ complaint: seg.label, topics: complaintTopics(seg, parsed, qualifiers, index, scenarios) }))
    .filter(g => g.topics.length);
  if (groups.length < 2) return null;
  const seen = new Set();
  const topics = groups.flatMap(g => g.topics).filter(t => !seen.has(t.topic) && seen.add(t.topic));
  return {
    mode: 'choose', grouped: true, groups, topics,
    notice: 'No single ACR scenario covers all of these together. These are the topics for each complaint.',
  };
}

// The word of the search a stemmed term came from, for display.
function originalWord(query, term) {
  const tokens = normalizeSearch(query).split(' ').filter(Boolean);
  return tokens.find(w => stem(w) === term) || term;
}

/**
 * Explains a search nothing matched, instead of refusing it: the words
 * understood and the words ACR never uses, the topics each understood word
 * points at, and the likely body region. A word that points nowhere safe is
 * left out, and with no topics at all the answer is an honest "none".
 */
// ACR files limb complaints under the joint or segment, so a whole-limb search
// is offered each part's topics, read with the search's own words ("knee" with
// "trauma" opens Acute Trauma to the Knee).
const LIMB_PARTS = {
  arm: ['shoulder', 'elbow', 'forearm', 'wrist', 'hand'],
  leg: ['hip', 'thigh', 'knee', 'ankle', 'foot'],
};

function limbRecovery(query, parsed, qualifiers, index, scenarios) {
  const has = t => parsed.required.includes(t);
  const limb = has('arm') || (has('upper') && has('extremity')) ? 'arm'
    : has('leg') || (has('lower') && has('extremity')) ? 'leg' : null;
  if (!limb) return null;
  const words = parsed.required.filter(t => !VAGUE_PARTS.has(t));
  const groups = [];
  const shown = new Set();
  for (const part of LIMB_PARTS[limb].map(stem)) {
    const withWords = topicsNaming({ ...parsed, required: [part, ...words] }, qualifiers, scenarios);
    const named = withWords.length ? withWords : topicsNaming({ ...parsed, required: [part] }, qualifiers, scenarios);
    // Follow-up topics ("Imaging After Total Hip Arthroplasty") wait to be asked for.
    const followUp = n => !parsed.required.includes('arthroplasty') && index.titles.get(n.topic).positive.has('arthroplasty');
    const topics = named.filter(n => !shown.has(n.topic) && n.unasked === 0 && !followUp(n)).slice(0, MAX_RECOVERY_TOPICS)
      .map(n => ({ topic: n.topic, count: n.count, query: topicQuery(n.topic, qualifiers) }));
    if (topics.length === 0) continue;
    for (const t of topics) shown.add(t.topic);
    groups.push({ term: part, display: part, topics, scenarios: [], pediatricOnly: false });
  }
  if (groups.length === 0) return null;
  const terms = [...new Set([...parsed.required, ...parsed.soft])];
  return {
    mode: 'recover',
    understood: terms.map(t => originalWord(query, t)),
    unknown: [],
    groups,
    topics: groups.flatMap(g => g.topics),
    scenarios: [],
    region: qualifiers.age === 'pediatric' ? { key: 'peds', label: REGION_LABELS.peds } : { key: 'msk', label: REGION_LABELS.msk },
  };
}

const CHILD_TITLE_RE = /\bChild\b|\bChildren\b|\bInfants?\b|\bPediatric\b|\bNeonat\w+/;

function recover(query, parsed, qualifiers, index, scenarios) {
  const terms = [...new Set([...parsed.required, ...parsed.soft])];
  const knownTerm = t => (index.docFreq.get(t) || 0) > 0;
  const unknown = parsed.required.filter(t => !knownTerm(t)).map(t => originalWord(query, t));
  const understood = terms.filter(knownTerm).map(t => originalWord(query, t));
  const asked = new Set(terms);
  const groups = [];
  const regionVotes = new Map();
  // A search about the arm is never offered leg topics, nor the reverse.
  const askedLimb = asked.has('arm') || (asked.has('upper') && asked.has('extremity')) ? 'arm'
    : asked.has('leg') || (asked.has('lower') && asked.has('extremity')) ? 'leg' : null;
  const otherParts = askedLimb ? LIMB_PARTS[askedLimb === 'arm' ? 'leg' : 'arm'].map(stem) : [];
  const otherLimb = topic => otherParts.some(part => index.titles.get(topic).positive.has(part));
  const shown = new Set();
  // A word is read with the complaint it sits in: the cyst of "bone cyst"
  // belongs to the bone, while in "headache and knee pain" each complaint
  // keeps its own region.
  const segments = splitComplaints(query, index);
  const segmentOf = term => segments.find(seg => seg.required.includes(term) || seg.soft.includes(term));
  // The rarest word first: "nodule" before "lung".
  const specific = terms.filter(t => isSpecific(t, index))
    .sort((a, b) => (index.nameFreq.get(a) || 0) - (index.nameFreq.get(b) || 0));
  for (const term of specific) {
    const naming = index.docs.filter(doc => doc.nameText.positive.has(term));
    // A word written in a scenario or two that share nothing else with the
    // search is too thin to point anywhere beside the search's other words:
    // the "hilar" of a hilar cholangiocarcinoma is not hilar adenopathy.
    if (specific.length > 1 && naming.length < MIN_TOPIC_SCENARIOS &&
        !naming.some(doc => [...asked].some(t => t !== term && doc.nameText.positive.has(t)))) continue;
    // With no body part asked, a word must belong to one region to point anywhere.
    const seg = segmentOf(term);
    const scope = scopeFor(seg ? [...seg.required, ...seg.soft] : [term], index, asked);
    if (!scope.groups.size && !localizes(term, index) && !GROUP_OF.has(term)) continue;
    // Scenarios that also name a body part the search named are about the
    // right organ: "thyroid nodule" is not pointed at lung nodules, and when
    // none of those pass the checks, nothing else stands in for them.
    const askedAnatomy = [...asked].filter(t => GROUP_OF.has(t) && !ORGAN_EXEMPT.has(t));
    const consistent = naming.filter(doc => askedAnatomy.some(a => doc.nameText.positive.has(a)));
    let docs = (consistent.length ? consistent : naming).filter(doc => suggestible(doc, index, parsed, qualifiers, asked, scope));
    // A search that names no age is an adult search when adult scenarios
    // exist, unless the word is a child's ("scoliosis"), when both are kept.
    let pediatricOnly = false;
    if (!qualifiers.age && !qualifiers.teen) {
      const adult = docs.filter(d => d.population !== 'pediatric');
      if (adult.length >= docs.length * MIN_ADULT_SHARE) docs = adult;
      else pediatricOnly = adult.length === 0 && docs.length > 0;
    }
    if (!qualifiers.sex && docs.some(d => d.sex !== 'male')) docs = docs.filter(d => d.sex !== 'male');
    if (docs.length === 0) continue;
    const topics = topicsFor([term], docs, index, asked)
      .filter(topic => !shown.has(topic) && titleCompatible(topic, index, asked, scope, parsed.negated) && !otherLimb(topic))
      // A search that names no age is not offered a topic written for children
      // beside an adult one.
      .filter((topic, i, list) => qualifiers.age || qualifiers.teen || pediatricOnly || !CHILD_TITLE_RE.test(topic) || list.every(t => CHILD_TITLE_RE.test(t)))
      .slice(0, MAX_RECOVERY_TOPICS)
      .map(topic => ({ topic, count: index.topicCounts.get(topic) || 0, query: topicQuery(topic, qualifiers) }));
    if (topics.length === 0) continue;
    for (const t of topics) shown.add(t.topic);
    // The region is read from the scenarios behind the topics offered, and
    // the scenarios that name most of the search are offered themselves.
    const offered = new Set(topics.map(t => t.topic));
    const behind = docs.filter(doc => offered.has(doc.scenario.topic));
    for (const doc of behind) regionVotes.set(doc.scenario.region, (regionVotes.get(doc.scenario.region) || 0) + 1);
    const namesAsked = doc => [...asked].filter(t => doc.nameText.positive.has(t)).length;
    const picks = dedupe(behind
      .map(doc => ({ scenario: doc.scenario, score: namesAsked(doc) - [...doc.nameText.positive].length * EXTRA_WORD_PENALTY }))
      .sort((a, b) => b.score - a.score), MAX_RECOVERY_SCENARIOS);
    groups.push({ term, display: originalWord(query, term), topics, scenarios: picks, pediatricOnly });
  }
  if (groups.length === 0) {
    const reason = terms.length === 0 ? 'no-clinical-words'
      : parsed.required.length && unknown.length === parsed.required.length ? 'unknown-words' : 'uncovered';
    return { mode: 'none', understood, unknown, reason };
  }
  let region = null;
  if (qualifiers.age === 'pediatric') region = { key: 'peds', label: REGION_LABELS.peds };
  else {
    const total = [...regionVotes.values()].reduce((a, b) => a + b, 0);
    const [best, n] = [...regionVotes.entries()].sort((a, b) => b[1] - a[1])[0] || [];
    if (best && REGION_LABELS[best] && n >= total * MIN_REGION_SHARE) region = { key: best, label: REGION_LABELS[best] };
  }
  // Everything offered, flat, for callers and tests that read one list.
  const topics = groups.flatMap(g => g.topics);
  const suggested = dedupe(groups.flatMap(g => g.scenarios.map(scenario => ({ scenario }))), MAX_RECOVERY_SCENARIOS * 2);
  return { mode: 'recover', understood, unknown, groups, topics, scenarios: suggested, region };
}

/** URL slug of an ACR topic's static page; mirrors topic_slug in tools/generate_static_pages.py. */
export function topicSlug(topic) {
  return String(topic).toLowerCase()
    .replace(/[\u2013\u2014/:(),-]/g, ' ')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9 ]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

// Presentations ACR files under several topics, none of which names them. A
// search that would otherwise end without an answer asks which is meant.
// Not yet clinician reviewed; see tests/clinical-gold.json.
const CLARIFY = [
  { phrase: 'foot drop', topics: ['Low Back Pain', 'Plexopathy', 'Myelopathy'] },
  { phrase: 'wrist drop', topics: ['Cervical Pain or Cervical Radiculopathy', 'Plexopathy'] },
];

function clarify(query, scenarios) {
  const text = ` ${cleanWords(query)} `;
  const entry = CLARIFY.find(c => text.includes(` ${c.phrase} `));
  if (!entry) return null;
  const { topicCounts } = buildIndex(scenarios);
  const topics = entry.topics.filter(t => topicCounts.has(t)).map(t => ({ topic: t, count: topicCounts.get(t), query: t }));
  if (topics.length < 2) return null;
  return {
    mode: 'choose',
    topics,
    notice: `ACR has no scenario named for ${entry.phrase}. Which of these fits the presentation?`,
  };
}

// ---- Clinical inference, offered as a question ----
// NOT YET CLINICIAN REVIEWED. Each entry is a presentation that implies a
// diagnosis ACR files under a topic the search never names. A match is never
// the answer: the result is a "choose" screen that states the reason and asks,
// with whatever the rules found on their own kept beside it.
//   all:    every pattern must be stated positively (outside any negation)
//   raw:    patterns read on the whole search, for cues that are themselves
//           negative findings ("no flatus", "no pulses")
//   dx:     the diagnosis in the search's own words; when the search names it
//           the rules answer and nothing is inferred, and when the search
//           negates it ("PE ruled out", "not septic") the entry never fires
//   offer:  ACR topic titles, most likely first
//   child:  true for entries written for children only; other entries never
//           fire for a child. A pregnant search is offered only topics that
//           hold a scenario written for pregnancy.
// Every entry has a gold case and a negated one in tests/guard-inference-gold.json
// or tests/inference-gold.json.
const DYSPNEA = /\b(shortness of breath|short of breath|sob|dyspnea|breathless|breathlessness|cant breathe|trouble breathing|difficulty breathing)\b/;
const LEG_SWELLING = /\b(?:(?:leg|legs|calf|calves|ankle|ankles) (?:is |are )?(?:swelling|swollen|edema)|(?:swollen|swelling of(?: the)?|edema of(?: the)?) (?:\w+ )?(?:leg|legs|calf|calves|ankle|ankles)|(?:leg|calf|ankle|pedal|lower extremity) edema|calf (?:pain|tenderness))\b/;
const PE_RISK = /\b(long flight|long haul flight|plane flight|after (?:a |recent |her |his )?(?:\w+ )?(?:surgery|operation|replacement|arthroplasty)|post ?op|postoperative|postpartum|immobil\w+|bed ?bound|bedridden)\b/;
const FEVER = /\b(fever|fevers|febrile|pyrexia)\b/;
const INFERENCES = [
  { id: 'pe-dyspnea-leg', all: [DYSPNEA, LEG_SWELLING], dx: /\b(pe|pulmonary embol\w*|embol\w+)\b/,
    offer: ['Suspected Pulmonary Embolism', 'Suspected Lower Extremity Deep Vein Thrombosis', 'Suspected and Known Heart Failure'],
    reason: 'Shortness of breath with leg swelling can mean a pulmonary embolism from a leg clot, or heart failure.' },
  { id: 'pe-risk', all: [/\b(pleuritic|shortness of breath|short of breath|sob|dyspnea|tachycardi\w+|hypoxi\w+)\b/, PE_RISK], dx: /\b(pe|pulmonary embol\w*|embol\w+)\b/,
    offer: ['Suspected Pulmonary Embolism'],
    reason: 'Chest or breathing symptoms after a long flight, surgery or delivery raise the question of pulmonary embolism.' },
  { id: 'pe-vitals', all: [/\btachycardi\w+\b/, /\b(hypoxi\w+|low oxygen|low sats|desaturat\w+)\b/], dx: /\b(pe|pulmonary embol\w*|embol\w+)\b/,
    offer: ['Suspected Pulmonary Embolism'],
    reason: 'Tachycardia with hypoxia raises the question of pulmonary embolism.' },
  { id: 'pe-hemoptysis-leg', all: [/\b(hemoptysis|coughing (?:up )?blood|coughed (?:up )?blood)\b/, LEG_SWELLING], dx: /\b(pe|pulmonary embol\w*|embol\w+)\b/,
    offer: ['Suspected Pulmonary Embolism', 'Hemoptysis'],
    reason: 'Coughing blood with a swollen leg raises the question of pulmonary embolism.' },
  { id: 'sepsis-rigors', all: [/\b(rigors?|shaking chills|chills)\b/], dx: /\b(sepsis|septic|bacteremia)\b/, offer: ['Sepsis'], alone: true,
    reason: 'Chills and rigors can be the first sign of sepsis.' },
  { id: 'sepsis-shock', all: [FEVER, /\b(hypotensi\w+|low blood pressure|low bp|shock)\b/], dx: /\b(sepsis|septic|bacteremia)\b/, offer: ['Sepsis'],
    reason: 'Fever with low blood pressure raises the question of sepsis.' },
  { id: 'foosh', all: [/\b(foosh|(?:fall|fell|falling|landed) (?:on|onto) (?:an? |the |his |her |my )?outstretched (?:hand|arm))\b/], dx: /\bwrist\b/,
    offer: ['Acute Hand and Wrist Trauma', 'Acute Elbow and Forearm Pain'],
    reason: 'A fall on an outstretched hand most often injures the wrist, and sometimes the elbow.' },
  { id: 'aortic-syndrome', all: [/\b(tearing|ripping) (?:chest |back |chest and back )?pain\b|\bchest pain\b.*\b(?:radiat\w+|going|through) to (?:the |my )?back\b|\b(unequal|different|asymmetric) (?:arm )?(?:blood pressures?|bps?|pulses)\b|\bpulse deficit\b/],
    dx: /\b(dissection|aortic|aorta)\b/, offer: ['Suspected Acute Aortic Syndrome'],
    reason: 'Tearing chest pain, pain through to the back or unequal arm pressures raise the question of an acute aortic syndrome.' },
  { id: 'acs', all: [/\bcrushing chest (?:pain|pressure)\b|\bchest (?:pain|pressure|tightness)\b.*\b(?:radiat\w+|going|spreading) (?:to|down|into) (?:the |my |his |her )?(?:left |right )?(?:arm|jaw|shoulder)\b|\bchest (?:pressure|tightness)\b.*\b(sweating|sweaty|diaphore\w+)\b/],
    dx: /\b(acs|acute coronary|coronary|mi|myocardial|infarct\w*|heart attack)\b/, offer: ['Chest Pain-Possible Acute Coronary Syndrome'],
    reason: 'Crushing chest pain, or chest pressure with sweating or pain into the arm or jaw, raises the question of an acute coronary syndrome.' },
  { id: 'endocarditis', all: [FEVER, /\bmurmur\b/], dx: /\bendocarditis\b/, offer: ['Infective Endocarditis'],
    reason: 'Fever with a murmur raises the question of infective endocarditis.' },
  { id: 'heart-failure', all: [/\b(orthopnea|paroxysmal nocturnal dyspnea|pnd|wakes? up gasping|waking up gasping|cant lie flat|cannot lie flat)\b/],
    dx: /\b(heart failure|chf|hfref|hfpef|cardiomyopathy)\b/, offer: ['Suspected and Known Heart Failure'],
    reason: 'Breathlessness lying flat or waking at night gasping suggests heart failure.' },
  { id: 'dvt-calf', all: [/\b(?:calf|leg) (?:is |was )?(?:swollen|swelling)\b|\b(?:swollen|swelling of(?: the)?) (?:\w+ )?(?:calf|leg)\b/, /\b(one|unilateral|single|left|right|tender|tenderness|red|warm)\b/],
    dx: /\b(dvt|thrombosis|clot|cellulitis|infection)\b/, offer: ['Suspected Lower Extremity Deep Vein Thrombosis'],
    reason: 'One swollen, tender calf or leg raises the question of a deep vein thrombosis.' },
  { id: 'svc', all: [/\b(facial|face) swelling\b|\bswollen face\b/, /\b(distended|engorged|bulging) neck veins\b/], dx: /\b(svc|vena cava)\b/,
    offer: ['Thoracic Venous Occlusions-Suspected Superior Vena Cava Syndrome'],
    reason: 'Facial swelling with distended neck veins suggests superior vena cava obstruction.' },
  { id: 'intracranial-hypotension', all: [/\bheadache\b.*\b(?:worse|worsens|worsening) (?:when |on |with )?(?:standing|upright|sitting up)\b|\bheadache\b.*\bbetter (?:when |on |with )?lying\b|\b(orthostatic|postural) headache\b/],
    dx: /\bintracranial hypotension\b|\bcsf leak\b/, offer: ['Imaging of Suspected Intracranial Hypotension', 'Headache'],
    reason: 'A headache that is worse upright and better lying down suggests intracranial hypotension.' },
  { id: 'horner', all: [/\bptosis\b/, /\bmiosis\b/], dx: /\bhorner\b/, offer: ['Horner Syndrome'],
    reason: 'Ptosis with miosis is Horner syndrome.' },
  { id: 'nph', all: [/\b(urinary )?incontinen\w+\b/, /\bgait\b/, /\b(memory|forgetful\w*|dementia|cognitive)\b/], dx: /\b(nph|hydrocephalus)\b/, offer: ['Dementia'],
    reason: 'Incontinence, gait disturbance and memory loss together suggest normal pressure hydrocephalus, which ACR files under dementia.' },
  { id: 'parkinsonism', all: [/\b(resting|rest) tremor\b/, /\b(shuffling|bradykinesia|rigidity|cogwheel\w*)\b/], dx: /\bparkinson\w*\b/,
    offer: ['Movement Disorders and Neurodegenerative Diseases'],
    reason: 'A resting tremor with a shuffling gait or rigidity suggests parkinsonism.' },
  { id: 'pyelonephritis', all: [FEVER, /\bflank pain\b/], dx: /\b(pyelo\w*|kidney infection)\b/,
    offer: ['Acute Pyelonephritis', 'Acute Onset Flank Pain-Suspicion of Stone Disease (Urolithiasis)'],
    reason: 'Fever with flank pain raises the question of pyelonephritis.' },
  { id: 'renal-colic', all: [/\bcolicky flank pain\b|\bflank pain\b.*\bradiat\w+ to (?:the |my )?groin\b|\bloin to groin\b/], dx: /\b(stones?|urolithiasis|nephrolithiasis|calcul\w+)\b/,
    offer: ['Acute Onset Flank Pain-Suspicion of Stone Disease (Urolithiasis)'],
    reason: 'Colicky flank pain going to the groin suggests a ureteral stone.' },
  { id: 'appendicitis', all: [/\bperiumbilical pain\b.*\b(?:moved|moving|migrat\w+|shifted|localiz\w+) to (?:the )?(?:right|rlq)\b/], dx: /\bappendi\w+\b/,
    offer: ['Right Lower Quadrant Pain'],
    reason: 'Periumbilical pain that moves to the right lower abdomen is the classic course of appendicitis.' },
  { id: 'pancreatitis', all: [/\bepigastric pain\b/, /\b(lipase|radiat\w+ to (?:the |my )?back|going to (?:the |my )?back)\b/], dx: /\bpancreatitis\b/,
    offer: ['Acute Pancreatitis'],
    reason: 'Epigastric pain going to the back, or with a high lipase, suggests acute pancreatitis.' },
  { id: 'mesenteric-ischemia', all: [/\bpain out of proportion\b|\b(?:abdominal|belly|stomach) pain after (?:meals|eating)\b.*\b(weight loss|fear of eating|food fear)\b|\bpostprandial (?:abdominal )?pain\b.*\b(weight loss|fear of eating|food fear)\b/],
    dx: /\bmesenteric\b|\bischemi\w+\b/, offer: ['Imaging of Mesenteric Ischemia'],
    reason: 'Abdominal pain out of proportion to the exam, or pain after meals with weight loss, raises the question of mesenteric ischemia.' },
  { id: 'bowel-obstruction', all: [/\bvomiting\b/, /\b(distension|distention|distended)\b/], raw: [/\b(?:no|not passing|unable to pass|hasnt passed|has not passed) (?:flatus|gas|stool)\b|\bobstipation\b/],
    dx: /\b(obstruction|sbo)\b/, offer: ['Suspected Small-Bowel Obstruction'],
    reason: 'Vomiting and distension without passing flatus suggest bowel obstruction.' },
  { id: 'retroperitoneal-bleed', all: [/\b(warfarin|coumadin|anticoagula\w+|blood thinners?|heparin|eliquis|xarelto|apixaban|rivaroxaban|doac)\b/, /\b(flank|back|groin) pain\b/, /\b(?:falling|dropping|drop in|low|decreasing) (?:hemoglobin|hgb|hematocrit|hct|h and h)\b|\b(?:hemoglobin|hgb|hematocrit|hct) (?:drop|falling|dropping|low)\b/],
    dx: /\b(retroperitoneal|bleed\w*|hematoma|hemorrhage)\b/, offer: ['Suspected Retroperitoneal Bleed'],
    reason: 'Flank pain with a falling hemoglobin on anticoagulation raises the question of a retroperitoneal bleed.' },
  { id: 'limb-ischemia', all: [/\b(?:sudden|acute)\w* (?:onset )?(?:of )?(?:leg|foot|calf) pain\b/, /\b(pale|pallor|cold|pulseless|white)\b/],
    dx: /\b(ischemi\w+|embol\w+|occlusion)\b/, offer: ['Sudden Onset of Cold, Painful Leg'],
    reason: 'Sudden leg pain with pallor or absent pulses is acute limb ischemia until shown otherwise.' },
  { id: 'limb-ischemia-pulses', all: [/\b(?:sudden|acute)\w* (?:onset )?(?:of )?(?:leg|foot|calf) pain\b/], raw: [/\b(?:no|absent|without) (?:palpable )?pulses?\b/],
    dx: /\b(ischemi\w+|embol\w+|occlusion)\b/, offer: ['Sudden Onset of Cold, Painful Leg'],
    reason: 'Sudden leg pain with pallor or absent pulses is acute limb ischemia until shown otherwise.' },
  { id: 'claudication', all: [/\b(?:calf|calves|leg|legs|thigh|buttock) (?:pain|cramps?|cramping|aching)\b.*\b(?:when|while|with|on|after) walking\b/], dx: /\b(claudication|pad|peripheral arter\w+)\b/,
    offer: ['Lower Extremity Arterial Claudication-Imaging Assessment for Revascularization'],
    reason: 'Leg pain that comes on with walking suggests arterial claudication.' },
  { id: 'thoracic-outlet', all: [/\b(arm|hand) (?:numbness|swelling|tingling|pain|weakness)\b/, /\b(overhead|raising (?:the |my |his |her )?arms?|arms? (?:raised|elevated|above))\b/], dx: /\bthoracic outlet\b|\btos\b/,
    offer: ['Thoracic Outlet Syndrome'],
    reason: 'Arm symptoms brought on by raising the arms suggest thoracic outlet syndrome.' },
  { id: 'endometriosis', all: [/\b(painful periods|dysmenorrhea|period pain)\b/, /\b(pain (?:with|during) (?:intercourse|sex)|dyspareunia)\b/], dx: /\bendometrio\w+\b/,
    offer: ['Endometriosis'],
    reason: 'Painful periods with pain during intercourse suggest endometriosis.' },
  { id: 'hip-fracture', all: [/\b(fall|fell|fallen)\b/, /\bshortened\b/, /\bexternally rotated\b/], dx: /\bhip\b/, offer: ['Acute Hip Pain'],
    reason: 'A shortened, externally rotated leg after a fall suggests a hip fracture.' },
  { id: 'ankle-inversion', all: [/\binversion injury\b/], dx: /\bankle\b/,
    offer: ['Acute Trauma to the Ankle'],
    reason: 'An inversion injury is an ankle injury.' },
  { id: 'septic-joint', all: [/\b(hot|red|warm)\b.*\bswollen (?:knee|hip|ankle|elbow|shoulder|wrist|joint)\b|\bswollen (?:knee|hip|ankle|elbow|shoulder|wrist|joint)\b.*\b(hot|red|warm)\b/, FEVER],
    dx: /\b(septic|infection|infected|osteomyelitis)\b/,
    offer: ['Suspected Osteomyelitis, Septic Arthritis, or Soft Tissue Infection (Excluding Spine and Diabetic Foot)'],
    reason: 'A hot swollen joint with fever raises the question of septic arthritis.' },
  { id: 'axial-spa', all: [/\bback pain\b/, /\bmorning stiffness\b/], dx: /\b(spondyl\w+|ankylosing|sacroiliitis)\b/,
    offer: ['Inflammatory Back Pain: Known or Suspected Axial Spondyloarthropathy', 'Low Back Pain'],
    reason: 'Back pain with morning stiffness that eases with exercise suggests inflammatory back pain.' },
  { id: 'stress-fracture', all: [/\b(recruit|runner|marching|running|marathon|dancer)\b/, /\b(shin|tibia|tibial|foot|metatarsal|heel) pain\b/], dx: /\bstress\b|\bfracture\b/,
    offer: ['Stress (Fatigue/Insufficiency) Fracture, Including Sacrum, Excluding Other Vertebrae'],
    reason: 'Shin or foot pain from marching or running raises the question of a stress fracture.' },
  { id: 'osteonecrosis', all: [/\bhip pain\b/, /\b(steroids?|prednisone|glucocorticoids?|corticosteroids?)\b/], dx: /\b(osteonecrosis|avn|avascular)\b/,
    offer: ['Osteonecrosis', 'Chronic Hip Pain'],
    reason: 'Hip pain in someone on long-term steroids raises the question of osteonecrosis.' },
  { id: 'tuberculosis', all: [/\bnight sweats\b/, /\bweight loss\b/, /\b(hemoptysis|coughing (?:up )?blood|cough)\b/], dx: /\b(tb|tubercul\w+)\b/,
    offer: ['Imaging of Possible Tuberculosis', 'Hemoptysis'],
    reason: 'Night sweats, weight loss and cough or hemoptysis raise the question of tuberculosis.' },
  { id: 'thyrotoxicosis', all: [/\bheat intolerance\b/, /\b(weight loss|tremor|palpitations)\b/], dx: /\b(thyro\w+|hyperthyroid\w*|graves)\b/, offer: ['Thyroid Disease'],
    reason: 'Heat intolerance with weight loss or tremor suggests an overactive thyroid.' },
  { id: 'hyperparathyroidism', all: [/\b(high|elevated|raised) calcium\b|\bhypercalcemia\b/, /\b(high|elevated|raised) (?:pth|parathyroid hormone)\b|\bpth (?:high|elevated)\b/], dx: /\b(hyperparathyroid\w*|parathyroid adenoma)\b/,
    offer: ['Parathyroid Adenoma'],
    reason: 'A high calcium with a high PTH is primary hyperparathyroidism.' },
  { id: 'renovascular', all: [/\b(resistant|refractory|uncontrolled) hypertension\b/, /\bbruit\b/], dx: /\b(renovascular|renal artery)\b/, offer: ['Renovascular Hypertension'],
    reason: 'Resistant hypertension with an abdominal bruit raises the question of renal artery stenosis.' },
  { id: 'bph', all: [/\b(weak stream|hesitancy|nocturia|dribbling|straining to (?:urinate|void|pee))\b.*\b(weak stream|hesitancy|nocturia|dribbling|straining to (?:urinate|void|pee))\b/], dx: /\b(bph|prostat\w+)\b/,
    offer: ['Lower Urinary Tract Symptoms: Suspicion of Benign Prostatic Hyperplasia'], sex: 'male',
    reason: 'A weak stream, hesitancy and nocturia in a man suggest benign prostatic enlargement.' },
  // children
  { id: 'intussusception', child: true, all: [/\bcurrant jelly\b/], dx: /\bintussus\w+\b/, offer: ['Abdominal Pain-Child'],
    reason: 'Currant jelly stool in a young child suggests intussusception, which ACR files under abdominal pain in children.' },
  { id: 'aspirated-foreign-body', child: true, all: [/\b(choking|choked)\b/, /\b(wheez\w+|stridor|cough\w*)\b/], dx: /\bforeign body\b/,
    offer: ['Ingested or Aspirated Foreign Body-Child'],
    reason: 'A choking episode followed by wheeze raises the question of an inhaled foreign body.' },
  { id: 'child-ataxia', child: true, all: [/\b(wobbly|unsteady|staggering)\b/], dx: /\batax\w+\b/, offer: ['Ataxia-Child'],
    reason: 'An unsteady or wobbly child is evaluated as ataxia.' },
  { id: 'child-uti', child: true, all: [FEVER, /\b(burning urination|burning when (?:peeing|urinating)|dysuria|painful urination)\b/], dx: /\b(uti|urinary tract infection)\b/,
    offer: ['Urinary Tract Infection–Child'],
    reason: 'Fever with painful urination in a child suggests a urinary tract infection.' },
  { id: 'child-abuse', child: true, infant: true, all: [/\bbruis\w+\b/, /\bfractures?\b/, /\b(different ages|different stages|various stages|multiple|unexplained|no explanation)\b/], dx: /\b(abuse|abusive|nonaccidental|non accidental|nat)\b/,
    offer: ['Suspected Physical Abuse-Child'],
    reason: 'Bruises with fractures of different ages in an infant are evaluated under ACR\'s suspected physical abuse topic. This is a question to consider, not a conclusion.' },
];

// A negative test is the search's own exclusion of what the test looks for.
const NEGATIVE_TESTS = [
  [/\b(?:negative|normal|neg|clear|unremarkable) (?:leg |venous |lower extremity |compression )*(?:duplex|doppler|venous ultrasound|venous us)\b|\b(?:duplex|doppler|venous ultrasound) (?:was |is |came back )?(?:negative|normal|neg|clear|unremarkable)\b/g, ' no dvt xbreakx '],
  [/\b(?:negative|normal|neg|clear|unremarkable) (?:ctpa|ct pulmonary angiogra\w+|ct angiogram of the chest|vq scan|v q scan|vq)\b|\b(?:ctpa|ct pulmonary angiogra\w+|vq scan|v q scan) (?:was |is |came back )?(?:negative|normal|neg|clear|unremarkable)\b/g, ' no pe xbreakx '],
  [/\b(?:thyroid|tsh|thyroid function|thyroid tests|tfts?) (?:is |was |are |were )?normal\b|\bnormal (?:thyroid function|tsh|tfts?)\b/g, ' no thyroid xbreakx '],
];

// The words a search states and the words it negates, as two strings, read
// the way the parser reads negation (reach and boundaries included).
function polarText(query) {
  const words = normalizeSearch(query, { keepCommas: true }).split(' ').filter(Boolean);
  const positive = [];
  const negative = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (NEGATION_WORDS.includes(word)) {
      let j = i + 1;
      let reach = 0;
      for (; j < words.length; j++) {
        const w = words[j];
        if (NEGATION_WORDS.includes(w) || NEGATION_BOUNDARY.has(w)) break;
        negative.push(w);
        if (!STOPWORDS.has(w) && !/^\d/.test(w) && ++reach >= NEGATION_REACH) { j++; break; }
      }
      positive.push('xbreakx');
      i = j - 1;
      continue;
    }
    positive.push(word);
  }
  const tidy = list => ` ${list.join(' ').replace(/\b(xcommax|xbreakx)\b/g, ' , ').replace(/\s+/g, ' ')} `;
  return { positive: tidy(positive), negative: tidy(negative) };
}

/**
 * The inference a search invites, as a choose screen, or null. `base` is what
 * the rules answered on their own; its topics are kept beside the inferred
 * ones unless the search negated them.
 */
function infer(query, scenarios, base) {
  const { positive, negative } = polarText(query);
  const raw = ` ${normalizeSearch(query)} `;
  const qualifiers = extractQualifiers(query);
  const index = buildIndex(scenarios);
  const child = qualifiers.age === 'pediatric';
  for (const entry of INFERENCES) {
    if (Boolean(entry.child) !== child) continue;
    if (entry.infant && !qualifiers.infant) continue;
    if (entry.sex && qualifiers.sex && qualifiers.sex !== entry.sex) continue;
    // Named outright, the rules answer; negated, nothing is inferred.
    if (entry.dx.test(positive) || entry.dx.test(negative)) continue;
    if (!entry.all.every(re => re.test(positive))) continue;
    if (entry.raw && !entry.raw.every(re => re.test(raw))) continue;
    // One cue alone fires only when it is all the search says.
    if (entry.alone && base && !['none', 'recover', 'too-broad'].includes(base.mode)) continue;
    const fits = topic => index.topicCounts.has(topic) && index.docs.some(doc => doc.scenario.topic === topic &&
      (qualifiers.pregnant ? doc.isPregnant : !doc.isPregnant) &&
      (child ? doc.population !== 'adult' : doc.population !== 'pediatric'));
    const offered = entry.offer.filter(fits);
    if (!offered.length) continue;
    // What the rules found on their own stays beside the inference.
    const own = base && base.mode === 'choose' ? base.topics.map(t => t.topic) : base && base.mode === 'guide' ? [base.topic] : [];
    const topics = [...new Set([...offered, ...own])].slice(0, 6)
      .map(topic => ({ topic, count: index.topicCounts.get(topic) || 0, query: topicQuery(topic, qualifiers) }));
    // Several complaints keep their own groups, with the inference as one more.
    let grouping = {};
    if (base && base.mode === 'choose' && base.grouped && base.groups) {
      const inferredTopics = topics.filter(t => offered.includes(t.topic));
      const rest = base.groups.map(g => ({ ...g, topics: g.topics.filter(t => !offered.includes(t.topic)) })).filter(g => g.topics.length);
      grouping = { grouped: true, groups: [{ complaint: 'the combination (to consider)', topics: inferredTopics, inferred: true }, ...rest] };
    }
    return {
      ...grouping,
      mode: 'choose', topics, inferred: true,
      inference: { id: entry.id, reason: entry.reason, topics: offered, reviewed: false },
      notice: `${entry.reason} ACR files that under ${offered.length > 1 ? 'the first topics below' : `"${offered[0]}"`}. This is a suggestion to consider, not a diagnosis: pick the topic that fits.`,
    };
  }
  return null;
}

function resolveExact(query, scenarios) {
  let result = resolveTerms(query, scenarios);
  if (result.mode === 'recover' || result.mode === 'none') result = clarify(query, scenarios) || result;
  result = infer(query, scenarios, result) || result;
  // A size no scenario here names is said to be unused, never ignored silently.
  const sizes = extractSizes(query);
  if (sizes.length && !result.sizeChecked && !['none', 'recover', 'too-broad'].includes(result.mode) && !result.notice) {
    result.notice = `No ACR scenario here names a size range, so ${formatRange(sizes[0])} was not used.`;
  }
  return result;
}

// A scenario whose name adds a stage, treatment or population the search
// never asked for.
function unaskedName(doc, asked) {
  return UNASKED_QUALIFIERS.some(t => doc.nameText.positive.has(t) && !asked.has(t));
}

/**
 * A measurement or an age in the search picks among the scenarios that split
 * on it. The candidates are the scenarios naming every word of the search in
 * their own name: a breast mass is not measured against the axilla topic's
 * breast cancers. Returns a result, or null when nothing here names a range.
 */
function resolveByRange(parsed, qualifiers, index, kind) {
  const asked = new Set([...parsed.required, ...parsed.soft]);
  const strict = h => parsed.required.every(t => h.doc.nameText.positive.has(t));
  const has = kind === 'size' ? (doc => doc.sizeRanges) : (doc => doc.ageRange);
  const unqualified = kind === 'size' ? { ...qualifiers, sizes: [] } : { ...qualifiers, years: null };
  const ranged = scoreDocs(parsed, index, unqualified).filter(h => strict(h) && has(h.doc));
  if (!ranged.length) return null;
  const label = kind === 'size' ? formatRange(qualifiers.sizes[0]) : `age ${qualifiers.years}`;
  const checked = { sizeChecked: kind === 'size', ageChecked: kind === 'age' };
  const all = scoreDocs(parsed, index, qualifiers).filter(strict);
  const fits = all.filter(h => has(h.doc));
  // A scenario that names no range but reads the search clearly better is the
  // answer: "palpable breast mass 3 cm" is the palpable mass, not a measured
  // breast cancer mid chemotherapy. Clearly better means two or more fewer
  // stages, treatments or populations the search never asked for.
  const unaskedCount = h => UNASKED_QUALIFIERS.filter(t => h.doc.nameText.positive.has(t) && !asked.has(t)).length;
  const bestUnranged = all.find(h => !has(h.doc));
  if (fits.length && bestUnranged && unaskedCount(bestUnranged) + 2 <= unaskedCount(fits[0])) return null;
  if (fits.length) {
    // Among the fits, the plain ones: no treatment stage or population that
    // was not asked.
    const plain = fits.filter(h => !unaskedName(h.doc, asked) && (qualifiers.pregnant || !h.doc.isPregnant));
    const picked = plain.length ? plain : fits;
    if (kind === 'age') {
      // An age lists scenarios only where it is what tells them apart: the
      // same name written for several ages, or an age in the name itself, and
      // few enough to read. A 12 year old's scoliosis or a 65 year old's bone
      // density still opens the topic's guide.
      const fitIds = new Set(fits.map(h => String(h.doc.scenario.id)));
      const misses = ranged.filter(h => !fitIds.has(String(h.doc.scenario.id)));
      const name = h => h.doc.scenario.name;
      const splitsByAge = misses.some(m => fits.some(f => name(f) === name(m))) || fits.some(f => parseAgeRanges(name(f)).length > 0);
      if (!splitsByAge || dedupe(picked, MAX_AGE_LIST + 1).length > MAX_AGE_LIST) return null;
    }
    return {
      mode: 'list', scenarios: dedupe(picked, 8), ...checked,
      notice: kind === 'size' ? `Scenarios whose size range includes ${label}.` : `Scenarios written for ${label}.`,
    };
  }
  // Outside every range named here. Scenarios that name no range still
  // answer as usual; with none, the topic is shown with its ranges, never a
  // range the measurement does not fit.
  const neutral = scoreDocs(parsed, index, qualifiers).filter(h => strict(h) && !has(h.doc));
  if (neutral.length) return null;
  const topics = [...new Set(ranged.map(h => h.doc.scenario.topic))];
  const notice = kind === 'size'
    ? `No ACR scenario here names a size range that includes ${label}. The ranges ACR does name are shown instead.`
    : `No ACR scenario here is written for ${label}. The whole topic is shown instead.`;
  if (topics.length === 1) return { mode: 'guide', topic: topics[0], related: [], notice, ...checked };
  return {
    mode: 'choose', notice, ...checked,
    topics: topics.slice(0, 8).map(t => ({ topic: t, count: index.topicCounts.get(t) || 0, query: t })),
  };
}

function resolveTerms(query, scenarios) {
  const byStudy = scenariosUsingStudy(query, scenarios);
  if (byStudy.length > 0) {
    return { mode: 'list', scenarios: byStudy.slice(0, 8), summary: `Scenarios where "${query}" is usually appropriate:` };
  }

  const index = buildIndex(scenarios);
  const docsById = new Map(index.docs.map(d => [String(d.scenario.id), d]));
  const parsed = parseQuery(query, index);
  const qualifiers = extractQualifiers(query);
  const { pregnant, notPregnant, age } = qualifiers;
  if (parsed.required.length + parsed.soft.length === 0) return { mode: 'none', understood: [], unknown: [], reason: 'no-clinical-words' };

  // One word that points at no one topic: a generic finding, or a word whose
  // scenarios spread over the body ("fever") without a topic of its own.
  if (parsed.required.length === 1 && parsed.soft.length === 0 && parsed.negated.length === 0 && !pregnant && !age) {
    const [word] = parsed.required;
    const spread = (index.nameFreq.get(word) || 0) >= MIN_BROAD_NAMES && !GROUP_OF.has(word) && !localizes(word, index) &&
      topicsNaming(parsed, qualifiers, scenarios).length === 0;
    if (TOO_BROAD.has(word) || spread) return { mode: 'too-broad' };
  }

  // A whole limb with only generic words ("arm pain", "leg swelling") names no
  // one ACR question: answering would pick whatever ACR files under that limb
  // (DVT, dialysis access, limb ischemia). Offer the limb's topics instead.
  const isVague = t => VAGUE_PARTS.has(t) || DROPPABLE.includes(t) || VAGUE_COMPANIONS.has(t);
  const limb = t => VAGUE_PARTS.has(t) && t !== 'upper' && t !== 'lower';
  // A search that ruled a diagnosis out ("calf pain, negative duplex") is
  // left with the limb alone and is offered its topics the same way.
  const onlyRuledOut = parsed.negated.length > 0 && parsed.required.every(t => VAGUE_PARTS.has(t));
  if (parsed.required.length && parsed.required.every(isVague) && parsed.required.some(limb) &&
      (parsed.negated.length === 0 || onlyRuledOut)) {
    return limbRecovery(query, parsed, qualifiers, index, scenarios) || recover(query, parsed, qualifiers, index, scenarios);
  }

  const scored = scoreDocs(parsed, index, qualifiers);

  // A size or an age in the search picks among the scenarios that split on it.
  if (qualifiers.sizes.length) {
    const bySize = resolveByRange(parsed, qualifiers, index, 'size');
    if (bySize) return bySize;
  }
  if (qualifiers.years !== null) {
    const byAge = resolveByRange(parsed, qualifiers, index, 'age');
    if (byAge) return byAge;
  }

  if (!notPregnant && parsed.negated.length === 0) {
    const named = topicsNaming(parsed, qualifiers, scenarios);
    const exact = named.filter(n => n.extra === 0);
    // One plain title among treatment or immunocompromised variants is the
    // generic answer; "lung nodule" opens the incidental nodule topic.
    const plain = named.filter(n => n.unasked === 0);
    if (exact.length === 1 || named.length === 1 || (plain.length === 1 && named.length > 1)) {
      const pick = exact.length === 1 ? exact[0] : named.length === 1 ? named[0] : plain[0];
      const title = index.titles.get(pick.topic);
      // "worst headache" names specific scenarios inside the topic: a soft word
      // the title lacks, named by the best scenario and by few of the topic's
      // scenarios, turns the guide into a list. So does a best scenario from
      // another topic that names the search's body part.
      const specific = parsed.soft.filter(t => !title.positive.has(t));
      const best = scored[0];
      if (specific.length && best) {
        const inTopic = index.docs.filter(d => d.scenario.topic === pick.topic);
        const minority = t => inTopic.filter(d => d.nameText.positive.has(t)).length * 2 < inTopic.length;
        const clinical = specific.filter(t => !parsed.studyAnatomy.includes(t));
        const specificList = best.doc.scenario.topic !== pick.topic
          ? specific.some(t => best.doc.nameText.positive.has(t))
          : clinical.some(t => best.doc.nameText.positive.has(t) && minority(t));
        if (specificList) return { mode: 'list', scenarios: dedupe(scored, 8) };
      }
      // Related topics pass the checks an answer passes: the region, the
      // negation, and no stage, mechanism or population that was not asked.
      // A title with many words of its own is about something else.
      const asked = new Set([...parsed.required, ...parsed.soft]);
      const scope = scopeOf([...asked]);
      const relatable = n => n.topic !== pick.topic && n.extra <= 3 &&
        titleCompatible(n.topic, index, asked, scope, parsed.negated) && !unaskedTitle(n.topic, index, asked);
      let related = named.filter(relatable).map(n => n.topic);
      // "knee pain" opens the chronic topic; ACR files the injury under "trauma".
      if (parsed.required.includes('pain') && parsed.required.length > 1) {
        const anatomyOnly = { ...parsed, required: parsed.required.filter(t => t !== 'pain') };
        related = related.concat(topicsNaming(anatomyOnly, qualifiers, scenarios).filter(relatable).map(n => n.topic));
      }
      return { mode: 'guide', topic: pick.topic, related: [...new Set(related)].slice(0, 3) };
    }
    if (named.length > 1) {
      // "gunshot abdomen" names the ballistic scenario inside one of the
      // candidate topics: a soft word no title has but the best scenario names
      // answers the question directly.
      const best = scored[0];
      const specific = parsed.soft.filter(t => !parsed.studyAnatomy.includes(t) && !named.some(n => index.titles.get(n.topic).positive.has(t)));
      if (best && specific.some(t => best.doc.nameText.positive.has(t))) return { mode: 'list', scenarios: dedupe(scored, 8) };
      return { mode: 'choose', topics: named.slice(0, 8).map(n => ({ topic: n.topic, count: n.count, query: topicQuery(n.topic, qualifiers) })) };
    }
  }

  const droppable = droppableTerms(parsed, index);
  if (scored.length > 0) {
    // A match carried only by variant text loses to one that names every word
    // but a generic one: "spine fracture" is ACR's "spine trauma", not the knee
    // scenario whose text mentions a tibial spine fracture.
    const best = scored[0];
    const namedInName = parsed.required.filter(t => best.doc.nameText.positive.has(t)).length;
    if (namedInName < parsed.required.length && droppable.length && parsed.required.length >= 2) {
      const kept = parsed.required.filter(t => t !== droppable[0]);
      const partial = scoreDocs({ ...parsed, required: kept }, index, qualifiers);
      if (partial.length && kept.every(t => partial[0].doc.nameText.positive.has(t)) && partial[0].score > best.score) {
        // Several complaints that no scenario names together are offered one
        // by one rather than one of them being dropped.
        const grouped = multiComplaint(query, parsed, qualifiers, index, scenarios);
        if (grouped) return grouped;
        return {
          mode: 'list',
          scenarios: dedupe(partial, 8),
          notice: `No scenario mentions "${droppable[0]}" together with the rest of your search, so these match the rest of it.`,
        };
      }
    }
    // A match carried only by the longer text of a scenario about something
    // else ("Vertigo ... hearing loss" for hearing loss and tinnitus) gives
    // way to the complaints' own topics when they have several.
    if (namedInName < parsed.required.length) {
      const grouped = multiComplaint(query, parsed, qualifiers, index, scenarios);
      if (grouped && new Set(grouped.topics.map(t => t.topic)).size > 1) return grouped;
    }
    // Pediatric scenarios alone answer an unqualified search only when no
    // adult scenario fits a generic word less: "painful lump under jaw" is the
    // adult neck mass, not a child's spine lump. Several complaints with
    // adult topics of their own are offered those first.
    // Beside a scenario named for the search, one that only mentions it in
    // its patient description is not about it: "tachycardia" lists atrial
    // tachycardia, not necrotizing pancreatitis whose text lists tachycardia.
    const namesAll = h => parsed.required.every(t => h.doc.nameText.positive.has(t));
    const namesSome = h => {
      const title = index.titles.get(h.doc.scenario.topic);
      return parsed.required.some(t => h.doc.nameText.positive.has(t) || (title && title.positive.has(t)));
    };
    const focused = parsed.required.length && scored.some(namesAll) ? scored.filter(namesSome) : scored;
    const hits = dedupe(focused, 8);
    const notice = withPopulationNotice(hits, docsById, qualifiers);
    if (notice) {
      const grouped = multiComplaint(query, parsed, qualifiers, index, scenarios);
      if (grouped) return grouped;
    }
    if (notice && droppable.length && parsed.required.length >= 2) {
      const kept = parsed.required.filter(t => t !== droppable[0]);
      const adult = scoreDocs({ ...parsed, required: kept }, index, qualifiers).filter(h => h.doc.population !== 'pediatric');
      if (adult.length && kept.every(t => adult[0].doc.nameText.positive.has(t))) {
        return {
          mode: 'list',
          scenarios: dedupe(adult, 8),
          notice: `No scenario mentions "${droppable[0]}" together with the rest of your search, so these match the rest of it.`,
        };
      }
    }
    return { mode: 'list', scenarios: hits, notice };
  }

  // ACR's word for the same idea: an infant's femur "fracture" is its "injury".
  const fallbackTerms = parsed.required.map(t => FALLBACK_EQUIVALENT[t] || t);
  if (fallbackTerms.some((t, i) => t !== parsed.required[i])) {
    const hits = dedupe(scoreDocs({ ...parsed, required: fallbackTerms }, index, qualifiers), 8);
    if (hits.length > 0) return { mode: 'list', scenarios: hits, notice: withPopulationNotice(hits, docsById, qualifiers) };
  }

  const grouped = multiComplaint(query, parsed, qualifiers, index, scenarios);
  if (grouped) return grouped;

  // Drop one uninformative word and say so. Pregnancy is kept while a word
  // goes; an age gives way first, so a child's "elbow fracture" reaches the
  // adult fracture scenario with a notice rather than any pediatric elbow text.
  const dropOne = quals => {
    if (parsed.required.length < 2 || droppable.length === 0) return null;
    const partial = dedupe(scoreDocs({ ...parsed, required: parsed.required.filter(t => t !== droppable[0]) }, index, quals), 8);
    if (partial.length === 0) return null;
    return {
      mode: 'list',
      scenarios: partial,
      notice: `No scenario mentions "${droppable[0]}" together with the rest of your search, so these match the rest of it.`,
    };
  };
  if (pregnant) {
    const dropped = dropOne(qualifiers);
    if (dropped) return dropped;
  }

  // Pregnancy or age give way only when ACR has no topic of its own for the
  // population and the complaint: a child's chest pain has "Chest Pain-Child"
  // to explore, so adult pleural effusions are not borrowed for it.
  const populationTopic = (pregnant || age) && [...index.titles.entries()].some(([topic, title]) =>
    parsed.required.some(t => isSpecific(t, index) && title.positive.has(t)) &&
    index.docs.some(doc => doc.scenario.topic === topic && fitsPopulation(doc, { ...qualifiers, sizes: [], years: null }) &&
      (pregnant ? doc.isPregnant : doc.population === age)));
  if ((pregnant || age) && !populationTopic) {
    // Never drop pregnancy or age silently: say that the nearest match lacks
    // it. The nearest matches must agree on a topic; a spread of unrelated
    // scenarios is a guess, not an answer. Pregnancy asks for full agreement.
    // A child's search may fall back to adult scenarios; an adult's never to
    // a child's.
    const relaxed = { sides: qualifiers.sides, years: qualifiers.years, gcs: qualifiers.gcs, sizes: qualifiers.sizes, age: age === 'adult' ? 'adult' : null };
    const nearest = scoreDocs(parsed, index, relaxed);
    const lead = nearest[0]?.doc.scenario.topic;
    const agreeing = nearest.slice(0, 3).filter(h => h.doc.scenario.topic === lead).length;
    if (nearest.length > 0 && (pregnant ? agreeing === Math.min(3, nearest.length) : agreeing * 2 > Math.min(3, nearest.length))) {
      const missing = pregnant ? 'pregnancy' : `${age} patients`;
      // When the lead topic has scenarios written for the population that
      // name part of the search, those come before the general ones: a
      // pregnant headache with visual change shows the pregnant headaches.
      const own = index.docs.filter(doc => doc.scenario.topic === lead && fitsPopulation(doc, qualifiers) &&
        (pregnant ? doc.isPregnant : doc.population === age) && parsed.required.some(t => doc.nameText.positive.has(t)));
      if (own.length) {
        const unmet = parsed.required.filter(t => !own.some(doc => doc.nameText.positive.has(t))).map(t => originalWord(query, t));
        const ranked = own.map(doc => ({ scenario: doc.scenario, score: parsed.required.filter(t => doc.nameText.positive.has(t)).length }))
          .sort((a, b) => b.score - a.score);
        return {
          mode: 'list',
          scenarios: dedupe(ranked, 8),
          notice: `No ACR scenario for ${missing} mentions "${unmet.join('", "')}"; these are the ${missing} scenarios of ${lead}.`,
        };
      }
      return {
        mode: 'list',
        scenarios: dedupe(nearest.filter(h => h.doc.scenario.topic === lead), 8),
        notice: `No ACR scenario here is specific to ${missing}. These are the nearest general matches.`,
      };
    }
  }

  const dropped = dropOne(qualifiers);
  if (dropped) return dropped;
  return recover(query, parsed, qualifiers, index, scenarios);
}

/** For tooling: how a search is read, and how a scenario is indexed. */
export function _debugParse(query, scenarios) {
  const index = scenarios ? buildIndex(scenarios) : undefined;
  return { ...parseQuery(query, index), qualifiers: extractQualifiers(query) };
}

export function _debugDoc(id, scenarios) {
  const doc = buildIndex(scenarios).docs.find(d => String(d.scenario.id) === String(id));
  if (!doc) return null;
  return {
    name: doc.scenario.name, population: doc.population, isPregnant: doc.isPregnant, sex: doc.sex, gcs: doc.gcs,
    sizeRanges: doc.sizeRanges, ageRange: doc.ageRange,
    namePositive: [...doc.nameText.positive], nameNegative: [...doc.nameText.negative],
    detailNegative: [...doc.detail.negative], keywords: [...doc.keywords],
  };
}

export function _debugIndex(scenarios) {
  const { termRegions, topicRegion } = buildIndex(scenarios);
  return { termRegions: [...termRegions].map(([term, regions]) => [term, [...regions]]), topicRegion: [...topicRegion] };
}

/** For tooling: the stemmed terms a scenario is indexed under, and the vocabulary of all of them. */
export function _docTerms(id, scenarios) {
  const index = buildIndex(scenarios);
  const doc = index.docs.find(d => String(d.scenario.id) === String(id));
  if (!doc) return null;
  return { named: [...doc.named], all: [...doc.all], nameWords: [...doc.nameText.positive], population: doc.population, isPregnant: doc.isPregnant };
}

export function _vocabulary(scenarios) {
  return { docFreq: [...buildIndex(scenarios).docFreq], stopwords: [...STOPWORDS], softTerms: [...SOFT_TERMS] };
}

export const _stem = stem;
