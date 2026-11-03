#!/usr/bin/env python3
"""
Step 1 of alias mining: ask language models how clinicians would phrase a
search for each ACR scenario, and which of their words map to ACR's words.

For every ACR topic, the topic's scenarios (id, population, name, patient
description) are sent in chunks of up to CHUNK scenarios. The model returns,
per scenario, a few realistic searches (shorthand, abbreviations, eponyms, lay
terms, clinical inference, direct) each tagged with the alias pairs it relies
on: ["from" phrase as typed, "to" ACR wording copied from the scenario].

Every response is cached under tools/cache/alias-mining/gen/<model>/ so a rerun
costs nothing. Token usage and the cost OpenRouter reports for each call are
appended to tools/cache/alias-mining/cost_log.jsonl and summarised in
cost_summary.json.

The 20% hold-out is decided here, by scenario id with a fixed seed, before any
model output exists: tools/mine_aliases_gate.mjs never accepts an alias on the
strength of a hold-out phrasing, so hold-out accuracy measures generalisation.

Output: data/eval/mined_phrasings.json (every phrasing, its target scenario,
its alias pairs, the model that wrote it and its split).

Usage:
    python tools/mine_aliases_generate.py --dry-run
    python tools/mine_aliases_generate.py --pilot 5        # first five topics, both models, with a cost projection
    python tools/mine_aliases_generate.py                  # everything (cached chunks are free)
    python tools/mine_aliases_generate.py --assemble-only  # rebuild the dataset from the cache

Models: PRIMARY_MODEL and SECONDARY_MODEL below (exact OpenRouter ids; every call's
id, the id OpenRouter reports back and its cost go to cost_log.jsonl). The cap in
BUDGET_USD covers generation and judging together.

Needs OPENROUTER_API_KEY in the environment; when that key is rejected, the
key in the CoreGRAi repo's .env is used. The key is never printed or written.
"""
import argparse
import hashlib
import json
import os
import random
import re
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

import requests

REPO = Path(__file__).resolve().parent.parent
CACHE = REPO / 'tools' / 'cache' / 'alias-mining'
GEN_CACHE = CACHE / 'gen'
OUT = REPO / 'data' / 'eval' / 'mined_phrasings.json'
DOTENV_FALLBACK = Path(r'C:\Users\Patrick\radiology-ai-assistant\.env')

OPENROUTER = 'https://openrouter.ai/api/v1/chat/completions'
# Model ids as OpenRouter names them. The ":batch" variants of these models are
# cheaper but refuse the chat/completions endpoint (OpenRouter 404, "cannot be
# used with the chat/completions endpoint"), so the plain ids are used.
PRIMARY_MODEL = 'anthropic/claude-opus-5.5'
SECONDARY_MODEL = 'google/gemini-3.1-pro-preview'
# An earlier run used this model for 216 chunks before the model choice changed;
# its cache is kept and assembled alongside, labelled by model, for comparison.
LEGACY_MODELS = ['anthropic/claude-sonnet-4.6']
SECONDARY_EVERY = 4           # every 4th topic also goes to the second model family
CHUNK = 16                    # scenarios per request
CONCURRENCY = 3               # the key is shared with a live product; keep this low
SPLIT_SEED = 20261102
HOLDOUT_FRACTION = 0.2
BUDGET_USD = 60.0             # cap on everything in cost_log.jsonl, generation and judging together
JUDGE_RESERVE_USD = 5.0       # generation stops launching requests once this little is left
CREDIT_FLOOR_USD = 6.0        # never run the shared account below this: the live product uses the same key
KINDS = {'shorthand', 'abbreviation', 'eponym', 'lay', 'inference', 'direct'}

SYSTEM_PROMPT = """You help build the search index of a free website that routes a clinician's search to the ACR Appropriateness Criteria scenario it describes. The site's matcher is lexical and runs in the browser: it maps the words a clinician types onto the words ACR uses in scenario names and patient descriptions. Your job is to propose how real clinicians (ED physicians, internists, family doctors, NPs and PAs, residents, technologists, nurses, and sometimes patients) actually type a search that MEANS a given scenario, and to say which of their non-ACR words map to which ACR words.

For each scenario write 3 to 5 searches; write 1 or 2 when the scenario is one of many near-identical site or stage variants in the list. Mix these kinds:
- shorthand: clinical shorthand and fragments as typed in an ED ("65M crushing cp diaphoretic", "ruq pain murphy +", "s/p fall wrist deformity")
- abbreviation: "sob", "doe", "afib", "ugib", "fnh", "sbo", "ivh", "scfe"
- eponym: eponyms, named signs, classifications and entities ("colles fracture", "murphy sign", "fleischner nodule", "ogilvie", "hinchey")
- lay: plain words a patient or nurse would use ("coughing up blood", "lump in neck", "burning when peeing")
- inference: a presentation that strongly implies this scenario without naming it ("dyspnea and unilateral leg swelling" -> suspected pulmonary embolism; "fever and new murmur" -> endocarditis)
- direct: ACR's own words reordered or trimmed ("pe suspected pregnant")

Each search must mean THIS scenario and not a neighbouring one. Keep exactly what the scenario states: the population (child, infant, adult, pregnant, postmenopausal, male or female), the acuity (acute or chronic), the polarity (no red flags, no fever, nonpregnant), the mechanism (blunt or penetrating), the stage (initial, follow-up, known, treated, post repair) and the body part. Do not add a side (left or right) unless the scenario names one. Never invent a negation. Do not write modality-only searches ("ct head") and leave out question words; the matcher ignores them. Write searches as a hurried person would type them: lowercase is fine, clinical abbreviations are welcome, no full sentences unless a patient would write one.

For every search list the alias pairs it depends on: ["from", "to"], where "from" is a contiguous phrase copied exactly from the search (lowercase) that ACR does not use, and "to" is the ACR wording for it copied from THIS scenario's name, description or topic title (1 to 4 words, lowercase). Use [] when the search already uses ACR's words. Never alias modality words, question words, ages, sexes, pregnancy words, or words ACR itself uses. A "to" of "" (empty) is allowed only for a filler phrase that carries no clinical meaning but that a lexical matcher would otherwise read as clinical ("after long flight" -> "", "self discovered" -> ""); use it sparingly and never for a clinical finding, a mechanism, a population or a time course.

Phrases the site already understands (do not propose these as "from"; you may still type them inside searches):
{known}

Return only JSON, no commentary: {"scenarios": [{"id": "...", "searches": [{"q": "...", "kind": "shorthand|abbreviation|eponym|lay|inference|direct", "aliases": [["from", "to"], ...]}]}]}"""

_LOCK = threading.Lock()
# [spent to date, spent before this run, most this run may spend]
_SPENT = [0.0, 0.0, float('inf')]


def log(msg):
    print(f'[{datetime.now().strftime("%H:%M:%S")}] {msg}', flush=True)


# ---- OpenRouter -----------------------------------------------------------

def find_api_key():
    """The environment key when OpenRouter accepts it, else the CoreGRAi .env key. Never printed."""
    candidates = []
    env_key = os.environ.get('OPENROUTER_API_KEY', '').strip()
    if env_key:
        candidates.append(('environment', env_key))
    if DOTENV_FALLBACK.exists():
        for line in DOTENV_FALLBACK.read_text(encoding='utf-8', errors='ignore').splitlines():
            m = re.match(r"\s*(?:export\s+)?OPENROUTER_API_KEY\s*=\s*['\"]?([^'\"\s]+)", line)
            if m:
                candidates.append(('CoreGRAi .env', m.group(1)))
    for source, key in candidates:
        try:
            r = requests.get('https://openrouter.ai/api/v1/auth/key', headers={'Authorization': f'Bearer {key}'}, timeout=30)
        except requests.RequestException:
            continue
        if r.status_code == 200:
            log(f'OpenRouter key from {source} accepted')
            return key
        log(f'OpenRouter key from {source} rejected ({r.status_code})')
    sys.exit('no working OpenRouter key')


class OpenRouter:
    def __init__(self, key, cost_log):
        self.key = key
        self.cost_log = cost_log

    def remaining_credit(self):
        """Credit left on the account in USD, or None when OpenRouter will not say."""
        try:
            r = requests.get('https://openrouter.ai/api/v1/credits', headers={'Authorization': f'Bearer {self.key}'}, timeout=30)
            d = r.json()['data']
            return float(d['total_credits']) - float(d['total_usage'])
        except (requests.RequestException, KeyError, ValueError, TypeError):
            return None

    def chat(self, model, system, user, *, max_tokens=12000, temperature=0.5, json_mode=False, tag=''):
        body = {
            'model': model,
            'messages': [
                {'role': 'system', 'content': [{'type': 'text', 'text': system, 'cache_control': {'type': 'ephemeral'}}]},
                {'role': 'user', 'content': user},
            ],
            'max_tokens': max_tokens,
            'temperature': temperature,
            'usage': {'include': True},
        }
        if model.startswith('google/'):
            body['reasoning'] = {'effort': 'low'}
            if json_mode:
                body['response_format'] = {'type': 'json_object'}
        headers = {'Authorization': f'Bearer {self.key}', 'Content-Type': 'application/json',
                   'HTTP-Referer': 'https://www.protocolinfo.com', 'X-Title': 'Radex alias mining'}
        last_err = None
        for attempt in range(5):
            try:
                r = requests.post(OPENROUTER, headers=headers, json=body, timeout=900)
            except requests.RequestException as e:
                last_err = f'request failed: {e}'
                time.sleep(5 * (attempt + 1))
                continue
            if r.status_code in (429, 500, 502, 503, 504, 520, 522, 524):
                last_err = f'{r.status_code}: {r.text[:200]}'
                time.sleep(10 * (attempt + 1))
                continue
            if r.status_code == 402 and 'in_flight' in r.text:
                # The account's credit is low enough that concurrent requests
                # reserve more than is left; wait for them to settle and retry.
                last_err = f'402 in-flight budget: {r.text[:160]}'
                time.sleep(30 * (attempt + 1))
                continue
            if r.status_code != 200:
                raise RuntimeError(f'OpenRouter {r.status_code}: {r.text[:300]}')
            j = r.json()
            if 'error' in j and not j.get('choices'):
                last_err = f"api error: {str(j['error'])[:200]}"
                time.sleep(10 * (attempt + 1))
                continue
            choice = j['choices'][0]
            content = choice['message'].get('content') or ''
            usage = j.get('usage') or {}
            cost = float(usage.get('cost') or 0.0)
            record = {
                'ts': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'model': model, 'model_used': j.get('model'),
                'provider': j.get('provider'), 'tag': tag,
                'prompt_tokens': usage.get('prompt_tokens'), 'completion_tokens': usage.get('completion_tokens'),
                'cached_tokens': ((usage.get('prompt_tokens_details') or {}).get('cached_tokens')),
                'reasoning_tokens': ((usage.get('completion_tokens_details') or {}).get('reasoning_tokens')),
                'cost_usd': cost, 'finish_reason': choice.get('finish_reason'),
            }
            with _LOCK:
                _SPENT[0] += cost
                with open(self.cost_log, 'a', encoding='utf-8') as f:
                    f.write(json.dumps(record) + '\n')
            return content, record
        raise RuntimeError(f'OpenRouter gave up: {last_err}')


def parse_json_object(text):
    """The first JSON object in a reply, tolerating code fences and chatter around it."""
    t = text.strip()
    t = re.sub(r'^```(?:json)?\s*', '', t)
    t = re.sub(r'\s*```$', '', t)
    try:
        return json.loads(t)
    except ValueError:
        pass
    start = t.find('{')
    end = t.rfind('}')
    if start == -1 or end == -1:
        raise ValueError('no JSON object in reply')
    return json.loads(t[start:end + 1])


# ---- Data -----------------------------------------------------------------

def load_scenarios():
    data = json.loads((REPO / 'data/search/scenario_names.json').read_text(encoding='utf-8'))
    return data['scenarios']


def short_name(s):
    return s['name'].replace(f" ({s['topic']})", '').strip()


def topic_chunks(scenarios):
    """[(topic, region, chunk_index, [scenarios])], topics sorted by title."""
    by_topic = {}
    for s in scenarios:
        by_topic.setdefault(s['topic'], []).append(s)
    chunks = []
    for ti, topic in enumerate(sorted(by_topic)):
        items = sorted(by_topic[topic], key=lambda s: int(s['id']))
        region = max(set(s['region'] for s in items), key=[s['region'] for s in items].count)
        for ci in range(0, len(items), CHUNK):
            chunks.append({'topic': topic, 'topic_index': ti, 'region': region, 'chunk': ci // CHUNK,
                           'scenarios': items[ci:ci + CHUNK]})
    return chunks


def holdout_ids(scenarios):
    """Scenario ids held out of the gate: about 20% of each topic, by a fixed seed."""
    rng = random.Random(SPLIT_SEED)
    by_topic = {}
    for s in scenarios:
        by_topic.setdefault(s['topic'], []).append(s['id'])
    held = set()
    for topic in sorted(by_topic):
        ids = sorted(by_topic[topic], key=int)
        rng.shuffle(ids)
        exact = len(ids) * HOLDOUT_FRACTION
        k = int(exact) + (1 if rng.random() < exact - int(exact) else 0)
        held.update(ids[:k])
    return held


def hand_alias_phrases():
    """The hand-written alias phrases, read from the ranker itself through node."""
    script = ("import { _aliasTables } from './js/scenario-ranker.js';"
              "process.stdout.write(JSON.stringify(_aliasTables().hand.map(p => p[0])));")
    out = subprocess.run(['node', '--input-type=module', '-e', script], cwd=REPO, capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def model_slug(model):
    """A model id as a folder name (":" is not allowed in Windows paths)."""
    return model.replace('/', '__').replace(':', '--')


def spent_to_date(cost_log):
    """Everything OpenRouter has charged this pipeline so far, from the cost log."""
    total = 0.0
    if cost_log.exists():
        for line in cost_log.read_text(encoding='utf-8').splitlines():
            if line.strip():
                total += float(json.loads(line).get('cost_usd') or 0.0)
    return total


def chunk_key(chunk):
    ids = ','.join(s['id'] for s in chunk['scenarios'])
    h = hashlib.sha1(ids.encode()).hexdigest()[:10]
    slug = re.sub(r'[^a-z0-9]+', '-', chunk['topic'].lower()).strip('-')[:60]
    return f"{slug}-{chunk['chunk']}-{h}"


def user_prompt(chunk):
    lines = [f"ACR topic: {chunk['topic']} (site region: {chunk['region']}). Scenarios:"]
    for s in chunk['scenarios']:
        pop = s.get('age') or 'adult'
        lines.append(f"- id={s['id']} | {pop} | {short_name(s)} || {s.get('search', '')}")
    lines.append('')
    lines.append(f"Return searches for every one of these {len(chunk['scenarios'])} ids.")
    return '\n'.join(lines)


# ---- Generation -----------------------------------------------------------

def generate_chunk(client, model, system, chunk, force=False):
    path = GEN_CACHE / model_slug(model) / f'{chunk_key(chunk)}.json'
    if path.exists() and not force:
        cached = json.loads(path.read_text(encoding='utf-8'))
        if cached.get('parsed') is not None:
            return cached, True
    if _SPENT[0] > BUDGET_USD - JUDGE_RESERVE_USD:
        raise RuntimeError(f'budget cap {BUDGET_USD} USD (less {JUDGE_RESERVE_USD} reserved for judging) reached; not launching more requests')
    if _SPENT[0] - _SPENT[1] > _SPENT[2]:
        raise RuntimeError(f'account credit floor: this run may spend at most {_SPENT[2]:.2f} USD; not launching more requests')
    path.parent.mkdir(parents=True, exist_ok=True)
    user = user_prompt(chunk)
    ids = {s['id'] for s in chunk['scenarios']}
    content, record = client.chat(model, system, user, json_mode=True, tag=chunk_key(chunk))
    parsed = None
    error = None
    try:
        parsed = parse_json_object(content)
    except ValueError as e:
        error = str(e)
        # One cooler retry: a truncated or chatty reply is usually a one-off.
        content, record2 = client.chat(model, system, user, json_mode=True, temperature=0.2, tag=chunk_key(chunk) + '#retry')
        record = {'first': record, 'retry': record2}
        try:
            parsed = parse_json_object(content)
            error = None
        except ValueError as e2:
            error = f'{error}; retry: {e2}'
    if parsed is not None:
        returned = {str(s.get('id')) for s in parsed.get('scenarios', []) if isinstance(s, dict)}
        parsed['_missing_ids'] = sorted(ids - returned, key=int)
        parsed['_foreign_ids'] = sorted(returned - ids)
    out = {'model': model, 'topic': chunk['topic'], 'chunk': chunk['chunk'], 'ids': sorted(ids, key=int),
           'usage': record, 'raw': content, 'parsed': parsed, 'error': error,
           'generated_at': datetime.now(timezone.utc).isoformat(timespec='seconds')}
    path.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8')
    return out, False


def assemble(scenarios, models):
    """Every cached phrasing, cleaned and labelled with its split."""
    by_id = {s['id']: s for s in scenarios}
    held = holdout_ids(scenarios)
    items = {}
    stats = {'chunks': 0, 'chunks_failed': 0, 'phrasings': 0, 'dropped_foreign_id': 0, 'dropped_bad_shape': 0, 'dropped_alias_shape': 0}
    for model in models:
        slug = model_slug(model)
        for path in sorted((GEN_CACHE / slug).glob('*.json')) if (GEN_CACHE / slug).exists() else []:
            cached = json.loads(path.read_text(encoding='utf-8'))
            stats['chunks'] += 1
            parsed = cached.get('parsed')
            if not parsed:
                stats['chunks_failed'] += 1
                continue
            chunk_ids = set(cached['ids'])
            for sc in parsed.get('scenarios', []):
                sid = str(sc.get('id', ''))
                if sid not in chunk_ids or sid not in by_id:
                    stats['dropped_foreign_id'] += 1
                    continue
                for srch in sc.get('searches', []) or []:
                    if not isinstance(srch, dict) or not isinstance(srch.get('q'), str) or not srch['q'].strip():
                        stats['dropped_bad_shape'] += 1
                        continue
                    q = re.sub(r'\s+', ' ', srch['q']).strip()
                    kind = str(srch.get('kind', 'direct')).lower().strip()
                    if kind not in KINDS:
                        kind = 'direct'
                    aliases = []
                    for pair in srch.get('aliases', []) or []:
                        if isinstance(pair, dict):
                            pair = [pair.get('from'), pair.get('to')]
                        if not (isinstance(pair, list) and len(pair) == 2 and isinstance(pair[0], str) and isinstance(pair[1], str)):
                            stats['dropped_alias_shape'] += 1
                            continue
                        frm = re.sub(r'\s+', ' ', pair[0]).strip().lower()
                        to = re.sub(r'\s+', ' ', pair[1]).strip().lower()
                        if not frm or frm == to:
                            continue
                        aliases.append([frm, to])
                    key = (q.lower(), sid)
                    s = by_id[sid]
                    if key in items:
                        if model not in items[key]['models']:
                            items[key]['models'].append(model)
                        for a in aliases:
                            if a not in items[key]['aliases']:
                                items[key]['aliases'].append(a)
                        continue
                    items[key] = {'q': q, 'id': sid, 'topic': s['topic'], 'region': s['region'], 'kind': kind,
                                  'aliases': aliases, 'models': [model], 'split': 'holdout' if sid in held else 'train'}
                    stats['phrasings'] += 1
    return list(items.values()), held, stats


def cost_summary():
    totals = {}
    if not (CACHE / 'cost_log.jsonl').exists():
        return totals
    for line in (CACHE / 'cost_log.jsonl').read_text(encoding='utf-8').splitlines():
        if not line.strip():
            continue
        r = json.loads(line)
        t = totals.setdefault(r['model'], {'calls': 0, 'prompt_tokens': 0, 'completion_tokens': 0, 'cached_tokens': 0, 'cost_usd': 0.0})
        t['calls'] += 1
        t['prompt_tokens'] += r.get('prompt_tokens') or 0
        t['completion_tokens'] += r.get('completion_tokens') or 0
        t['cached_tokens'] += r.get('cached_tokens') or 0
        t['cost_usd'] += r.get('cost_usd') or 0.0
    totals['total_usd'] = round(sum(v['cost_usd'] for v in totals.values()), 4)
    (CACHE / 'cost_summary.json').write_text(json.dumps(totals, indent=1), encoding='utf-8')
    return totals


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--dry-run', action='store_true', help='count chunks and estimate tokens; call nothing')
    ap.add_argument('--limit', type=int, default=0, help='run only the first N chunks of the primary model')
    ap.add_argument('--pilot', type=int, default=0, help='run only the first N topics (both models) and project the full cost')
    ap.add_argument('--assemble-only', action='store_true', help='rebuild the dataset from the cache; call nothing')
    ap.add_argument('--primary', default=PRIMARY_MODEL)
    ap.add_argument('--secondary', default=SECONDARY_MODEL)
    ap.add_argument('--no-secondary', action='store_true')
    ap.add_argument('--no-legacy', action='store_true', help='leave the earlier model\'s cached phrasings out of the dataset')
    ap.add_argument('--only-missing', action='store_true',
                    help='primary model only for chunks holding a scenario no cached model output covers yet')
    ap.add_argument('--concurrency', type=int, default=CONCURRENCY)
    args = ap.parse_args()

    CACHE.mkdir(parents=True, exist_ok=True)
    scenarios = load_scenarios()
    chunks = topic_chunks(scenarios)
    held = holdout_ids(scenarios)
    (CACHE / 'split.json').write_text(json.dumps({'seed': SPLIT_SEED, 'holdout_fraction': HOLDOUT_FRACTION,
                                                  'holdout_ids': sorted(held, key=int)}, indent=0), encoding='utf-8')
    models = [args.primary] + ([] if args.no_secondary else [args.secondary])
    assembled_models = models + ([] if args.no_legacy else [m for m in LEGACY_MODELS if m not in models])

    all_jobs = [(args.primary, c) for c in chunks]
    if not args.no_secondary:
        all_jobs += [(args.secondary, c) for c in chunks if c['topic_index'] % SECONDARY_EVERY == 0]
    jobs = all_jobs
    if args.pilot:
        jobs = [j for j in all_jobs if j[1]['topic_index'] < args.pilot]
    if args.only_missing:
        covered = {it['id'] for it in assemble(scenarios, assembled_models)[0]}
        jobs = [j for j in jobs if j[0] != args.primary or any(s['id'] not in covered for s in j[1]['scenarios'])]
    if args.limit:
        jobs = [j for j in jobs if j[0] == args.primary][:args.limit]

    _SPENT[0] = spent_to_date(CACHE / 'cost_log.jsonl')
    log(f'models: primary {args.primary}, secondary {"none" if args.no_secondary else args.secondary}; '
        f'legacy cache assembled: {[m for m in assembled_models if m not in models]}')
    log(f'{len(scenarios)} scenarios, {len(chunks)} chunks, {len(held)} hold-out scenarios, {len(jobs)} of {len(all_jobs)} requests planned; '
        f'spent to date {_SPENT[0]:.2f} USD of the {BUDGET_USD:.0f} USD cap')
    if args.dry_run:
        chars = sum(len(user_prompt(c)) for _, c in jobs)
        log(f'about {chars // 4} user-prompt tokens plus the system prompt per request; nothing called')
        return
    if not args.assemble_only:
        known = hand_alias_phrases()
        system = SYSTEM_PROMPT.replace('{known}', ', '.join(sorted(known)))
        client = OpenRouter(find_api_key(), CACHE / 'cost_log.jsonl')
        run_start = _SPENT[0]
        _SPENT[1] = run_start
        credit = client.remaining_credit()
        if credit is not None:
            _SPENT[2] = max(0.0, credit - CREDIT_FLOOR_USD - JUDGE_RESERVE_USD)
            log(f'account credit left {credit:.2f} USD; this run may spend at most {_SPENT[2]:.2f} USD '
                f'(floor {CREDIT_FLOOR_USD:.0f} for the live product, {JUDGE_RESERVE_USD:.0f} reserved for judging)')
        done = fresh = failed = 0
        with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
            futures = {pool.submit(generate_chunk, client, model, system, chunk): (model, chunk) for model, chunk in jobs}
            for fut in as_completed(futures):
                model, chunk = futures[fut]
                try:
                    out, cached = fut.result()
                except Exception as e:
                    failed += 1
                    log(f'FAILED {model} {chunk_key(chunk)}: {e}')
                    continue
                done += 1
                fresh += 0 if cached else 1
                if not cached:
                    n = len((out.get('parsed') or {}).get('scenarios', []))
                    log(f"{done}/{len(jobs)} {model.split('/')[-1]} {chunk_key(chunk)[:50]} scenarios={n} missing={len((out.get('parsed') or {}).get('_missing_ids', []))} spent={_SPENT[0]:.2f} USD")
        run_cost = _SPENT[0] - run_start
        log(f'requests done {done}, fresh {fresh}, failed {failed}, spent this run {run_cost:.2f} USD, to date {_SPENT[0]:.2f} USD')
        if fresh:
            # Projection for the whole job from the fresh requests of this run, per model.
            per_model = {}
            for line in (CACHE / 'cost_log.jsonl').read_text(encoding='utf-8').splitlines()[-fresh * 2:]:
                r = json.loads(line)
                if r.get('tag', '').startswith('judge'):
                    continue
                p = per_model.setdefault(r['model'], [0, 0.0])
                p[0] += 1
                p[1] += r.get('cost_usd') or 0.0
            projection = 0.0
            for model, (n, cost) in per_model.items():
                planned = sum(1 for m, _ in all_jobs if m == model)
                projected = cost / n * planned
                projection += projected
                log(f'projection {model}: {cost / n:.4f} USD per request x {planned} requests = {projected:.2f} USD')
            log(f'projected generation total {projection:.2f} USD; with {_SPENT[0] - run_cost:.2f} USD already spent and '
                f'{JUDGE_RESERVE_USD:.0f} USD reserved for judging: {projection + _SPENT[0] - run_cost + JUDGE_RESERVE_USD:.2f} USD against the {BUDGET_USD:.0f} USD cap')

    items, held, stats = assemble(scenarios, assembled_models)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        'generated_at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'models': assembled_models, 'primary_model': args.primary, 'secondary_model': None if args.no_secondary else args.secondary,
        'split_seed': SPLIT_SEED, 'holdout_fraction': HOLDOUT_FRACTION,
        'holdout_scenarios': len(held), 'stats': stats, 'items': items,
    }, ensure_ascii=False, indent=0), encoding='utf-8')
    totals = cost_summary()
    log(f"dataset: {len(items)} phrasings ({sum(1 for i in items if i['split'] == 'holdout')} hold-out) -> {OUT.relative_to(REPO)}; stats {stats}")
    log(f"cost to date: {json.dumps(totals)}")


if __name__ == '__main__':
    main()
