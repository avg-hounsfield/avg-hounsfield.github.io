/**
 * Which MRI protocol the app shows for an ACR study (DataLoader.getProtocol).
 * A wrong protocol shows the wrong sequences, so these pin the routes that
 * were wrong before November 2026 and the rule that a study with no fitting
 * protocol gets none.
 *
 * Run: node --test tests/*.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.fetch = async url => {
  const file = path.join(root, url.split('?')[0].replace(/^\//, ''));
  return { ok: true, json: async () => JSON.parse(readFileSync(file, 'utf8')) };
};
const { DataLoader } = await import('../js/data-loader.js');
const loader = new DataLoader();

const REGIONS = ['abdomen', 'breast', 'chest', 'msk', 'neuro', 'other', 'spine', 'vascular'];
const all = REGIONS.flatMap(r => JSON.parse(readFileSync(path.join(root, 'data', 'regions', `${r}.json`), 'utf8')).scenarios.map(s => ({ ...s, region: r })));

async function route(scenarioName, studyName) {
  const scenario = { name: scenarioName, id: 'test' };
  const { protocol } = await loader.getProtocol('', scenario, { name: studyName, modality: 'MRI' });
  return protocol ? protocol.name : null;
}

const CASES = [
  ['Hip pain, chronic, labral tear suspected', 'MR arthrography hip', 'HIP ARTHROGRAM'],
  ['Shoulder pain, instability', 'MR arthrography shoulder', 'SHOULDER ARTHROGRAM'],
  ['Wrist pain, chronic', 'MR arthrography wrist', 'WRIST ARTHROGRAM'],
  ['Elbow pain, chronic', 'MR arthrography elbow', 'MR ARTHROGRAM'],
  ['Pelvic floor dysfunction', 'MR defecography', 'MR DEFECOGRAPHY'],
  ['Fetal anomaly screening', 'MRI fetal without and with IV contrast', 'FETAL'],
  ['Plexopathy, lumbosacral', 'MRI lumbosacral plexus without IV contrast', null],
  ['Chylothorax', 'MR lymphangiography chest and abdomen', null],
  ['PAVM suspected, seizures, lung nodule', 'MRA pulmonary arteries without and with IV contrast', null],
  ['Vascular malformation suspected, lower leg', 'MRA leg without and with IV contrast', null],
  ['Claudication', 'MRA lower extremity without IV contrast', null],
  ['Cerebral venous thrombosis suspected', 'MRV head without IV contrast', null],
  ['Acute stroke', 'MRA head without IV contrast', 'TIA'],
  ['Carotid dissection suspected', 'MRA neck without and with IV contrast', 'TIA MRA DISSECTION'],
  ['Subarachnoid hemorrhage, aneurysm suspected', 'MRA head without IV contrast', 'MRA ANEURYSM'],
  ['Horner syndrome, acute onset, painful', 'MRI head with IV contrast and MRA head and neck with IV contrast', 'TIA MRA DISSECTION'],
  ['HTN, high suspicion renal vascular', 'MRA abdomen without IV contrast', 'MRA RENALS'],
  ['Hematuria', 'MRU without and with IV contrast', 'KIDNEYS'],
  ['Low back pain, cauda equina syndrome suspected', 'MRI lumbar spine without IV contrast', 'L-SPINE'],
];

for (const [scenario, study, want] of CASES) {
  test(`${study} for "${scenario}" -> ${want ?? 'no protocol'}`, async () => {
    assert.equal(await route(scenario, study), want);
  });
}

// Only these protocols carry angiographic sequences, so no MRA may land anywhere else.
const VASCULAR = new Set(['TIA', 'TIA MRA DISSECTION', 'MRA ANEURYSM', 'MRA RENALS']);
test('every ACR MRA routes to a protocol with angiographic sequences, or to none', async () => {
  const wrong = [];
  for (const s of all) {
    for (const p of s.procedures) {
      if (!/^MRA\b/.test(p.name)) continue;
      const { protocol } = await loader.getProtocol(s.region, s, p);
      if (protocol && !VASCULAR.has(protocol.name)) wrong.push(`${p.name} -> ${protocol.name} (${s.name})`);
    }
  }
  assert.deepEqual(wrong, []);
});

test('no MRV routes to a protocol (the library has no venography protocol)', async () => {
  const wrong = [];
  for (const s of all) {
    for (const p of s.procedures) {
      if (!/^MRV\b|MRA and MRV/.test(p.name)) continue;
      const { protocol } = await loader.getProtocol(s.region, s, p);
      if (protocol) wrong.push(`${p.name} -> ${protocol.name}`);
    }
  }
  assert.deepEqual(wrong, []);
});
