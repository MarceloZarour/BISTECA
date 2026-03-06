/* =========================================
   BISTECA Dashboard V2 — Main Application
   ========================================= */

import './style.css';

const API_BASE = '';  // relative — works via Vite proxy (dev) and same-origin (prod)

// State
let apiKey = '';

// DOM
const $ = (sel: string) => document.querySelector(sel) as HTMLElement;
const $$ = (sel: string) => document.querySelectorAll(sel);

// =========================================
// Toast
// =========================================
function showToast(msg: string, type: 'success' | 'error' = 'success') {
  let c = $('.toast-container');
  if (!c) { c = document.createElement('div'); c.className = 'toast-container'; document.body.appendChild(c); }
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => { t.style.animation = 'toastOut 0.3s ease forwards'; setTimeout(() => t.remove(), 300); }, 3500);
}

// =========================================
// API
// =========================================
async function api(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { 'Authorization': apiKey, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const data = await res.json();
  if (!res.ok) throw { status: res.status, ...data };
  return data;
}

// =========================================
// Formatters
// =========================================
function fmt(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function fmtDateShort(d?: string): string {
  return (d ? new Date(d) : new Date()).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// =========================================
// Router
// =========================================
function navigateTo(page: string) {
  $$('.page').forEach(el => el.classList.remove('active'));
  $$('.nav-item').forEach(el => el.classList.remove('active'));

  const target = $(`#page-${page}`);
  if (target) { target.classList.remove('active'); void target.offsetWidth; target.classList.add('active'); }

  const nav = $(`.nav-item[data-page="${page}"]`);
  if (nav) nav.classList.add('active');

  if (page === 'overview') loadOverview();
  if (page === 'financeiro') loadFinanceiro();
  if (page === 'reembolsos') loadReembolsos();
  if (page === 'bistecos') loadBistecos();
  if (page === 'settings') loadSettings();
}

// =========================================
// Login
// =========================================
function initLogin() {
  const form = $('#login-form') as HTMLFormElement;
  const input = $('#api-key-input') as HTMLInputElement;
  const errorEl = $('#login-error');
  const btn = $('#login-btn') as HTMLButtonElement;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const key = input.value.trim();
    if (!key) return;
    btn.disabled = true;
    errorEl.textContent = '';

    try {
      apiKey = key;
      await api('/api/v1/charges/ping-' + Date.now());
      loginSuccess();
    } catch (err: any) {
      if (err.status === 401 || err.status === 403) {
        errorEl.textContent = 'Chave de API inválida';
        apiKey = '';
      } else {
        loginSuccess();
      }
    } finally { btn.disabled = false; }
  });
}

function loginSuccess() {
  localStorage.setItem('bisteca_api_key', apiKey);
  $('#login-screen').classList.remove('active');
  $('#app-screen').classList.add('active');

  const h = new Date().getHours();
  $('#greeting').textContent = `${h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'} 👋`;
  $('#chart-date').textContent = fmtDateShort();

  navigateTo('overview');
}

// =========================================
// OVERVIEW
// =========================================
async function loadOverview() {
  try {
    const res = await api('/api/v1/dashboard/stats');
    const { kpis, charts } = res;

    // Update KPI cards
    $('#kpi-vendas').textContent = fmt(kpis.vendas);
    $('#kpi-ticket').textContent = fmt(kpis.ticket);
    $('#kpi-pix-pagos').textContent = kpis.pixPagos.toString();
    $('#kpi-vendas-hoje').textContent = fmt(kpis.vendasHoje);

    // Update Deltas
    setDelta('kpi-vendas-delta', kpis.deltas.vendas);
    setDelta('kpi-ticket-delta', kpis.deltas.ticket);
    setDelta('kpi-pix-delta', kpis.deltas.pixPagos);
    setDelta('kpi-hoje-delta', kpis.deltas.vendasHoje);

    // Render Charts
    renderRevenueChart(charts.weekSales);
    renderWeekChart('week-sales-chart', charts.weekSales);
    renderWeekChart('week-ticket-chart', charts.weekTicket);
  } catch (err) {
    console.error('Failed to load stats', err);
  }
}

function setDelta(id: string, value: number) {
  const el = $(`#${id}`);
  if (!el) return;
  const isPositive = value >= 0;
  el.className = `kpi-delta ${isPositive ? 'positive' : 'negative'}`;
  el.textContent = `${isPositive ? '+' : ''}${value.toFixed(1)}% vs mês ant/média`;
}

// =========================================
// Revenue Chart (Canvas)
// =========================================
function renderRevenueChart(dynamicData?: number[]) {
  const canvas = document.getElementById('revenue-chart') as HTMLCanvasElement;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const w = rect.width, h = rect.height;
  const pad = { top: 16, right: 16, bottom: 32, left: 52 };

  const labels = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
  const data = dynamicData && dynamicData.length === 7 ? dynamicData : [0, 0, 0, 0, 0, 0, 0];
  const total = data.reduce((a, b) => a + b, 0);

  const chartTotalEl = $('#chart-total');
  if (chartTotalEl) chartTotalEl.textContent = fmt(total);

  const max = Math.max(...data, 100) * 1.15; // fallback max 100 centavos minimum
  const cw = w - pad.left - pad.right;
  const ch = h - pad.top - pad.bottom;

  // Grid
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (ch / 4) * i;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(w - pad.right, y); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.font = '10px Inter';
    ctx.textAlign = 'right';
    ctx.fillText(fmt(Math.round(max - (max / 4) * i)), pad.left - 8, y + 3);
  }

  // X labels
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.font = '10px Inter';
  ctx.textAlign = 'center';
  labels.forEach((l, i) => {
    const x = pad.left + (cw / (labels.length - 1)) * i;
    ctx.fillText(l, x, h - pad.bottom + 18);
  });

  // Line
  const pts: [number, number][] = data.map((v, i) => [
    pad.left + (cw / (data.length - 1)) * i,
    pad.top + ch - (v / max) * ch,
  ]);

  // Gradient fill
  const grad = ctx.createLinearGradient(0, pad.top, 0, h - pad.bottom);
  grad.addColorStop(0, 'rgba(139, 92, 246, 0.1)');
  grad.addColorStop(1, 'rgba(139, 92, 246, 0)');

  ctx.beginPath();
  ctx.moveTo(pts[0][0], h - pad.bottom);
  smoothCurve(ctx, pts);
  ctx.lineTo(pts[pts.length - 1][0], h - pad.bottom);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Stroke
  const lg = ctx.createLinearGradient(0, 0, w, 0);
  lg.addColorStop(0, '#8B5CF6');
  lg.addColorStop(1, '#3B82F6');
  ctx.beginPath();
  smoothCurve(ctx, pts);
  ctx.strokeStyle = lg;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.stroke();

  // Dots
  pts.forEach(([x, y], i) => {
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fillStyle = i === pts.length - 1 ? '#8B5CF6' : 'rgba(139, 92, 246, 0.5)';
    ctx.fill();
  });
}

function renderWeekChart(canvasId: string, dynamicData?: number[]) {
  const canvas = document.getElementById(canvasId) as HTMLCanvasElement;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const w = rect.width, h = rect.height;
  const pad = { top: 10, right: 10, bottom: 28, left: 10 };

  const labels = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
  const data = dynamicData && dynamicData.length === 7 ? dynamicData : [0, 0, 0, 0, 0, 0, 0];
  const max = Math.max(...data, 100);
  const barW = ((w - pad.left - pad.right) / labels.length) * 0.6;
  const gap = ((w - pad.left - pad.right) / labels.length);

  // Update Summary labels
  const sum = data.reduce((a, b) => a + b, 0);
  const avg = Math.round(sum / 7);
  const summaryEl = $(`#${canvasId.replace('-chart', '-summary')}`);
  if (summaryEl) {
    summaryEl.textContent = `Total da semana: ${fmt(sum)} • Média diária: ${fmt(avg)}`;
  }

  labels.forEach((l, i) => {
    const x = pad.left + gap * i + gap / 2 - barW / 2;
    const barH = (data[i] / max) * (h - pad.top - pad.bottom);
    const y = h - pad.bottom - barH;

    // Bar
    const barGrad = ctx.createLinearGradient(x, y, x, h - pad.bottom);
    barGrad.addColorStop(0, 'rgba(139, 92, 246, 0.3)');
    barGrad.addColorStop(1, 'rgba(139, 92, 246, 0.05)');

    ctx.beginPath();
    roundRect(ctx, x, y, barW, barH, 4);
    ctx.fillStyle = barGrad;
    ctx.fill();

    // Label
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.font = '10px Inter';
    ctx.textAlign = 'center';
    ctx.fillText(l, pad.left + gap * i + gap / 2, h - pad.bottom + 16);
  });
}

function smoothCurve(ctx: CanvasRenderingContext2D, pts: [number, number][]) {
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 0; i < pts.length - 1; i++) {
    const cx = (pts[i][0] + pts[i + 1][0]) / 2;
    ctx.bezierCurveTo(cx, pts[i][1], cx, pts[i + 1][1], pts[i + 1][0], pts[i + 1][1]);
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  if (h <= 0) { h = 1; }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// =========================================
// FINANCEIRO
// =========================================
function loadFinanceiro() {
  loadSaldoTab();
}

async function loadSaldoTab() {
  try {
    const res = await api('/api/v1/dashboard/payouts');
    const payouts = res.payouts || [];
    const availableTotal = res.availableBalance || 0;

    const pending = payouts.filter((p: any) => p.status === 'requested' || p.status === 'processing');
    const pendingTotal = pending.reduce((s: number, p: any) => s + p.amount, 0);

    $('#fin-available').textContent = fmt(availableTotal);
    $('#fin-pending').textContent = fmt(pendingTotal);
    $('#fin-blocked').textContent = fmt(0);

    const histContainer = $('#payout-history');
    const emptyEl = $('#payout-empty');
    histContainer.innerHTML = '';

    if (payouts.length > 0) {
      emptyEl.style.display = 'none';
      payouts.forEach((p: any) => { histContainer.innerHTML += renderPayoutItem(p); });
    } else {
      emptyEl.style.display = 'flex';
    }
  } catch (e) {
    $('#payout-empty').style.display = 'flex';
  }
}

function renderPayoutItem(p: any): string {
  const sc = p.status === 'completed' ? 'completed' : (p.status === 'requested' || p.status === 'processing') ? 'pending' : 'failed';
  const sl = p.status === 'completed' ? 'efetivado' : (p.status === 'requested' || p.status === 'processing') ? 'pendente' : 'falhou';
  const icons: Record<string, string> = {
    completed: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>',
    pending: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>',
    failed: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>',
  };

  return `<div class="tx-item">
        <div class="tx-left">
            <div class="tx-icon ${sc}">${icons[sc] || icons.pending}</div>
            <div class="tx-info">
                <span class="tx-id">${p.pix_key || p.id}</span>
                <span class="tx-date">${fmtDate(p.created_at)}</span>
            </div>
        </div>
        <div class="tx-right">
            <span class="tx-amount">${fmt(p.amount)}</span>
            <span class="tx-status ${sc}">${sl}</span>
        </div>
    </div>`;
}

// =========================================
// Transações Tab
// =========================================
async function loadTransacoesTab() {
  const tbody = $('#tx-tbody');
  const emptyEl = $('#tx-empty');
  tbody.innerHTML = '';

  try {
    const res = await api('/api/v1/dashboard/transactions');
    const txs = res.transactions || [];

    if (txs.length === 0) {
      emptyEl.style.display = 'flex';
      return;
    }

    emptyEl.style.display = 'none';
    txs.forEach((tx: any) => {
      const isPayout = tx.type === 'payout';
      const stType = tx.status === 'paid' || tx.status === 'completed' ? 'success' : tx.status === 'pending' || tx.status === 'requested' ? 'warning' : 'danger';

      tbody.innerHTML += `
            <tr>
                <td style="color:var(--text-tertiary);font-family:monospace;font-size:11px;">${tx.correlation_id.substring(0, 12)}...</td>
                <td>${isPayout ? 'Saque (Bisteco)' : 'Cobrança Pix'}</td>
                <td style="color:var(--text-tertiary);">${isPayout ? '---' : 'Consumidor'}</td>
                <td style="font-weight:600; color:${isPayout ? 'var(--danger-color)' : 'var(--success-color)'};">
                    ${isPayout ? '-' : '+'} ${fmt(tx.amount)}
                </td>
                <td><span class="badge badge-${stType}">${tx.status}</span></td>
                <td style="color:var(--text-tertiary);">${fmtDate(tx.created_at)}</td>
            </tr>
        `;
    });
  } catch (e) {
    emptyEl.style.display = 'flex';
  }
}

// =========================================
// REEMBOLSOS
// =========================================
async function loadReembolsos() {
  const tbody = $('#refund-tbody');
  const emptyEl = $('#refund-empty');
  tbody.innerHTML = '';

  // Placeholder — real data would come from API
  emptyEl.style.display = 'flex';
}

// =========================================
// BISTECOS (ADMIN)
// =========================================
async function loadBistecos() {
  const tbody = $('#merchants-tbody');
  const emptyEl = $('#merchants-empty');
  tbody.innerHTML = '';

  try {
    const res = await api('/api/v1/admin/merchants');
    const merchants = res.merchants || [];

    if (merchants.length === 0) {
      emptyEl.style.display = 'flex';
      emptyEl.innerHTML = '<p>Nenhum lojista cadastrado ainda.</p>';
      return;
    }

    emptyEl.style.display = 'none';
    merchants.forEach((m: any) => {
      tbody.innerHTML += `
            <tr>
                <td style="font-weight:600;">${m.name}</td>
                <td style="color:var(--text-tertiary);">${m.email}</td>
                <td style="font-family:monospace;font-size:12px;">${m.api_key_prefix}••••••••</td>
                <td style="font-weight:600; color:var(--success-color);">${fmt(m.balance)}</td>
                <td style="color:var(--text-tertiary);">${fmtDateShort(m.created_at)}</td>
            </tr>
        `;
    });
  } catch (e) {
    emptyEl.style.display = 'flex';
    emptyEl.innerHTML = '<p>Erro ao carregar lojistas.</p>';
  }
}

function initMerchantForm() {
  const form = $('#merchant-form') as HTMLFormElement;
  const resultEl = $('#merchant-result');
  const apikeyBox = $('#new-apikey-box');
  const apikeyDisplay = $('#raw-apikey-display');

  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#merchant-submit-btn') as HTMLButtonElement;
    btn.disabled = true;
    resultEl.textContent = '';
    resultEl.className = 'payout-result';
    apikeyBox.style.display = 'none';

    const name = ($('#new-merchant-name') as HTMLInputElement).value.trim();
    const email = ($('#new-merchant-email') as HTMLInputElement).value.trim();

    try {
      const res = await api('/api/v1/admin/merchants', {
        method: 'POST',
        body: JSON.stringify({ name, email }),
      });

      resultEl.textContent = `${res.merchant.name} cadastrado com sucesso!`;
      resultEl.classList.add('success');
      showToast('Lojista criado!', 'success');

      // Mostrar a chave raw, ela só vai aparecer AGORA.
      apikeyDisplay.textContent = res.api_key;
      apikeyBox.style.display = 'block';

      // Recarregar lista
      loadBistecos();

      // Limpar formulário
      form.reset();

    } catch (err: any) {
      const msg = err.error || err.message || 'Erro ao criar lojista';
      resultEl.textContent = msg;
      resultEl.classList.add('error');
      showToast(msg, 'error');
    } finally {
      btn.disabled = false;
    }
  });
}

// =========================================
// SETTINGS
// =========================================
function loadSettings() {
  $('#settings-apikey').textContent = apiKey.substring(0, 12) + '••••••••••••';
  $('#settings-merchantid').textContent = '—';
  $('#settings-name').textContent = 'Bisteco';
}

// =========================================
// Payout Form
// =========================================
function initPayoutForm() {
  const form = $('#payout-form') as HTMLFormElement;
  const resultEl = $('#payout-result');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#payout-submit-btn') as HTMLButtonElement;
    btn.disabled = true;
    resultEl.textContent = '';
    resultEl.className = 'payout-result';

    const amount = parseInt(($('#payout-amount') as HTMLInputElement).value);
    const pixKey = ($('#payout-pixkey') as HTMLInputElement).value.trim();
    const pixKeyType = ($('#payout-pixtype') as HTMLSelectElement).value;

    if (!amount || amount < 100) {
      resultEl.textContent = 'Valor mínimo: R$ 1,00 (100 centavos)';
      resultEl.classList.add('error');
      btn.disabled = false;
      return;
    }

    if (!pixKey) {
      resultEl.textContent = 'Informe a chave Pix de destino';
      resultEl.classList.add('error');
      btn.disabled = false;
      return;
    }

    try {
      const res = await api('/api/v1/payouts', {
        method: 'POST',
        body: JSON.stringify({ amount, pixKey, pixKeyType }),
      });

      resultEl.textContent = `Saque solicitado! ID: ${res.payoutId}`;
      resultEl.classList.add('success');
      showToast('Saque solicitado com sucesso!', 'success');
      setTimeout(() => loadSaldoTab(), 1000);
    } catch (err: any) {
      const msg = err.error || err.message || 'Erro ao solicitar saque';
      resultEl.textContent = msg;
      resultEl.classList.add('error');
      showToast(msg, 'error');
    } finally { btn.disabled = false; }
  });
}

// =========================================
// Sub-tab Navigation
// =========================================
function initSubTabs() {
  $$('.sub-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const target = (tab as HTMLElement).dataset.subtab;
      if (!target) return;

      $$('.sub-tab').forEach(t => t.classList.remove('active'));
      $$('.subtab-content').forEach(c => c.classList.remove('active'));

      tab.classList.add('active');
      const content = $(`#subtab-${target}`);
      if (content) { content.classList.remove('active'); void content.offsetWidth; content.classList.add('active'); }

      if (target === 'saldo') loadSaldoTab();
      if (target === 'transacoes') loadTransacoesTab();
    });
  });
}

// =========================================
// Init
// =========================================
async function init() {
  initLogin();
  initPayoutForm();
  initSubTabs();
  initMerchantForm();

  // Main nav
  $$('.nav-item[data-page]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const page = (el as HTMLElement).dataset.page;
      if (page) navigateTo(page);
    });
  });

  // Logout
  $('#logout-btn').addEventListener('click', () => {
    localStorage.removeItem('bisteca_api_key');
    apiKey = '';
    $('#app-screen').classList.remove('active');
    $('#login-screen').classList.add('active');
    ($('#api-key-input') as HTMLInputElement).value = '';
  });

  // Auto-login: try server config first, then localStorage
  try {
    const res = await fetch(`${API_BASE}/api/v1/dashboard/config`);
    const data = await res.json();
    if (data.apiKey) {
      apiKey = data.apiKey;
      loginSuccess();
      return;
    }
  } catch (_) { /* server config not available */ }

  // Fallback: saved session
  const saved = localStorage.getItem('bisteca_api_key');
  if (saved) { apiKey = saved; loginSuccess(); }

  // Resize
  window.addEventListener('resize', () => {
    if ($('.page.active')?.id === 'page-overview') {
      renderRevenueChart();
      renderWeekChart('week-sales-chart');
      renderWeekChart('week-ticket-chart');
    }
  });
}

document.addEventListener('DOMContentLoaded', init);


