/* =========================================
   BISTECA Dashboard V2 — Main Application
   ========================================= */

import './style.css';

const API_BASE = '';  // relative — works via Vite proxy (dev) and same-origin (prod)

// State
let apiKey = '';
let isAdmin = false;
let refreshInterval: ReturnType<typeof setInterval> | null = null;

// =========================================
// Auto-refresh
// =========================================
function startAutoRefresh() {
  stopAutoRefresh();
  refreshInterval = setInterval(() => {
    if (document.hidden) return;
    const activePage = document.querySelector('.page.active')?.id;
    if (activePage === 'page-overview') loadOverview();
    if (activePage === 'page-financeiro') {
      const activeSubtab = document.querySelector('.sub-tab.active') as HTMLElement;
      if (activeSubtab?.dataset.subtab === 'saldo') loadSaldoTab();
      if (activeSubtab?.dataset.subtab === 'transacoes') loadTransacoesTab();
    }
  }, 30_000);
}

function stopAutoRefresh() {
  if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = null; }
}

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
    headers: { 'Authorization': apiKey ? `Bearer ${apiKey}` : '', 'Content-Type': 'application/json', ...(opts.headers || {}) },
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
  if (target) target.classList.add('active');

  const nav = $(`.nav-item[data-page="${page}"]`);
  if (nav) nav.classList.add('active');

  if (page === 'overview') loadOverview();
  if (page === 'financeiro') loadFinanceiro();
  if (page === 'reembolsos') loadReembolsos();
  if (page === 'bistecos') loadBistecos();
  if (page === 'settings') loadSettings();
  if (page === 'sandbox') loadSandbox();
}

// =========================================
// Login & Register
// =========================================
function initLogin() {
  const loginForm = $('#login-form') as HTMLFormElement;
  const registerForm = $('#register-form') as HTMLFormElement;
  const tabs = $$('.auth-tab');

  // Tab Switching
  tabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
      e.preventDefault();
      tabs.forEach(t => t.classList.remove('active'));
      $$('.auth-form').forEach(f => f.classList.remove('active'));

      tab.classList.add('active');
      const target = (tab as HTMLElement).dataset.tab;
      $(`#${target}-form`)?.classList.add('active');
    });
  });

  // Login Fix
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = ($('#login-email') as HTMLInputElement).value.trim();
    const password = ($('#login-password') as HTMLInputElement).value.trim();
    const btn = $('#login-btn') as HTMLButtonElement;
    const errorEl = $('#login-error');

    if (!email || !password) return;
    btn.disabled = true;
    errorEl.textContent = '';

    try {
      const res = await fetch(`${API_BASE}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Credenciais inválidas');

      apiKey = data.token;
      isAdmin = data.role === 'admin';
      loginSuccess();

    } catch (err: any) {
      errorEl.textContent = err.message || 'Erro ao conectar';
    } finally { btn.disabled = false; }
  });

  // Register Form
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = ($('#register-name') as HTMLInputElement).value.trim();
    const email = ($('#register-email') as HTMLInputElement).value.trim();
    const password = ($('#register-password') as HTMLInputElement).value.trim();
    const btn = $('#register-btn') as HTMLButtonElement;
    const errorEl = $('#register-error');

    if (!name || !email || !password) return;
    btn.disabled = true;
    errorEl.textContent = '';

    try {
      const res = await fetch(`${API_BASE}/api/v1/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao criar conta');

      apiKey = data.token;
      isAdmin = false; // Registros públicos são sempre merchant

      // Store raw key in RAM for the settings page this one time
      if (data.api_key) {
        window.sessionStorage.setItem('temp_raw_api_key', data.api_key);
      }

      loginSuccess();
      showToast('Conta criada com sucesso! Pela guia Configurações você copia sua chave de integração.', 'success');

    } catch (err: any) {
      errorEl.textContent = err.message || 'Erro ao criar conta';
    } finally { btn.disabled = false; }
  });
}

function loginSuccess() {
  localStorage.setItem('bisteca_api_key', apiKey);
  $('#login-screen').classList.remove('active');
  $('#app-screen').classList.add('active');
  startAutoRefresh();

  const h = new Date().getHours();
  $('#greeting').textContent = `${h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'} 👋`;
  $('#chart-date').textContent = fmtDateShort();

  const bistecosNav = document.querySelector('.nav-item[data-page="bistecos"]') as HTMLElement;
  if (bistecosNav) bistecosNav.style.display = isAdmin ? 'flex' : 'none';

  const sandboxNav = document.querySelector('.nav-item[data-page="sandbox"]') as HTMLElement;
  if (sandboxNav) sandboxNav.style.display = isAdmin ? 'flex' : 'none';

  navigateTo('overview');
}

// =========================================
// OVERVIEW
// =========================================
async function loadOverview() {
  try {
    const url = isAdmin ? '/api/v1/dashboard/stats' : '/api/v1/merchant-dashboard/stats';
    const res = await api(url);
    const { kpis, charts, merchantInfo } = res;

    if (merchantInfo && merchantInfo.name) {
      $('#user-name').textContent = merchantInfo.name;
    }

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

    // Widgets
    const w = res.widgets;
    if (w) {
      const pct = Math.round(w.conversionRate * 100);
      $('#conv-rate').textContent = `${pct}%`;
      const ring = $('#conv-ring-fill') as unknown as SVGCircleElement;
      if (ring) ring.setAttribute('stroke-dashoffset', (264 * (1 - w.conversionRate)).toFixed(1));

      const hp = Math.round(w.healthScore * 100);
      ($('#health-rate') as HTMLElement).textContent = `${(100 - hp).toFixed(1)}%`;
      ($('#health-fill') as HTMLElement).style.width = `${hp}%`;
      ($('#health-status') as HTMLElement).textContent = hp >= 95 ? 'Ótimo' : hp >= 80 ? 'Regular' : 'Crítico';

      const progress = Math.min(1, w.rewardsCentavos / w.rewardsTarget);
      const brl = (w.rewardsCentavos / 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
      const tgt = (w.rewardsTarget / 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
      ($('#rewards-progress') as HTMLElement).textContent = `R$ ${brl} / R$ ${tgt}`;
      ($('#rewards-fill') as HTMLElement).style.width = `${Math.round(progress * 100)}%`;
    }
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
    const url = isAdmin ? '/api/v1/dashboard/payouts' : '/api/v1/merchant-dashboard/payouts';
    const res = await api(url);
    const payouts = res.payouts || [];
    const availableTotal = res.availableBalance || 0;

    // Pré-preencher chave Pix
    if (res.pixKey) {
      ($('#payout-pixkey') as HTMLInputElement).value = res.pixKey;
      ($('#payout-pixtype') as HTMLSelectElement).value = res.pixKeyType || 'RANDOM';
    }

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
    const url = isAdmin ? '/api/v1/dashboard/transactions' : '/api/v1/merchant-dashboard/transactions';
    const res = await api(url);
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
                <td style="font-weight:600; color:${isPayout ? 'var(--danger)' : 'var(--success)'};">
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

  try {
    const res = await api('/api/v1/refunds');
    const refunds = res.refunds || [];

    if (refunds.length === 0) {
      emptyEl.style.display = 'flex';
      return;
    }

    emptyEl.style.display = 'none';
    refunds.forEach((r: any) => {
      const stType = r.status === 'completed' ? 'success' : r.status === 'pending' ? 'warning' : 'danger';
      const stLabel = r.status === 'completed' ? 'concluído' : r.status === 'pending' ? 'pendente' : 'falhou';
      tbody.innerHTML += `
        <tr>
          <td style="color:var(--text-tertiary);font-family:monospace;font-size:11px;">${r.id.substring(0, 12)}...</td>
          <td style="font-family:monospace;font-size:11px;">${r.charge_correlation_id.substring(0, 12)}...</td>
          <td style="color:var(--text-tertiary);">—</td>
          <td style="font-weight:600;color:var(--danger);">- ${fmt(r.value)}</td>
          <td><span class="badge badge-${stType}">${stLabel}</span></td>
          <td style="color:var(--text-tertiary);">${r.comment || '—'}</td>
          <td style="color:var(--text-tertiary);">${fmtDate(r.created_at)}</td>
        </tr>
      `;
    });
  } catch {
    emptyEl.style.display = 'flex';
  }
}

function initRefundForm() {
  const form = $('#refund-form') as HTMLFormElement;
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#refund-submit-btn') as HTMLButtonElement;
    const resultEl = $('#refund-result');
    btn.disabled = true;
    resultEl.textContent = '';
    resultEl.className = 'payout-result';

    const chargeCorrelationId = ($('#refund-charge-id') as HTMLInputElement).value.trim();
    const valueRaw = ($('#refund-value') as HTMLInputElement).value.trim();
    const comment = ($('#refund-comment') as HTMLInputElement).value.trim();

    const body: Record<string, unknown> = { chargeCorrelationId };
    if (valueRaw) body.value = parseInt(valueRaw, 10);
    if (comment) body.comment = comment;

    try {
      const res = await api('/api/v1/refunds', { method: 'POST', body: JSON.stringify(body) });
      resultEl.textContent = `Reembolso processado! ID: ${res.refund.id}`;
      resultEl.classList.add('success');
      showToast('Reembolso concluído com sucesso!', 'success');
      form.reset();
      loadReembolsos();
    } catch (err: any) {
      const msg = err.error || err.message || 'Erro ao processar reembolso';
      resultEl.textContent = msg;
      resultEl.classList.add('error');
      showToast(msg, 'error');
    } finally {
      btn.disabled = false;
    }
  });
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
                <td style="font-weight:600; color:var(--text-primary);">${(m.fee_rate * 100).toFixed(2).replace('.00', '')}%</td>
                <td style="font-family:monospace;font-size:12px;">${m.api_key_prefix}••••••••</td>
                <td style="font-weight:600; color:var(--success);">${fmt(m.balance)}</td>
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
    const feeInput = ($('#new-merchant-fee') as HTMLInputElement).value.trim();
    const feeRate = feeInput ? parseFloat(feeInput) / 100 : 0.05;

    try {
      const res = await api('/api/v1/admin/merchants', {
        method: 'POST',
        body: JSON.stringify({ name, email, feeRate }),
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
  const rawKey = window.sessionStorage.getItem('temp_raw_api_key');

  // URL da API dinâmica
  const apiUrl = `${window.location.origin}/api/v1`;
  const apiUrlEl = $('#settings-apiurl');
  if (apiUrlEl) apiUrlEl.textContent = apiUrl;

  api('/api/v1/auth/me').then(res => {
    const nameEl = $('#settings-name');
    const idEl = $('#settings-merchantid');
    if (nameEl) nameEl.textContent = res.name;
    if (idEl) idEl.textContent = res.id;

    const tokenEl = $('#settings-apikey');
    if (tokenEl) {
      if (rawKey) {
        tokenEl.textContent = rawKey;
        (tokenEl as HTMLElement).style.color = 'var(--success)';
      } else {
        tokenEl.textContent = `${res.api_key_prefix}••••••••••••••••••••••••••••••`;
      }
    }
  }).catch(() => {
    const nameEl = $('#settings-name');
    if (nameEl) nameEl.textContent = 'Erro ao carregar';
  });

  // Carrega configurações atuais (webhook_url e pix_key) do /me extendido
  api('/api/v1/merchant-dashboard/stats').then(res => {
    if (res.merchantInfo) {
      const webhookEl = $('#settings-webhook-url') as HTMLInputElement;
      const pixkeyEl = $('#settings-pixkey') as HTMLInputElement;
      const pixtypeEl = $('#settings-pixtype') as HTMLSelectElement;
      if (webhookEl && res.merchantInfo.webhook_url) webhookEl.value = res.merchantInfo.webhook_url;
      if (pixkeyEl && res.merchantInfo.pix_key) pixkeyEl.value = res.merchantInfo.pix_key;
      if (pixtypeEl && res.merchantInfo.pix_key_type) pixtypeEl.value = res.merchantInfo.pix_key_type;
    }
  }).catch(() => {});
}

function initSettingsForm() {
  const form = $('#settings-form') as HTMLFormElement;
  if (!form) return;

  // Botão copiar API key
  const copyBtn = $('#copy-apikey-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const keyEl = $('#settings-apikey');
      const text = keyEl?.textContent || '';
      if (text && !text.includes('•')) {
        navigator.clipboard.writeText(text).then(() => showToast('Chave copiada!', 'success')).catch(() => {
          // fallback
          const ta = document.createElement('textarea');
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
          showToast('Chave copiada!', 'success');
        });
      } else {
        showToast('Chave completa não disponível. Ela só é exibida no momento do cadastro.', 'error');
      }
    });
  }

  // Botão regenerar chave com dupla confirmação
  const regenBtn = $('#regen-apikey-btn') as HTMLButtonElement;
  const regenWarning = $('#regen-warning');
  let regenPending = false;

  if (regenBtn) {
    regenBtn.addEventListener('click', async () => {
      if (!regenPending) {
        regenPending = true;
        regenBtn.textContent = 'Confirmar geração';
        regenBtn.style.background = 'rgba(239,68,68,0.15)';
        if (regenWarning) regenWarning.style.display = 'block';
        // Cancela a confirmação após 8s sem ação
        setTimeout(() => {
          if (regenPending) {
            regenPending = false;
            regenBtn.textContent = 'Gerar nova chave';
            regenBtn.style.background = '';
            if (regenWarning) regenWarning.style.display = 'none';
          }
        }, 8000);
        return;
      }

      // Segunda confirmação: executa
      regenPending = false;
      regenBtn.disabled = true;
      regenBtn.textContent = 'Gerando...';

      try {
        const res = await api('/api/v1/merchant-dashboard/regenerate-key', { method: 'POST' });
        window.sessionStorage.setItem('temp_raw_api_key', res.api_key);

        const tokenEl = $('#settings-apikey');
        if (tokenEl) {
          tokenEl.textContent = res.api_key;
          (tokenEl as HTMLElement).style.color = 'var(--success)';
        }
        if (regenWarning) regenWarning.style.display = 'none';
        regenBtn.textContent = 'Chave gerada!';
        regenBtn.style.background = '';
        showToast('Nova chave gerada! Salve agora.', 'success');
      } catch (err: any) {
        showToast(err.error || 'Erro ao gerar chave', 'error');
        regenBtn.textContent = 'Gerar nova chave';
        regenBtn.style.background = '';
        regenBtn.disabled = false;
      }
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#settings-save-btn') as HTMLButtonElement;
    const resultEl = $('#settings-result');
    btn.disabled = true;
    resultEl.textContent = '';
    resultEl.className = 'payout-result';

    const webhook_url = ($('#settings-webhook-url') as HTMLInputElement).value.trim();
    const pix_key = ($('#settings-pixkey') as HTMLInputElement).value.trim();
    const pix_key_type = ($('#settings-pixtype') as HTMLSelectElement).value;

    try {
      await api('/api/v1/merchant-dashboard/settings', {
        method: 'PATCH',
        body: JSON.stringify({ webhook_url: webhook_url || null, pix_key: pix_key || null, pix_key_type }),
      });
      resultEl.textContent = 'Configurações salvas!';
      resultEl.classList.add('success');
      showToast('Configurações salvas com sucesso!', 'success');
    } catch (err: any) {
      const msg = err.error || err.message || 'Erro ao salvar';
      resultEl.textContent = msg;
      resultEl.classList.add('error');
    } finally {
      btn.disabled = false;
    }
  });
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
// Sandbox
// =========================================
let sandboxCorrelationId: string | null = null;

async function loadSandbox() {
  try {
    const res = await api('/api/v1/sandbox/merchant');
    const logEl = $('#sandbox-log');
    if (logEl && logEl.children.length === 1) {
      logEl.innerHTML = `<span style="color:var(--text-secondary);">Merchant sandbox: <b>${res.name}</b> | Saldo: ${fmt(res.balance)}</span>`;
    }
  } catch (err) {
    console.error('Sandbox merchant error', err);
  }
}

function sandboxAddLog(msg: string, type: 'info' | 'ok' | 'error' = 'info') {
  const logEl = $('#sandbox-log');
  if (!logEl) return;
  const colors: Record<string, string> = { info: 'var(--text-secondary)', ok: 'var(--success)', error: 'var(--danger)' };
  const entry = document.createElement('span');
  entry.style.color = colors[type];
  entry.textContent = `[${new Date().toLocaleTimeString('pt-BR')}] ${msg}`;
  logEl.appendChild(entry);
  logEl.scrollTop = logEl.scrollHeight;
}

function initSandboxForm() {
  const chargeForm = $('#sandbox-charge-form') as HTMLFormElement;
  if (!chargeForm) return;

  chargeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#sandbox-charge-btn') as HTMLButtonElement;
    const resultEl = $('#sandbox-charge-result');
    btn.disabled = true;
    resultEl.textContent = '';
    resultEl.className = 'payout-result';

    const value = parseInt(($('#sandbox-value') as HTMLInputElement).value);

    // Clear previous QR
    sandboxCorrelationId = null;
    ($('#sandbox-qr-card') as HTMLElement).style.display = 'none';

    try {
      const res = await api('/api/v1/sandbox/charge', {
        method: 'POST',
        body: JSON.stringify({ value }),
      });

      sandboxCorrelationId = res.correlationId;
      sandboxAddLog(`✅ Cobrança criada: R$ ${(res.value / 100).toFixed(2)} | ID: ${res.correlationId}`, 'ok');

      if (res.qrCode) ($('#sandbox-qr-img') as HTMLImageElement).src = res.qrCode;
      if (res.pixCode) ($('#sandbox-pix-code') as HTMLInputElement).value = res.pixCode;

      ($('#sandbox-qr-card') as HTMLElement).style.display = '';
      resultEl.textContent = 'Cobrança criada. Escaneie o QR ou clique em Simular Pagamento.';
      resultEl.classList.add('success');
    } catch (err: any) {
      const msg = err.error || err.message || 'Erro ao criar cobrança';
      resultEl.textContent = msg;
      resultEl.classList.add('error');
      sandboxAddLog(`❌ Erro: ${msg}`, 'error');
    } finally { btn.disabled = false; }
  });

  // Simular pagamento
  const simulateBtn = $('#sandbox-simulate-btn');
  if (simulateBtn) {
    simulateBtn.addEventListener('click', async () => {
      if (!sandboxCorrelationId) return;
      (simulateBtn as HTMLButtonElement).disabled = true;
      sandboxAddLog('⏳ Simulando pagamento...', 'info');
      try {
        await api('/api/v1/sandbox/simulate-payment', {
          method: 'POST',
          body: JSON.stringify({ correlationId: sandboxCorrelationId }),
        });
        sandboxAddLog('✅ Pagamento simulado → ledger atualizado', 'ok');
        sandboxAddLog('📤 Webhook enfileirado para merchant sandbox', 'ok');
        showToast('Pagamento simulado com sucesso!', 'success');
      } catch (err: any) {
        const msg = err.error || err.message || 'Erro ao simular';
        sandboxAddLog(`❌ ${msg}`, 'error');
      } finally { (simulateBtn as HTMLButtonElement).disabled = false; }
    });
  }

  // Copiar PIX
  const copyBtn = $('#sandbox-copy-pix');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const code = ($('#sandbox-pix-code') as HTMLInputElement).value;
      if (code) navigator.clipboard.writeText(code).then(() => showToast('PIX copiado!', 'success'));
    });
  }

  // Limpar log
  const clearBtn = $('#sandbox-clear-log');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      const logEl = $('#sandbox-log');
      if (logEl) logEl.innerHTML = '<span style="color:var(--text-secondary);">Log limpo.</span>';
    });
  }
}

// =========================================
// Telegram Settings
// =========================================
function initTelegramForm() {
  const form = $('#telegram-form') as HTMLFormElement;
  if (!form) return;

  // Carregar configurações atuais
  api('/api/v1/admin/settings').then(res => {
    if (res.telegram_chat_id) ($('#telegram-chatid') as HTMLInputElement).value = res.telegram_chat_id;
    // Token mascarado, não pré-preenchemos
  }).catch(() => {});

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const resultEl = $('#telegram-result');
    resultEl.textContent = '';
    resultEl.className = 'payout-result';

    const token = ($('#telegram-token') as HTMLInputElement).value.trim();
    const chatId = ($('#telegram-chatid') as HTMLInputElement).value.trim();

    if (!token || !chatId) {
      resultEl.textContent = 'Preencha o Bot Token e o Chat ID';
      resultEl.classList.add('error');
      return;
    }

    try {
      await api('/api/v1/admin/settings', {
        method: 'PATCH',
        body: JSON.stringify({ telegram_bot_token: token, telegram_chat_id: chatId }),
      });
      resultEl.textContent = 'Configurações salvas!';
      resultEl.classList.add('success');
      showToast('Telegram configurado!', 'success');
    } catch (err: any) {
      resultEl.textContent = err.error || 'Erro ao salvar';
      resultEl.classList.add('error');
    }
  });

  const testBtn = $('#telegram-test-btn');
  if (testBtn) {
    testBtn.addEventListener('click', async () => {
      const resultEl = $('#telegram-result');
      resultEl.textContent = '';
      resultEl.className = 'payout-result';
      (testBtn as HTMLButtonElement).disabled = true;
      try {
        await api('/api/v1/admin/settings/test-telegram', { method: 'POST' });
        resultEl.textContent = 'Mensagem enviada! Verifique seu Telegram.';
        resultEl.classList.add('success');
      } catch (err: any) {
        resultEl.textContent = err.error || 'Erro ao enviar mensagem de teste';
        resultEl.classList.add('error');
      } finally { (testBtn as HTMLButtonElement).disabled = false; }
    });
  }
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
  initSettingsForm();
  initRefundForm();
  initSandboxForm();
  initTelegramForm();

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
    window.sessionStorage.removeItem('temp_raw_api_key');
    apiKey = '';
    isAdmin = false;
    stopAutoRefresh();
    $('#app-screen').classList.remove('active');
    $('#login-screen').classList.add('active');
  });

  // Auto-login: verify token
  const saved = localStorage.getItem('bisteca_api_key');
  if (saved) {
    apiKey = saved;
    try {
      const check = await fetch(`${API_BASE}/api/v1/auth/me`, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      const data = await check.json();
      if (check.ok) {
        isAdmin = data.role === 'admin';
        loginSuccess();
      } else {
        throw new Error('Token inválido');
      }
    } catch (err) {
      localStorage.removeItem('bisteca_api_key');
      apiKey = '';
    }
  }

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


