/**
 * The "This did not help" link on result screens.
 *
 * Nothing is recorded or sent by the page. The link is a mailto: address, so
 * pressing it opens the user's own email app with a draft they can read, edit
 * and choose to send or discard. Pure functions: tested in
 * tests/feedback-link.test.mjs.
 */

export const FEEDBACK_ADDRESS = 'contact@coregrai.com';
export const FEEDBACK_NOTE = 'Opens your email app; nothing is sent unless you send it.';

// What each result screen is called in the draft.
const KINDS = {
  none: 'No ACR scenario found',
  recover: 'No match; places to explore were shown',
  'too-broad': 'Search was too broad',
  list: 'List of matching scenarios',
  choose: 'A choice of topics',
  guide: 'Topic guide',
  answer: 'Single scenario answer',
};

// Long searches are cut so the link stays within what mail apps accept.
const MAX_QUERY = 300;

/** The draft's subject and body, as plain text. */
export function feedbackDraft({ query, kind, detail = '' }) {
  const text = String(query || '').replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY);
  const lines = [
    `Search: ${text}`,
    `Result shown: ${KINDS[kind] || kind || 'unknown'}${detail ? ` (${detail})` : ''}`,
    '',
    'What were you hoping to find?',
    '',
    '',
    '(You can edit or delete anything in this message before sending it. Please do not include patient details.)',
  ];
  return { subject: 'GRAi Imaging Guide: this search did not help', body: lines.join('\n') };
}

/** mailto: address that opens the draft in the user's email app. */
export function feedbackMailto(info) {
  const { subject, body } = feedbackDraft(info);
  // Mail apps expect CRLF line breaks and %20 for spaces (not "+").
  return `mailto:${FEEDBACK_ADDRESS}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body.replace(/\n/g, '\r\n'))}`;
}
