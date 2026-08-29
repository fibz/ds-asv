"""Minimal, same-origin customer portal for exercising the private scan API."""

import json
import os

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse

router = APIRouter()


@router.get("/portal", response_class=HTMLResponse, include_in_schema=False)
@router.get("/portal-v2", response_class=HTMLResponse, include_in_schema=False)
def customer_portal(request: Request) -> HTMLResponse:
    """Serve a dependency-free UI backed by the existing authenticated API."""
    local_host = request.url.hostname in {"127.0.0.1", "localhost", "::1"}
    local_access = (
        os.environ.get("LOCAL_PORTAL_DEV_ACCESS", "false").lower() == "true"
        and local_host
    )
    local_token = (
        os.environ.get("API_BEARER_TOKEN", "dev-token") if local_access else None
    )
    html = _PORTAL_HTML.replace("__LOCAL_DEV_TOKEN__", json.dumps(local_token))
    return HTMLResponse(html, headers={"Cache-Control": "no-store"})


_PORTAL_HTML = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Kilo ASV scan portal</title>
  <style>
    :root { color-scheme: light; font: 16px/1.5 system-ui, sans-serif; }
    body { margin: 0; color: #172033; background: #f4f7fb; }
    main { max-width: 920px; margin: 3rem auto; padding: 0 1rem; }
    section { background: white; border: 1px solid #d9e0ea; border-radius: 12px;
      box-shadow: 0 8px 24px #17203310; margin: 1rem 0; padding: 1.25rem; }
    h1, h2 { line-height: 1.2; } h1 { margin-bottom: .35rem; }
    label { display: block; font-weight: 650; margin-top: .9rem; }
    input, select, textarea, button { box-sizing: border-box; font: inherit; width: 100%;
      border: 1px solid #9da9ba; border-radius: 7px; padding: .7rem; }
    button { width: auto; margin-top: 1rem; color: white; background: #185adb;
      border-color: #185adb; cursor: pointer; font-weight: 700; }
    button:disabled { cursor: wait; opacity: .6; }
    .row { display: grid; gap: 1rem; grid-template-columns: 1fr 1fr; }
    .check { display: flex; gap: .6rem; align-items: start; font-weight: 500; }
    .check input { margin-top: .3rem; width: auto; }
    .muted { color: #596579; } .hidden { display: none; }
    .message { border-left: 4px solid #185adb; padding: .75rem; background: #eef4ff; }
    .error { border-left-color: #b42318; background: #fff0ee; color: #8a1c14; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border-bottom: 1px solid #d9e0ea; padding: .65rem; text-align: left; }
    code { overflow-wrap: anywhere; }
    @media (max-width: 650px) { .row { grid-template-columns: 1fr; } }
  </style>
</head>
<body><main>
  <h1>Kilo ASV scan portal</h1>
  <p class="muted"><strong>Portal build 2026-08-16.7</strong></p>
  <p class="muted">Run one standard, unauthenticated network scan against a target
    already approved in your private Kilo account.</p>

  <section id="access">
    <h2>1. Connect to the private API</h2>
    <label for="token">API bearer token</label>
    <input id="token" type="password" autocomplete="off" required
      placeholder="Enter the configured token (Bearer prefix is optional)">
    <p class="muted">The token stays in this page's memory and is not stored by the portal.</p>
    <button id="local-access" class="hidden" type="button">Use local development access</button>
    <p id="local-note" class="muted hidden">Local development only; credentials remain in page memory.</p>
    <button id="load" type="button">Load approved customers</button>
  </section>

  <section id="onboarding" class="hidden">
    <h2>2. Onboard a customer and approved scope</h2>
    <p class="muted">Enter only CIDRs the customer owns or controls. IPv4 scopes
      must be /24 or narrower; IPv6 scopes must be /64 or narrower. Broad Internet
      ranges are refused by the API.</p>
    <form id="onboarding-form">
      <div class="row">
        <div><label for="new-name">Customer name</label>
          <input id="new-name" required autocomplete="organization"></div>
        <div><label for="new-email">Security contact email</label>
          <input id="new-email" type="email" required autocomplete="email"></div>
      </div>
      <label for="new-cidrs">Approved CIDRs (one per line)</label>
      <textarea id="new-cidrs" rows="4" required placeholder="192.168.1.0/24"></textarea>
      <label class="check"><input id="scope-authorization" type="checkbox" required>
        <span>I confirm the customer owns or controls these networks and authorizes
          Kilo to scan targets within them.</span></label>
      <button id="onboard" type="submit">Create customer and approve scope</button>
      <p id="onboarding-message" class="muted" aria-live="polite"></p>
    </form>
  </section>

  <section id="scan-panel" class="hidden">
    <h2>3. Choose a customer and approved target</h2>
    <form id="scan-form">
      <div class="row">
        <div><label for="customer">Customer</label><select id="customer" required></select></div>
        <div><label for="approved">Approved scope boundary</label>
          <select id="approved"><option value="">Select an approved CIDR</option></select></div>
      </div>
      <label for="target">Target IP address or private hostname</label>
      <input id="target" required autocomplete="off" placeholder="10.0.0.25 or api.internal.example">
      <p id="scope" class="muted"></p>
      <label class="check"><input id="authorization" type="checkbox" required>
        <span>I confirm that I own or am authorized to scan this target and that it is
          covered by the selected customer's approved scope.</span></label>
      <button id="submit" type="submit">Run standard scan</button>
    </form>
  </section>

  <section id="history" class="hidden">
    <h2>4. Past scans</h2>
    <p class="muted">History is loaded from the API and remains available after a page reload.</p>
    <button id="refresh-history" type="button">Refresh scan history</button>
    <div id="history-content" aria-live="polite"></div>
  </section>

  <section id="progress" class="hidden" aria-live="polite">
    <h2>5. Scan status and results</h2>
    <div id="message" class="message"></div>
    <dl><dt>Scan ID</dt><dd><code id="scan-id"></code></dd>
      <dt>Status</dt><dd id="status">—</dd><dt>Overall result</dt><dd id="result">—</dd></dl>
    <div id="target-evidence"></div>
    <div id="findings"></div>
  </section>

<script>
(() => {
  'use strict';
  let token = '', customers = [], timer = null, historyRequestId = 0;
  const localDevelopmentToken = __LOCAL_DEV_TOKEN__;
  const $ = (id) => document.getElementById(id);
  const normalizedToken = () => token.trim().replace(/^Bearer\\s+/i, '');
  const headers = () => ({'Authorization': `Bearer ${normalizedToken()}`, 'Content-Type': 'application/json'});
  const terminal = new Set(['completed', 'failed', 'partial']);

  async function api(path, options = {}) {
    const response = await fetch(path, {cache: 'no-store', ...options, headers: {...headers(), ...(options.headers || {})}});
    let body = null;
    try { body = await response.json(); } catch (_) { body = null; }
    if (!response.ok) throw new Error((body && body.detail) || `API request failed (${response.status})`);
    return body;
  }

  function scopes(customer) {
    try { const value = JSON.parse(customer.scope_ips || '[]'); return Array.isArray(value) ? value : []; }
    catch (_) { return []; }
  }
  function showError(error) {
    $('progress').classList.remove('hidden'); $('message').className = 'message error';
    $('message').textContent = error.message || String(error);
  }
  function selectCustomer() {
    const customer = customers.find((item) => item.id === $('customer').value);
    const entries = customer ? scopes(customer) : [];
    $('approved').replaceChildren(new Option('Select an approved CIDR', ''));
    entries.forEach((value) => $('approved').add(new Option(value, value)));
    $('scope').textContent = entries.length
      ? `Approved scope: ${entries.join(', ')}`
      : 'No approved scope is configured. The API will refuse this scan.';
    if (customer) loadHistory(customer.id);
  }
  function populateCustomers(selectedId = '') {
    customers = [...new Map(customers.map((item) => [item.id, item])).values()];
    $('customer').replaceChildren(...customers.map((item) => new Option(item.name, item.id)));
    if (selectedId) $('customer').value = selectedId;
    if (customers.length) {
      selectCustomer(); $('scan-panel').classList.remove('hidden');
      $('history').classList.remove('hidden');
    } else {
      $('scan-panel').classList.add('hidden');
      $('history').classList.add('hidden');
    }
  }
  async function loadHistory(customerId) {
    const requestId = ++historyRequestId;
    $('history-content').textContent = 'Loading history…';
    try {
      const scans = await api(`/v1/customers/${encodeURIComponent(customerId)}/scans`);
      if (requestId !== historyRequestId || customerId !== $('customer').value) return;
      if (!scans.length) { $('history-content').textContent = 'No past scans.'; return; }
      const table = document.createElement('table');
      const head = table.createTHead().insertRow();
      ['Scan ID', 'Submitted', 'Status', 'Targets', 'Result', 'Finished', ''].forEach((value) => {
        const th = document.createElement('th'); th.textContent = value; head.appendChild(th);
      });
      const body = table.createTBody();
      scans.forEach((scan) => {
        const row = body.insertRow();
        [scan.scan_id, new Date(scan.submitted_at).toLocaleString(), scan.status,
          scan.targets.join(', '), scan.overall_result || '—',
          scan.completed_at ? new Date(scan.completed_at).toLocaleString() : '—'
        ].forEach((value) => { const td = row.insertCell(); td.textContent = value; });
        const action = row.insertCell(); const button = document.createElement('button');
        button.type = 'button'; button.textContent = 'Open details';
        button.addEventListener('click', () => openStoredScan(scan.scan_id));
        action.appendChild(button);
      });
      $('history-content').replaceChildren(table);
    } catch (error) { $('history-content').textContent = error.message || String(error); }
  }
  async function openStoredScan(scanId) {
    clearTimeout(timer); $('progress').classList.remove('hidden');
    $('scan-id').textContent = scanId; $('message').className = 'message';
    $('message').textContent = 'Loading persisted scan details…';
    await poll(scanId);
  }

  $('load').addEventListener('click', async () => {
    token = $('token').value;
    if (!token) { showError(new Error('Enter an API bearer token.')); return; }
    $('load').disabled = true;
    try {
      customers = await api('/v1/customers');
      customers = customers.filter((item) => item.is_active);
      $('onboarding').classList.remove('hidden');
      populateCustomers();
      $('progress').classList.add('hidden');
    } catch (error) { showError(error); }
    finally { $('load').disabled = false; }
  });
  if (localDevelopmentToken) {
    $('local-access').classList.remove('hidden');
    $('local-note').classList.remove('hidden');
    $('local-access').addEventListener('click', () => {
      $('token').value = localDevelopmentToken;
      $('load').click();
    });
  }
  $('onboarding-form').addEventListener('submit', async (event) => {
    event.preventDefault(); $('onboard').disabled = true;
    $('onboarding-message').textContent = '';
    try {
      const scopeCidrs = $('new-cidrs').value.split(/\\r?\\n/).map((v) => v.trim()).filter(Boolean);
      const customer = await api('/v1/customers/onboard', {method: 'POST', body: JSON.stringify({
        name: $('new-name').value.trim(), contact_email: $('new-email').value.trim(),
        scope_cidrs: scopeCidrs, authorization_confirmed: $('scope-authorization').checked
      })});
      customers.push(customer); populateCustomers(customer.id);
      $('onboarding-message').textContent = 'Customer created. Approved scope is now enforced by the scan API.';
      $('onboarding-form').reset();
    } catch (error) { $('onboarding-message').textContent = error.message || String(error); }
    finally { $('onboard').disabled = false; }
  });
  $('customer').addEventListener('change', selectCustomer);
  $('refresh-history').addEventListener('click', () => loadHistory($('customer').value));
  $('approved').addEventListener('change', () => {
    $('target').placeholder = $('approved').value
      ? `Enter one IP within ${$('approved').value}`
      : 'Enter an approved IP address';
  });

  $('scan-form').addEventListener('submit', async (event) => {
    event.preventDefault(); clearTimeout(timer); $('submit').disabled = true;
    try {
      const target = $('target').value.trim();
      const customerId = $('customer').value;
      const scopeCheck = await api(`/v1/customers/${encodeURIComponent(customerId)}/scope/check?target=${encodeURIComponent(target)}`);
      if (!scopeCheck.allowed) throw new Error(scopeCheck.detail);
      const created = await api('/v1/scans', {method: 'POST', body: JSON.stringify({
        customer_id: customerId, targets: [target],
        auth_method: 'none', scan_type: 'adhoc'
      })});
      $('scan-id').textContent = created.scan_id; $('progress').classList.remove('hidden');
      $('message').className = 'message'; $('message').textContent = 'Scan accepted. Waiting for the scanner worker…';
      loadHistory($('customer').value);
      await poll(created.scan_id);
    } catch (error) { showError(error); $('submit').disabled = false; }
  });

  async function poll(scanId) {
    try {
      const scan = await api(`/v1/scans/${encodeURIComponent(scanId)}`);
      $('status').textContent = scan.status; $('result').textContent = scan.overall_result || 'Pending';
      if (terminal.has(scan.status)) {
        $('submit').disabled = false;
        if (scan.error_message) { $('message').className = 'message error'; $('message').textContent = scan.error_message; }
        else { $('message').textContent = `Scan ${scan.status}.`; }
        await loadDetails(scanId); return;
      }
      timer = setTimeout(() => poll(scanId), 2500);
    } catch (error) { showError(error); $('submit').disabled = false; }
  }
  async function loadDetails(scanId) {
    const [details, items] = await Promise.all([
      api(`/v1/scans/${encodeURIComponent(scanId)}/details`),
      api(`/v1/scans/${encodeURIComponent(scanId)}/findings`)
    ]);
    const evidence = document.createElement('div');
    details.targets.forEach((target) => {
      const heading = document.createElement('h3'); heading.textContent = target.target;
      evidence.appendChild(heading);
      const summary = document.createElement('p');
      const finished = target.completed_at ? new Date(target.completed_at).toLocaleString() : 'Not finished';
      summary.textContent = `Target status: ${target.status}. Started: ${new Date(target.started_at).toLocaleString()}. Finished: ${finished}. Duration: ${target.duration_seconds ?? '—'} seconds.`;
      evidence.appendChild(summary);
      if (!target.open_ports.length) {
        const empty = document.createElement('p'); empty.textContent = 'No persisted open-port evidence is available for this target.'; evidence.appendChild(empty);
      } else {
        const table = document.createElement('table'); const head = table.createTHead().insertRow();
        ['Port', 'Protocol', 'Service', 'Banner/version', 'TLS'].forEach((v) => { const th = document.createElement('th'); th.textContent = v; head.appendChild(th); });
        const body = table.createTBody(); target.open_ports.forEach((port) => {
          const row = body.insertRow(); [port.port, port.protocol, port.service, port.banner || '—', port.tls_version || '—'].forEach((v) => { const td = row.insertCell(); td.textContent = v; });
        }); evidence.appendChild(table);
      }
    });
    $('target-evidence').replaceChildren(evidence);
    if (!items.length) { $('findings').textContent = 'No findings were returned.'; return; }
    const table = document.createElement('table');
    const head = table.createTHead().insertRow(); ['Severity', 'Finding', 'CVSS', 'PCI'].forEach((v) => { const th = document.createElement('th'); th.textContent = v; head.appendChild(th); });
    const body = table.createTBody(); items.forEach((item) => {
      const row = body.insertRow(); [item.severity, item.title, item.cvss_score ?? '—', item.pci_fail ? 'Fail' : 'Pass'].forEach((v) => { const td = row.insertCell(); td.textContent = v; });
    }); $('findings').replaceChildren(table);
  }
})();
</script>
</main></body></html>"""
