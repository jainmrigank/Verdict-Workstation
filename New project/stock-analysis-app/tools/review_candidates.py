#!/usr/bin/env python3
"""Run a local review workspace for reasoning gold or contract fixtures."""

from __future__ import annotations

import argparse
import json
import threading
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


APP_ROOT = Path(__file__).resolve().parents[1]
CANDIDATES_PATH = APP_ROOT / "data" / "training" / "reasoning_gold.jsonl"
DATASET_PATHS = {
    "reasoning": CANDIDATES_PATH,
    "fixtures": APP_ROOT / "data" / "training" / "contract_fixtures.jsonl",
}
MAX_REVIEW_BYTES = 2 * 1024 * 1024
REVIEW_CHECKS = {
    "verdict": "Deterministic verdict is preserved",
    "grounding": "Numbers and company claims are grounded in factRefs",
    "rules": "ruleRefs are relevant",
    "coverage": "Applicable sections are complete and useful",
    "gaps": "Missing or non-applicable evidence is stated honestly",
    "applicability": "Funds, ETFs, and indices avoid company-only claims",
    "writingQuality": "Wording is specific, concise, and non-repetitive",
}
WRITE_LOCK = threading.Lock()


def read_candidates() -> list[dict[str, Any]]:
    if not CANDIDATES_PATH.exists():
        return []
    return [
        json.loads(line)
        for line in CANDIDATES_PATH.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def write_candidates(rows: list[dict[str, Any]]) -> None:
    payload = "".join(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n" for row in rows)
    temporary = CANDIDATES_PATH.with_suffix(".jsonl.tmp")
    temporary.write_text(payload, encoding="utf-8")
    temporary.replace(CANDIDATES_PATH)


def counts(rows: list[dict[str, Any]]) -> dict[str, int]:
    result = {"total": len(rows), "pending": 0, "approved": 0, "rejected": 0}
    for row in rows:
        status = str(row.get("reviewStatus") or "pending")
        result[status] = result.get(status, 0) + 1
    return result


def apply_review(rows: list[dict[str, Any]], payload: dict[str, Any]) -> dict[str, Any]:
    candidate_id = str(payload.get("id") or "")
    status = str(payload.get("status") or "pending")
    if status not in {"pending", "approved", "rejected"}:
        raise ValueError("Review status must be pending, approved, or rejected.")
    candidate = next((row for row in rows if str(row.get("id")) == candidate_id), None)
    if candidate is None:
        raise ValueError("Candidate not found.")
    output = payload.get("output")
    if not isinstance(output, dict):
        raise ValueError("Expected output must be a JSON object.")
    checks = payload.get("checks") if isinstance(payload.get("checks"), dict) else {}
    if status == "approved" and not all(checks.get(name) is True for name in REVIEW_CHECKS):
        raise ValueError("Complete every review check before approving this candidate.")
    candidate["output"] = output
    candidate["reviewStatus"] = status
    candidate["reviewNotes"] = str(payload.get("reviewNotes") or "").strip()
    candidate["humanReview"] = {
        "checks": {name: checks.get(name) is True for name in REVIEW_CHECKS},
        "reviewedAt": datetime.now(UTC).isoformat(),
    }
    return candidate


INDEX_HTML = r"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Gold Candidate Review</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #111416; color: #e9ecef; }
    * { box-sizing: border-box; }
    body { margin: 0; min-width: 320px; background: #111416; }
    button, select, textarea { font: inherit; }
    button { border: 1px solid #485057; background: #20262a; color: #f5f7f8; padding: 9px 13px; border-radius: 6px; cursor: pointer; }
    button:hover { border-color: #7d8a91; }
    button.primary { background: #d4774e; border-color: #d4774e; color: #17110e; font-weight: 700; }
    button.danger { color: #ffaaa1; }
    button:disabled { cursor: wait; opacity: .55; }
    header { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 14px 20px; border-bottom: 1px solid #30363a; background: #15191c; }
    h1 { margin: 0; font-size: 18px; }
    .counts { display: flex; gap: 14px; color: #aeb6bc; font-size: 13px; }
    .toolbar { display: flex; align-items: center; gap: 8px; }
    select { border: 1px solid #485057; background: #181d20; color: #e9ecef; padding: 9px; border-radius: 6px; }
    main { max-width: 1500px; margin: 0 auto; padding: 18px 20px 28px; }
    .candidate-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-bottom: 14px; border-bottom: 1px solid #30363a; }
    .candidate-head h2 { margin: 0 0 4px; font-size: 19px; }
    .muted { color: #aeb6bc; font-size: 13px; }
    .status { padding: 4px 8px; border-radius: 5px; background: #2a3034; text-transform: uppercase; font-size: 11px; font-weight: 800; }
    .status.approved { color: #7de0b3; }
    .status.rejected { color: #ff9a90; }
    .workspace { display: grid; grid-template-columns: minmax(300px, .85fr) minmax(420px, 1.15fr); gap: 20px; margin-top: 18px; }
    section { min-width: 0; }
    h3 { margin: 0 0 10px; font-size: 14px; text-transform: uppercase; color: #aeb6bc; }
    pre, textarea { width: 100%; margin: 0; border: 1px solid #343b40; background: #171b1e; color: #dce2e5; border-radius: 6px; font: 12px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; }
    pre { max-height: 500px; overflow: auto; padding: 13px; white-space: pre-wrap; word-break: break-word; }
    textarea { min-height: 520px; resize: vertical; padding: 13px; }
    .model-review { margin-top: 18px; }
    .checks { display: grid; gap: 9px; margin: 18px 0; padding: 14px 0; border-top: 1px solid #30363a; border-bottom: 1px solid #30363a; }
    .checks label { display: flex; gap: 9px; align-items: flex-start; color: #d8dde0; font-size: 14px; }
    input[type="checkbox"] { width: 17px; height: 17px; margin: 1px 0 0; accent-color: #d4774e; }
    .notes { min-height: 84px; font-family: inherit; }
    .actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-top: 12px; }
    .empty { padding: 60px 0; text-align: center; color: #aeb6bc; }
    .error { color: #ffaaa1; min-height: 20px; margin-top: 8px; font-size: 13px; }
    @media (max-width: 820px) {
      header, .candidate-head { align-items: flex-start; flex-direction: column; }
      .workspace { grid-template-columns: 1fr; }
      textarea { min-height: 430px; }
      .counts { flex-wrap: wrap; }
    }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>Gold Candidate Review</h1>
      <div class="counts" id="counts"></div>
    </div>
    <div class="toolbar">
      <select id="filter" aria-label="Filter candidates">
        <option value="all">All candidates</option>
        <option value="pending">Pending</option>
        <option value="approved">Approved</option>
        <option value="rejected">Rejected</option>
      </select>
      <button id="previous" aria-label="Previous candidate">Previous</button>
      <button id="next" aria-label="Next candidate">Next</button>
    </div>
  </header>
  <main>
    <div id="empty" class="empty" hidden>No candidates match this filter.</div>
    <div id="reviewer">
      <div class="candidate-head">
        <div><h2 id="candidate-title"></h2><div class="muted" id="candidate-meta"></div></div>
        <span class="status" id="status"></span>
      </div>
      <div class="workspace">
        <section>
          <h3>Structured facts</h3>
          <pre id="facts"></pre>
          <div class="model-review">
            <h3>Gemini preflight</h3>
            <pre id="model-review"></pre>
          </div>
        </section>
        <section>
          <h3>Expected LlmAnalysisV1 output</h3>
          <textarea id="output" spellcheck="false"></textarea>
          <div class="checks" id="checks"></div>
          <h3>Review notes</h3>
          <textarea class="notes" id="notes" placeholder="Record corrections or the reason for rejection."></textarea>
          <div class="error" id="error"></div>
          <div class="actions">
            <button id="save">Save draft</button>
            <button class="danger" id="reject">Reject</button>
            <button class="primary" id="approve">Approve</button>
          </div>
        </section>
      </div>
    </div>
  </main>
  <script>
    const checkLabels = __CHECK_LABELS__;
    const state = { rows: [], filter: 'all', index: 0 };
    const byId = id => document.getElementById(id);

    function visibleRows() {
      return state.filter === 'all' ? state.rows : state.rows.filter(row => (row.reviewStatus || 'pending') === state.filter);
    }

    function renderCounts() {
      const result = { total: state.rows.length, pending: 0, approved: 0, rejected: 0 };
      state.rows.forEach(row => result[row.reviewStatus || 'pending']++);
      byId('counts').textContent = `Total ${result.total}  |  Pending ${result.pending}  |  Approved ${result.approved}  |  Rejected ${result.rejected}`;
    }

    function render() {
      const rows = visibleRows();
      if (state.index >= rows.length) state.index = Math.max(0, rows.length - 1);
      const row = rows[state.index];
      byId('empty').hidden = Boolean(row);
      byId('reviewer').hidden = !row;
      renderCounts();
      if (!row) return;
      byId('candidate-title').textContent = row.id;
      const facts = row.facts || {};
      const provenance = row.reviewAudit?.reviewerType ? ` | ${row.reviewAudit.reviewerType}` : '';
      byId('candidate-meta').textContent = `${state.index + 1} of ${rows.length} | ${facts.instrument?.type || 'unknown'} | ${facts.userContext?.action || '-'} | ${facts.deterministicAnalysis?.verdict || '-'}${provenance}`;
      byId('status').textContent = row.reviewStatus || 'pending';
      byId('status').className = `status ${row.reviewStatus || 'pending'}`;
      byId('facts').textContent = JSON.stringify({ facts: row.facts, retrievedRuleIds: row.retrievedRuleIds }, null, 2);
      byId('model-review').textContent = row.modelReview ? JSON.stringify(row.modelReview, null, 2) : 'Run the Gemini preflight command to add an advisory review.';
      byId('output').value = JSON.stringify(row.output, null, 2);
      byId('notes').value = row.reviewNotes || '';
      byId('checks').innerHTML = '';
      Object.entries(checkLabels).forEach(([name, label]) => {
        const wrapper = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.dataset.check = name;
        input.checked = Boolean(row.humanReview?.checks?.[name] ?? row.reviewAudit?.checks?.[name]);
        wrapper.append(input, document.createTextNode(label));
        byId('checks').append(wrapper);
      });
      byId('error').textContent = '';
      byId('previous').disabled = state.index === 0;
      byId('next').disabled = state.index >= rows.length - 1;
    }

    async function save(status) {
      const rows = visibleRows();
      const row = rows[state.index];
      if (!row) return;
      let output;
      try { output = JSON.parse(byId('output').value); }
      catch (error) { byId('error').textContent = `Output JSON is invalid: ${error.message}`; return; }
      const checks = {};
      document.querySelectorAll('[data-check]').forEach(input => checks[input.dataset.check] = input.checked);
      const controls = document.querySelectorAll('button');
      controls.forEach(control => control.disabled = true);
      try {
        const response = await fetch('/api/review', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: row.id, status, output, checks, reviewNotes: byId('notes').value }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Review could not be saved.');
        const sourceIndex = state.rows.findIndex(candidate => candidate.id === row.id);
        state.rows[sourceIndex] = payload.candidate;
        if (status !== 'pending' && state.filter === 'pending') state.index = Math.min(state.index, Math.max(0, visibleRows().length - 1));
        render();
      } catch (error) {
        byId('error').textContent = error.message;
      } finally {
        controls.forEach(control => control.disabled = false);
      }
    }

    byId('filter').addEventListener('change', event => { state.filter = event.target.value; state.index = 0; render(); });
    byId('previous').addEventListener('click', () => { state.index = Math.max(0, state.index - 1); render(); });
    byId('next').addEventListener('click', () => { state.index = Math.min(visibleRows().length - 1, state.index + 1); render(); });
    byId('save').addEventListener('click', () => save('pending'));
    byId('reject').addEventListener('click', () => save('rejected'));
    byId('approve').addEventListener('click', () => save('approved'));

    fetch('/api/candidates').then(response => response.json()).then(payload => { state.rows = payload.candidates; render(); }).catch(error => {
      byId('reviewer').hidden = true; byId('empty').hidden = false; byId('empty').textContent = error.message;
    });
  </script>
</body>
</html>"""


class ReviewHandler(BaseHTTPRequestHandler):
    def _write(self, status: int, content_type: str, payload: bytes) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def _json(self, payload: dict[str, Any], status: int = 200) -> None:
        self._write(status, "application/json; charset=utf-8", json.dumps(payload).encode("utf-8"))

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/":
            html = INDEX_HTML.replace("__CHECK_LABELS__", json.dumps(REVIEW_CHECKS))
            self._write(200, "text/html; charset=utf-8", html.encode("utf-8"))
            return
        if path == "/api/candidates":
            rows = read_candidates()
            self._json({"candidates": rows, "counts": counts(rows), "checks": REVIEW_CHECKS})
            return
        self._json({"error": "Not found."}, status=404)

    def do_POST(self) -> None:
        if urlparse(self.path).path != "/api/review":
            self._json({"error": "Not found."}, status=404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_REVIEW_BYTES:
                raise ValueError("Review payload is empty or too large.")
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            if not isinstance(payload, dict):
                raise ValueError("Review payload must be an object.")
            with WRITE_LOCK:
                rows = read_candidates()
                candidate = apply_review(rows, payload)
                write_candidates(rows)
            self._json({"candidate": candidate, "counts": counts(rows)})
        except (ValueError, json.JSONDecodeError) as exc:
            self._json({"error": str(exc)}, status=400)

    def log_message(self, format: str, *args: Any) -> None:
        return


def main() -> int:
    global CANDIDATES_PATH
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8791)
    parser.add_argument("--dataset", choices=sorted(DATASET_PATHS), default="reasoning")
    args = parser.parse_args()
    CANDIDATES_PATH = DATASET_PATHS[args.dataset]
    server = ThreadingHTTPServer((args.host, args.port), ReviewHandler)
    print(f"Candidate review workspace: http://{args.host}:{args.port}/")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
