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
 */
import { conceptNormalize } from './concept-matcher.js?v=20260531a';

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
  'pressure', 'picc', 'xbreakx',
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
  'leg', 'tibia', 'ankle', 'foot', 'toe', 'breast', 'axilla', 'kidney', 'liver', 'pancreas', 'spleen', 'bladder',
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
  ['head', 'skull', 'face', 'facial', 'orbit', 'eye', 'ear', 'sinus', 'nasal', 'jaw', 'mandibular', 'sella', 'iac'],
  ['cervical', 'spine', 'thoracic', 'lumbar', 'lowback', 'back', 'sacrum'],
  ['chest', 'lung', 'heart', 'rib', 'thorax', 'breast', 'axilla', 'esophagus'],
  ['abdomen', 'liver', 'kidney', 'pancreas', 'spleen', 'bowel', 'colon', 'stomach', 'adrenal', 'biliary', 'gallbladder',
    'mesenteric', 'flank', 'ureter', 'aorta'],
  ['pelvis', 'bladder', 'prostate', 'uterus', 'ovary', 'adnexal', 'rectum', 'scrotum', 'cervix', 'vaginal', 'penis', 'hip', 'groin'],
  ['shoulder', 'elbow', 'forearm', 'wrist', 'hand', 'finger', 'thigh', 'femur', 'knee', 'leg', 'tibia', 'ankle', 'foot', 'toe', 'extremity'],
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
  fibroid: 'fibroids', leiomyoma: 'fibroids', leiomyomas: 'fibroids', spinal: 'spine',
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
];

// Clinician shorthand and lay terms -> the wording ACR uses. Sorted longest
// first below, so a longer phrase wins over a shorter one inside it, and the
// output of one alias is never read again by another.
const ALIASES = [
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
  ['nat', 'physical abuse'], ['skeletal survey', 'physical abuse skeletal survey'],
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
  ['headache with fever', 'headache fever'], ['headache and fever', 'headache fever'], ['neck stiffness', ''],
  ['stiff neck', ''], ['photophobia', ''],
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
  ['adrenal incidentaloma', 'adrenal mass'], ['adrenal nodule', 'adrenal mass'], ['adrenal lesion', 'adrenal mass'],
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
  ['aub', 'uterine bleeding abnormal'], ['postmenopausal bleeding', 'uterine bleeding abnormal'],
  ['bleeding after menopause', 'uterine bleeding abnormal'], ['spotting after menopause', 'uterine bleeding abnormal'],
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
  ['axillary lymphadenopathy', 'axillary adenopathy'], ['ductal carcinoma in situ', 'dcis'],
  ['breast implant', 'breast implant'],
  // ordering phrases that are not clinical
  ['of choice', ''], ['first line', ''], ['next step', ''], ['what next', ''], ['when to', ''], ['do i need', ''],
  ['is this normal', ''], ['pack year', ''], ['pack years', ''], ['former smoker', ''], ['ex smoker', ''],
  ['with picc', ''], ['picc line', ''],
];
ALIASES.sort((a, b) => b[0].length - a[0].length);

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
  { phrase: 'facial droop', when: /\b(isolated|bell|bells|palsy|peripheral)\b/, to: 'facial weakness', before: true },
  { phrase: 'face droop', when: /\b(isolated|bell|bells|palsy|peripheral)\b/, to: 'facial weakness', before: true },
  { phrase: 'torsion', when: /\b(scrotum|scrotal|testis|testicle|testicular|testes)\b/, to: 'scrotum pain acute' },
  { phrase: 'torsion', when: /\b(ovary|ovarian|adnexa|adnexal|pelvis|pelvic)\b/, to: 'pelvis pain gynecological' },
  { phrase: 'abscess', when: /\b(thigh|leg|arm|forearm|hand|foot|calf|shoulder|hip|knee|elbow|wrist|ankle|neck|extremity|buttock|gluteal|groin|lower|upper)\b/, to: 'soft tissue infection' },
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
  'silicone', 'saline', 'implant', 'cutaneous', 'revasc', 'revascularization'];

// Topic titles a generic search should not open when a plainer title also
// fits: procedure planning and the immunocompromised branch are asked for.
const TITLE_UNASKED = ['management', 'planning', 'interventional', 'immunocompromised'];

// Opposites: a search for one must not lead with the other.
const ANTONYMS = [['acute', 'chronic'], ['blunt', 'penetrating'], ['upper', 'lower'], ['premenopausal', 'postmenopausal'],
  ['immunocompetent', 'immunocompromised'], ['ballistic', 'nonballistic'], ['painful', 'painless'], ['pulsatile', 'nonpulsatile'],
  ['bilious', 'nonbilious'], ['gynecological', 'nongynecological'], ['ischemic', 'nonischemic'], ['focal', 'nonlocalized']];

// A negated word also rules out scenarios built on what implies it: "no fever"
// excludes sepsis, "no red flags" the red-flag headache branches.
const IMPLIES = {
  fever: ['sepsis'],
  flag: ['fever', 'neuro', 'deficit', 'cancer', 'immunocompromised', 'thunderclap', 'sudden', 'hypotension', 'hypertension',
    'older', 'increasing', 'pregnant', 'peripartum', 'hiv', 'papilledema', 'post', 'trauma', 'tension', 'cervicogenic',
    'intracranial', 'otitis', 'sinusitis', 'migraine', 'cluster', 'trigeminal'],
  trauma: ['fall', 'blunt', 'penetrating', 'ballistic'],
};

// Scenario names this long are the variant text itself, not a name.
const MAX_NAME_WORDS = 22;

const PREGNANT_RE = /\b(pregnant|pregnancy|gravid|gravida|trimester|gestation|gestational|prenatal|antenatal|obstetric|obstetrical|fetal|fetus|g\d+p\d+|\d+\s*(?:weeks|wks|wk)\s*(?:pregnant|gestation|ga|ega|gestational age)|iugr)\b/;
const NOT_PREGNANT_RE = /\b(not pregnant|non pregnant|nonpregnant|negative pregnancy test|pregnancy test negative|negative hcg|hcg negative|negative beta hcg|beta hcg negative|not currently pregnant)\b/;
const PEDIATRIC_RE = /\b(child|children|kid|kids|pediatric|pediatrics|peds|ped|infant|infants|toddler|neonate|neonatal|newborn|baby|babies|adolescent|teen|teenager|teenage|preemie|preterm infant|nicu|school age|boy|girl)\b/;
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
  'who', 'which', 'that', 'when', 'while', 'then', 'now', 'also', 'initial', 'next', 'follow', 'imaging', 'xbreakx']);
const NEGATION_REACH = 3;

// One-word searches too general to point at any one topic.
const TOO_BROAD = new Set(['pain', 'mass', 'lesion', 'tumor', 'cancer', 'trauma', 'fracture', 'infection', 'normal',
  'bleeding', 'swelling', 'disease']);

const SOFT_MATCH_BONUS = 0.08;
const KEYWORD_BONUS = 0.03;
const NAME_MATCH_BONUS = 0.12;
const INITIAL_BONUS = 0.03;
const POPULATION_PENALTY = 0.3;
const UNASKED_PENALTY = 0.12;
const ANTONYM_PENALTY = 0.5;
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

// "ectopic pregnancy" names a diagnosis, not a pregnant patient to filter on.
function normalizeSearch(query) {
  let q = String(query).toLowerCase();
  for (const [re, to] of SLASH_SHORTHAND) q = q.replace(re, to);
  // Contrast phrases carry no clinical meaning and "without" would otherwise
  // negate the next clinical word.
  q = q.replace(/\b(with|without|w|wo|w o|no|non|pre|post)\s*(and\s*(with|without)\s*)?(iv\s*)?(contrast|con|gad|gadolinium)\b/g, ' ');
  // A sentence break ends a negation: "Not goiter. Euthyroid." negates goiter only.
  q = q.replace(/[.;]\s/g, ' xbreakx ');
  q = cleanWords(q)
    .replace(/\b(ectopic|molar) pregnancy\b/g, (m, w) => (w === 'molar' ? 'gestational trophoblastic disease' : w))
    .replace(/\bmolar\b/g, 'gestational trophoblastic disease');
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
  out = out.replace(PAIN_AFTER_TRAUMA_RE, (m, cause) => {
    if (/^(fall|falling)$/.test(cause)) return 'trauma fall';
    if (/^(twist|twisting)$/.test(cause)) return 'trauma twisting';
    if (/^(accident|collision|crash|mvc|mva)$/.test(cause)) return 'blunt trauma';
    if (/^foosh$/.test(cause)) return 'wrist trauma fall';
    return 'trauma';
  });
  const context = ({ phrase, when, to }) => {
    if (out.includes(` ${phrase} `) && when.test(out.replace(` ${phrase} `, ' ').replace(/_/g, ' '))) {
      out = out.split(` ${phrase} `).join(` ${protect(to)} `);
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
  if (/\bleft\b/.test(q) && !/\bright\b/.test(q)) sides.add('left');
  if (/\bright\b/.test(q) && !/\bleft\b/.test(q)) sides.add('right');
  const gcs = q.match(GCS_QUERY_RE);
  return { pregnant: !notPregnant && PREGNANT_RE.test(q), notPregnant, age, years, infant, teen, sides, gcs: gcs ? Number(gcs[1]) : null };
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
  const rest = text.replace(STUDY_RE, (m, a, b) => {
    for (const w of (a || b).split(' ')) if (w !== 'and') anatomy.add(stem(w));
    return ' ';
  });
  return { rest: rest.replace(/\s+/g, ' ').trim(), anatomy };
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

function parseWords(query, index) {
  const { age } = extractQualifiers(query);
  const { rest, anatomy: studyAnatomy } = splitStudyPhrases(normalizeSearch(query));
  const words = joinLowBack(withoutPregnancy(applyAliases(withoutAge(rest), { age })))
    .replace(/\bnon(?=[a-z]{5,})/g, 'non ')
    .split(/[ _]/)
    .filter(Boolean);
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
  const stated = new Set([...required, ...soft]);
  const negatedSet = new Set(negated.filter(t => !stated.has(t)));
  // A search that is only a study ("xray knee") asks about that body part.
  if (required.length === 0) for (const t of studyAnatomy) required.push(t);
  return {
    required: [...new Set(required)],
    soft: [...new Set(soft)].filter(t => !required.includes(t)),
    negated: [...negatedSet],
    studyAnatomy: [...studyAnatomy],
  };
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

const indexCache = new WeakMap();

const INFANT_TEXT_RE = /\b(infant|infants|newborn|neonate|neonatal|toddler|child|children|pediatric|adolescent|after birth|of life|preterm|premature|months? of age)\b/i;
const PREGNANT_NAME_RE = /\b(pregnan\w*|gestation\w*|trimester|gravid|fetal|fetus|placenta\w*|nuchal translucency|positive beta hcg|hcg positive|twins?)\b/i;

// Data tags a few infant scenarios as adult and a few "adult or skeletally
// mature child" scenarios as pediatric; the text says otherwise.
function populationOf(scenario) {
  const tagged = scenario.age || scenario.ageGroup;
  const text = `${scenario.name} ${scenario.search || scenario.variant || ''}`;
  if (tagged === 'adult' && INFANT_TEXT_RE.test(text) && !/\badult\b/i.test(text)) return 'pediatric';
  if (tagged === 'pediatric' && /\badult or\b/i.test(text)) return 'any';
  return tagged;
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
      scenario: s, nameText, detail, keywords, named, all, lowerName, population: populationOf(s), isPregnant,
      gcs: gcsRange(shortName),
    };
  });
  const titles = new Map();
  const titleKeys = new Map();
  for (const s of scenarios) {
    if (!s.topic || titles.has(s.topic)) continue;
    const parsed = parseText(s.topic.replace(/\bchild\b/gi, ' '));
    const joined = joinLowBack([...parsed.positive].join(' '), { keepBack: true }).split(' ').filter(Boolean).map(stem);
    titles.set(s.topic, { positive: new Set(joined), negative: parsed.negative, key: cleanWords(s.topic).replace(/\s/g, '') });
  }
  // Two spellings of one topic title are one topic for choosing purposes.
  for (const [topic, title] of titles) {
    if (!titleKeys.has(title.key)) titleKeys.set(title.key, []);
    titleKeys.get(title.key).push(topic);
  }
  const index = { docs, docFreq, nameFreq, detailFreq, bigrams, total: scenarios.length, titles, titleKeys };
  indexCache.set(scenarios, index);
  return index;
}

function fitsPopulation(doc, { pregnant, notPregnant, age, years, sides, gcs }) {
  if (pregnant && !doc.isPregnant) return false;
  if (notPregnant && doc.isPregnant) return false;
  if (age && doc.population !== age && doc.population !== 'any') return false;
  // Life stage follows a stated age: no postmenopausal answer for a 17 year old.
  if (years !== null && years !== undefined) {
    if (years < 40 && doc.nameText.positive.has('postmenopausal')) return false;
    if (years >= 55 && (doc.nameText.positive.has('premenopausal') || doc.detail.positive.has('reproductive'))) return false;
  }
  if (sides && sides.size) {
    for (const side of SIDES) if (!sides.has(side) && doc.nameText.positive.has(side)) return false;
  }
  if (gcs && doc.gcs && (gcs < doc.gcs[0] || gcs > doc.gcs[1])) return false;
  return true;
}

// Negation in the search excludes a scenario that states the term positively,
// unless the scenario itself also negates it somewhere. What implies the term
// counts too: "no fever" rules out sepsis.
function contradictsNegation(doc, negated) {
  const statesPositively = t => doc.nameText.positive.has(t) && !doc.nameText.negative.has(t) && !doc.detail.negative.has(t);
  return negated.some(t => statesPositively(t) || (IMPLIES[t] || []).some(statesPositively));
}

function scoreDocs(parsed, docs, qualifiers) {
  const scored = [];
  const asked = new Set([...parsed.required, ...parsed.soft]);
  // Regions the search names, through any of its words or its study.
  const askedRegions = groupsOf([...asked]);
  for (const doc of docs) {
    const { scenario, nameText, keywords, named } = doc;
    if (!fitsPopulation(doc, qualifiers)) continue;
    if (!parsed.required.every(t => named.has(t))) continue;
    if (contradictsNegation(doc, parsed.negated)) continue;
    if (askedRegions.size) {
      const docRegions = groupsOf([...nameText.positive]);
      if (docRegions.size && ![...docRegions].some(g => askedRegions.has(g))) continue;
    }
    // Abuse is an accusation: never surfaced unless asked for or the search is
    // about an infant, the population ACR's abuse scenarios describe.
    if (named.has('abuse') && !asked.has('abuse') && !qualifiers.infant) continue;

    let score = 0;
    for (const t of parsed.required) {
      score += nameText.positive.has(t) ? 1 + NAME_MATCH_BONUS : 0.8;
      // "with red flags" must not lead with ACR's "no red flags".
      if (nameText.negative.has(t) && !nameText.positive.has(t)) score -= 1.5;
    }
    score /= parsed.required.length || 1;
    for (const t of parsed.soft) {
      if (named.has(t)) score += SOFT_MATCH_BONUS;
      else if (keywords.has(t)) score += KEYWORD_BONUS;
    }
    for (const t of parsed.negated) if (nameText.negative.has(t)) score += NAME_MATCH_BONUS;
    for (const [a, b] of ANTONYMS) {
      if (asked.has(a) && nameText.positive.has(b) && !nameText.positive.has(a)) score -= ANTONYM_PENALTY;
      if (asked.has(b) && nameText.positive.has(a) && !nameText.positive.has(b)) score -= ANTONYM_PENALTY;
    }

    if (!qualifiers.age && doc.population === 'pediatric') score -= POPULATION_PENALTY;
    if (!qualifiers.pregnant && doc.isPregnant) score -= POPULATION_PENALTY;
    if (nameText.positive.has('initial')) score += INITIAL_BONUS;
    for (const t of UNASKED_QUALIFIERS) if (nameText.positive.has(t) && !asked.has(t)) score -= UNASKED_PENALTY;
    score -= [...nameText.positive].filter(t => !asked.has(t)).length * EXTRA_WORD_PENALTY;
    scored.push({ scenario, score, doc });
  }
  let ranked = scored.sort((a, b) => b.score - a.score);
  // A search that names no age is an adult search when adult scenarios exist;
  // ACR's child scenarios appear only when nothing else fits. A teenager's
  // search keeps both.
  if (!qualifiers.age && !qualifiers.teen && ranked.some(h => h.doc.population !== 'pediatric')) {
    ranked = ranked.filter(h => h.doc.population !== 'pediatric');
  }
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
  const qualifiers = relaxQualifiers ? { sides: extractQualifiers(query).sides } : extractQualifiers(query);
  return dedupe(scoreDocs(parsed, index.docs, qualifiers), max);
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
  const index = buildIndex(scenarios);
  const parsed = parseQuery(query, index);
  const qualifiers = extractQualifiers(query);
  const anatomy = parsed.required.filter(t => ANATOMY.has(t));
  const docs = new Map(index.docs.map(d => [String(d.scenario.id), d]));
  const asked = new Set([...parsed.required, ...parsed.soft]);
  return suggestions.filter(s => {
    const doc = docs.get(String(s.id));
    if (!doc) return false;
    if (!fitsPopulation(doc, qualifiers)) return false;
    if (!qualifiers.pregnant && doc.isPregnant) return false;
    if (!qualifiers.age && doc.population === 'pediatric') return false;
    if (doc.named.has('abuse') && !asked.has('abuse')) return false;
    if (contradictsNegation(doc, parsed.negated)) return false;
    // Sharing no clinical word is a guess (varicocele -> varicose veins).
    if (parsed.required.length > 0 && !parsed.required.some(t => doc.all.has(t))) return false;
    return anatomy.every(t => doc.all.has(t));
  });
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

const ALIAS_WORDS = new Set(ALIASES.flatMap(([from]) => from.split(' ')).concat(CONTEXT_ALIASES.map(c => c.phrase).flatMap(p => p.split(' '))));

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
 *   { mode: 'guide', topic, related }      a search that names one ACR topic
 *   { mode: 'choose', topics }             several topics fit; the user picks
 *   { mode: 'list', scenarios, notice? }   specific search
 *   { mode: 'too-broad' }                  a word that points at no one topic
 *   { mode: 'none' }                       nothing matched; use fallback search
 */
export function resolveQuery(query, scenarios) {
  const corrected = correctSpelling(query, scenarios);
  if (corrected) {
    const result = resolveExact(corrected, scenarios);
    if (result.mode !== 'none') return { ...result, corrected };
  }
  return resolveExact(query, scenarios);
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

// The words a search would drop if nothing matches: a generic word ("pain",
// "mass") or a modifier ACR uses often in variant text but never in a name. A
// disease word is never dropped, so "tension pneumothorax" cannot become
// tension headache and "lymphoma staging" cannot become melanoma staging.
function droppableTerms(parsed, index) {
  const rank = t => (DROPPABLE.includes(t) ? DROPPABLE.indexOf(t) : DROPPABLE.length);
  return parsed.required
    .filter(t => !ANATOMY.has(t) && (DROPPABLE.includes(t) ||
      ((index.nameFreq.get(t) || 0) === 0 && (index.detailFreq.get(t) || 0) >= MIN_DROPPABLE_FREQUENCY)))
    .sort((a, b) => rank(a) - rank(b) || (index.docFreq.get(b) || 0) - (index.docFreq.get(a) || 0));
}

function resolveExact(query, scenarios) {
  const byStudy = scenariosUsingStudy(query, scenarios);
  if (byStudy.length > 0) {
    return { mode: 'list', scenarios: byStudy.slice(0, 8), summary: `Scenarios where "${query}" is usually appropriate:` };
  }

  const index = buildIndex(scenarios);
  const docsById = new Map(index.docs.map(d => [String(d.scenario.id), d]));
  const parsed = parseQuery(query, index);
  const qualifiers = extractQualifiers(query);
  const { pregnant, notPregnant, age } = qualifiers;
  if (parsed.required.length + parsed.soft.length === 0) return { mode: 'none' };

  if (parsed.required.length === 1 && parsed.soft.length === 0 && !pregnant && !age &&
      TOO_BROAD.has(parsed.required[0])) {
    return { mode: 'too-broad' };
  }

  const scored = scoreDocs(parsed, index.docs, qualifiers);
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
      let related = named.filter(n => n !== pick).map(n => n.topic);
      // "knee pain" opens the chronic topic; ACR files the injury under "trauma".
      if (parsed.required.includes('pain') && parsed.required.length > 1) {
        const anatomyOnly = { ...parsed, required: parsed.required.filter(t => t !== 'pain') };
        related = related.concat(topicsNaming(anatomyOnly, qualifiers, scenarios).map(n => n.topic).filter(t => t !== pick.topic));
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
      return { mode: 'choose', topics: named.slice(0, 8).map(n => ({ topic: n.topic, count: n.count })) };
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
      const partial = scoreDocs({ ...parsed, required: kept }, index.docs, qualifiers);
      if (partial.length && kept.every(t => partial[0].doc.nameText.positive.has(t)) && partial[0].score > best.score) {
        return {
          mode: 'list',
          scenarios: dedupe(partial, 8),
          notice: `No scenario mentions "${droppable[0]}" together with the rest of your search, so these match the rest of it.`,
        };
      }
    }
    // Pediatric scenarios alone answer an unqualified search only when no
    // adult scenario fits a generic word less: "painful lump under jaw" is the
    // adult neck mass, not a child's spine lump.
    const hits = dedupe(scored, 8);
    const notice = withPopulationNotice(hits, docsById, qualifiers);
    if (notice && droppable.length && parsed.required.length >= 2) {
      const kept = parsed.required.filter(t => t !== droppable[0]);
      const adult = scoreDocs({ ...parsed, required: kept }, index.docs, qualifiers).filter(h => h.doc.population !== 'pediatric');
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
    const hits = dedupe(scoreDocs({ ...parsed, required: fallbackTerms }, index.docs, qualifiers), 8);
    if (hits.length > 0) return { mode: 'list', scenarios: hits, notice: withPopulationNotice(hits, docsById, qualifiers) };
  }

  // Drop one uninformative word and say so. Pregnancy is kept while a word
  // goes; an age gives way first, so a child's "elbow fracture" reaches the
  // adult fracture scenario with a notice rather than any pediatric elbow text.
  const dropOne = quals => {
    if (parsed.required.length < 2 || droppable.length === 0) return null;
    const partial = dedupe(scoreDocs({ ...parsed, required: parsed.required.filter(t => t !== droppable[0]) }, index.docs, quals), 8);
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

  if (pregnant || age) {
    // Never drop pregnancy or age silently: say that the nearest match lacks
    // it. The nearest matches must agree on a topic; a spread of unrelated
    // scenarios is a guess, not an answer. Pregnancy asks for full agreement.
    // A child's search may fall back to adult scenarios; an adult's never to
    // a child's.
    const relaxed = { sides: qualifiers.sides, years: qualifiers.years, gcs: qualifiers.gcs, age: age === 'adult' ? 'adult' : null };
    const nearest = scoreDocs(parsed, index.docs, relaxed);
    const lead = nearest[0]?.doc.scenario.topic;
    const agreeing = nearest.slice(0, 3).filter(h => h.doc.scenario.topic === lead).length;
    if (nearest.length > 0 && (pregnant ? agreeing === Math.min(3, nearest.length) : agreeing * 2 > Math.min(3, nearest.length))) {
      const missing = pregnant ? 'pregnancy' : `${age} patients`;
      return {
        mode: 'list',
        scenarios: dedupe(nearest.filter(h => h.doc.scenario.topic === lead), 8),
        notice: `No ACR scenario here is specific to ${missing}. These are the nearest general matches.`,
      };
    }
  }

  const dropped = dropOne(qualifiers);
  if (dropped) return dropped;
  return { mode: 'none' };
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
    name: doc.scenario.name, population: doc.population, isPregnant: doc.isPregnant, gcs: doc.gcs,
    namePositive: [...doc.nameText.positive], nameNegative: [...doc.nameText.negative],
    detailNegative: [...doc.detail.negative], keywords: [...doc.keywords],
  };
}
