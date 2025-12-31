/**
 * Query Expansion for Semantic Search
 *
 * Maps layperson/colloquial terms to clinical terminology
 * to improve semantic search recall.
 *
 * This runs BEFORE the embedding model to bridge the
 * vocabulary gap between patient language and ACR scenarios.
 */

export const QueryExpander = {
    // Layperson phrase -> clinical term mappings
    // Format: 'phrase': 'clinical_expansion'
    phraseMap: {
        // Cardiovascular
        'heart attack': 'myocardial infarction acute coronary syndrome chest pain cardiac',
        'blood clot': 'thrombosis embolism venous thromboembolism',
        'blood clot in lung': 'pulmonary embolism PE chest pain dyspnea',
        'blood clot in leg': 'deep vein thrombosis DVT lower extremity swelling',
        'irregular heartbeat': 'arrhythmia atrial fibrillation palpitations',
        'racing heart': 'tachycardia palpitations arrhythmia',
        'slow heart': 'bradycardia heart block',

        // Neurological - keep expansions concise to avoid score dilution
        'worst headache of my life': 'thunderclap subarachnoid hemorrhage',
        'worst headache ever': 'thunderclap subarachnoid',
        'sudden severe headache': 'thunderclap subarachnoid hemorrhage',
        'thunderclap': 'subarachnoid hemorrhage aneurysm',
        'mini stroke': 'transient ischemic attack TIA',
        'stroke symptoms': 'acute stroke cerebrovascular accident focal neurological deficit',
        'cant move arm': 'weakness paralysis hemiparesis stroke',
        'cant move leg': 'weakness paralysis hemiparesis stroke',
        'numb tingling': 'paresthesia neuropathy sensory deficit',
        'dizzy spinning': 'vertigo vestibular dizziness',
        'passing out': 'syncope loss of consciousness',
        'seizure fit': 'seizure epilepsy convulsion',

        // Musculoskeletal
        'broken arm': 'forearm fracture upper extremity trauma',
        'broken leg': 'lower extremity fracture tibia fibula femur trauma',
        'broken wrist': 'distal radius fracture wrist trauma',
        'broken ankle': 'ankle fracture malleolus trauma',
        'broken back': 'vertebral fracture spine trauma compression',
        'broken neck': 'cervical spine fracture trauma',
        'broken rib': 'rib fracture chest wall trauma',
        'slipped disc': 'disc herniation radiculopathy',
        'pulled muscle': 'muscle strain soft tissue injury',
        'twisted ankle': 'ankle sprain ligament injury',
        'torn ligament': 'ligament tear ACL MCL injury',
        'dislocated shoulder': 'shoulder dislocation glenohumeral',

        // Abdominal
        'stomach pain': 'abdominal pain epigastric',
        'belly pain': 'abdominal pain',
        'appendix pain': 'appendicitis right lower quadrant',
        'gallbladder attack': 'cholecystitis biliary colic right upper quadrant',
        'kidney stone': 'nephrolithiasis renal colic flank pain',
        'cant poop': 'constipation obstipation bowel obstruction',
        'bloody stool': 'gastrointestinal bleeding hematochezia melena',
        'throwing up blood': 'hematemesis upper GI bleeding',
        'swollen belly': 'abdominal distension ascites',

        // Respiratory
        'cant breathe': 'dyspnea shortness of breath respiratory distress',
        'short of breath': 'dyspnea respiratory',
        'coughing blood': 'hemoptysis pulmonary hemorrhage',
        'chest tightness': 'chest pain dyspnea bronchospasm',
        'wheezing': 'bronchospasm asthma COPD',

        // Genitourinary
        'blood in urine': 'hematuria',
        'painful urination': 'dysuria urinary tract infection',
        'cant pee': 'urinary retention',
        'leaking urine': 'urinary incontinence',

        // Pediatric
        'baby not moving': 'decreased fetal movement fetal distress',
        'baby wont eat': 'poor feeding failure to thrive infant',
        'child limping': 'pediatric limp gait abnormality',
        'kid fell': 'pediatric trauma injury',

        // Oncology
        'lump': 'mass lesion tumor nodule',
        'bump on neck': 'neck mass lymphadenopathy thyroid nodule',
        'growing lump': 'enlarging mass neoplasm',
        'weight loss': 'unexplained weight loss malignancy',

        // Trauma
        'car accident': 'motor vehicle collision trauma',
        'car crash': 'motor vehicle collision polytrauma',
        'fell down': 'fall trauma injury',
        'hit head': 'head trauma traumatic brain injury concussion',

        // Swallowing
        'cant swallow': 'dysphagia esophageal',
        'food stuck': 'dysphagia esophageal obstruction foreign body',
        'choking': 'aspiration foreign body airway obstruction',

        // Fever/Infection
        'high fever': 'fever infection sepsis',
        'post op fever': 'postoperative fever abdominal pain complication',
        'fever after surgery': 'postoperative fever abdominal complication',
        'infection': 'sepsis abscess',

        // Additional weak spots identified in testing
        'clot in lung': 'pulmonary embolism PE',
        'lung clot': 'pulmonary embolism PE chest',
        'blocked artery': 'arterial occlusion stenosis ischemia',
        'clogged artery': 'arterial stenosis atherosclerosis',
        'heart failure': 'congestive heart failure CHF cardiomyopathy',
        'weak heart': 'cardiomyopathy heart failure',
        'enlarged heart': 'cardiomegaly cardiomyopathy',
        'leaky valve': 'valvular regurgitation insufficiency',

        // Brain/Neuro additions
        'brain bleed': 'intracranial hemorrhage',
        'bleeding in brain': 'intracranial hemorrhage subdural epidural',
        'brain tumor': 'intracranial mass neoplasm',
        'memory loss': 'dementia cognitive impairment',
        'confusion': 'altered mental status encephalopathy',
        'cant talk': 'aphasia dysarthria speech deficit',
        'face drooping': 'facial weakness stroke Bell palsy',

        // Spine additions
        'back pain': 'lumbar spine pain low back',
        'lower back pain': 'lumbar spine pain lumbosacral',
        'upper back pain': 'thoracic spine pain',
        'neck pain': 'cervical spine pain',
        'sciatica': 'lumbar radiculopathy disc herniation',
        'shooting pain down leg': 'radiculopathy sciatica nerve compression',

        // Cancer screening
        'breast lump': 'breast mass mammography',
        'mammogram': 'breast cancer screening mammography',
        'prostate check': 'prostate cancer screening PSA',
        'lung cancer screening': 'lung cancer CT chest low dose',
        'colon cancer': 'colorectal cancer colonoscopy',

        // OB/GYN
        'pregnant bleeding': 'vaginal bleeding pregnancy first trimester',
        'miscarriage': 'spontaneous abortion pregnancy loss',
        'ectopic': 'ectopic pregnancy tubal',
        'ovarian cyst': 'adnexal mass ovarian',
        'pelvic pain': 'pelvic pain gynecologic',

        // Vascular
        'aneurysm': 'aneurysm aortic intracranial',
        'varicose veins': 'venous insufficiency varicosity',
        'poor circulation': 'peripheral arterial disease claudication',
        'cold feet': 'peripheral vascular disease arterial insufficiency',

        // Emergency red flags
        'worst pain ever': 'severe acute emergent',
        'sudden vision loss': 'acute vision loss retinal artery occlusion',
        'sudden hearing loss': 'sensorineural hearing loss sudden',
        'swollen leg': 'lower extremity edema DVT deep vein thrombosis',
        'one leg swollen': 'unilateral leg edema DVT',
    },

    // Single word expansions (applied after phrase matching)
    wordMap: {
        // Abbreviation expansions
        'pe': 'pulmonary embolism',
        'mi': 'myocardial infarction',
        'dvt': 'deep vein thrombosis',
        'tia': 'transient ischemic attack',
        'cva': 'cerebrovascular accident stroke',
        'sob': 'shortness of breath dyspnea',
        'cp': 'chest pain',
        'abd': 'abdominal',
        'fx': 'fracture',
        'hx': 'history',

        // Colloquial to clinical
        'belly': 'abdominal',
        'tummy': 'abdominal',
        'pee': 'urinary',
        'poop': 'bowel stool',
    },

    /**
     * Expand a query with clinical terminology
     * @param {string} query - Original user query
     * @returns {string} - Expanded query with clinical terms appended
     */
    expand(query) {
        const lowerQuery = query.toLowerCase().trim();
        let expansions = [];

        // Check for phrase matches (longest match first)
        const phrases = Object.keys(this.phraseMap).sort((a, b) => b.length - a.length);
        let matchedPhrases = new Set();

        for (const phrase of phrases) {
            if (lowerQuery.includes(phrase) && !matchedPhrases.has(phrase)) {
                expansions.push(this.phraseMap[phrase]);
                matchedPhrases.add(phrase);
            }
        }

        // Check for word matches (only if not already covered by phrase)
        const words = lowerQuery.split(/\s+/);
        for (const word of words) {
            if (this.wordMap[word]) {
                // Check if this word wasn't already expanded via phrase
                let alreadyExpanded = false;
                for (const phrase of matchedPhrases) {
                    if (phrase.includes(word)) {
                        alreadyExpanded = true;
                        break;
                    }
                }
                if (!alreadyExpanded) {
                    expansions.push(this.wordMap[word]);
                }
            }
        }

        // Combine original query with expansions
        if (expansions.length > 0) {
            return `${query} ${expansions.join(' ')}`;
        }

        return query;
    },

    /**
     * Check if query would benefit from expansion
     * @param {string} query - User query
     * @returns {boolean} - True if expansion would add terms
     */
    wouldExpand(query) {
        return this.expand(query) !== query;
    }
};

// Export for debugging in browser console
if (typeof window !== 'undefined') {
    window.QueryExpander = QueryExpander;
}
