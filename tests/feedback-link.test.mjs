/**
 * The "This did not help" link (js/feedback-link.js): a mailto: draft the user
 * sends themselves. Nothing here may send or store anything.
 *
 * Run: node --test tests/*.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { feedbackDraft, feedbackMailto, FEEDBACK_ADDRESS, FEEDBACK_NOTE } from '../js/feedback-link.js';

test('the link is a mailto: to the contact address with the search and result kind in the body', () => {
  const href = feedbackMailto({ query: 'contrast allergy', kind: 'none' });
  assert.ok(href.startsWith(`mailto:${FEEDBACK_ADDRESS}?subject=`));
  const params = new URLSearchParams(href.slice(href.indexOf('?') + 1).replace(/\+/g, '%2B'));
  const body = params.get('body');
  assert.match(body, /^Search: contrast allergy\r\n/);
  assert.match(body, /Result shown: No ACR scenario found/);
  assert.match(body, /edit or delete anything in this message before sending/);
  assert.match(params.get('subject'), /GRAi Imaging Guide/);
});

test('every result screen has a readable name in the draft', () => {
  for (const kind of ['none', 'recover', 'too-broad', 'list', 'choose', 'guide', 'answer']) {
    const { body } = feedbackDraft({ query: 'x', kind });
    assert.ok(!body.includes(`Result shown: ${kind}`), kind);
  }
  assert.match(feedbackDraft({ query: 'x', kind: 'list', detail: '3 scenarios' }).body, /List of matching scenarios \(3 scenarios\)/);
});

test('awkward searches are encoded, flattened and cut to a safe length', () => {
  const href = feedbackMailto({ query: 'a & b?\n"c" <d> 100% #1 ' + 'x'.repeat(2000), kind: 'recover' });
  assert.ok(!/[\s"<>#]/.test(href), 'no raw spaces, quotes, angle brackets or # in the address');
  assert.ok(href.length < 1200, `link is ${href.length} long`);
  const body = new URLSearchParams(href.slice(href.indexOf('?') + 1)).get('body');
  assert.match(body, /^Search: a & b\? "c" <d> 100% #1 x+\r\n/);
});

test('the note beside the link says what pressing it does', () => {
  assert.equal(FEEDBACK_NOTE, 'Opens your email app; nothing is sent unless you send it.');
});

test('the module only builds text: it cannot send or store anything', () => {
  const source = readFileSync(new URL('../js/feedback-link.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  assert.ok(!/fetch|XMLHttpRequest|sendBeacon|WebSocket|localStorage|sessionStorage|indexedDB|document\.cookie/.test(source));
});
