// RefundIQ Frontend Application Logic

let currentCustomerId = 'CUST101';
let currentOrders = [];
let selectedOrder = null;
let currentTrackingId = null;
let pollInterval = null;
let activeReviewDisputeId = null;

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  loadOrders();
  loadCustomerDisputes();
  loadReviewQueue();
  setInterval(loadReviewQueue, 10000); // Check queue every 10s
});

// Switch between Customer Portal, Reviewer Cockpit, and Audit views
function switchView(viewName) {
  const customerView = document.getElementById('customerView');
  const reviewerView = document.getElementById('reviewerView');
  const auditView = document.getElementById('auditView');

  const tabCustomer = document.getElementById('tabBtnCustomer');
  const tabReviewer = document.getElementById('tabBtnReviewer');
  const tabAudit = document.getElementById('tabBtnAudit');

  // Reset classes
  [tabCustomer, tabReviewer, tabAudit].forEach((btn) => {
    btn.className = 'px-4 py-1.5 rounded-lg text-sm font-medium transition text-slate-300 hover:text-white relative';
  });

  customerView.classList.add('hidden');
  reviewerView.classList.add('hidden');
  auditView.classList.add('hidden');

  if (viewName === 'customer') {
    customerView.classList.remove('hidden');
    tabCustomer.className = 'px-4 py-1.5 rounded-lg text-sm font-medium transition bg-amber-500 text-slate-950 shadow';
    loadCustomerDisputes();
  } else if (viewName === 'reviewer') {
    reviewerView.classList.remove('hidden');
    tabReviewer.className = 'px-4 py-1.5 rounded-lg text-sm font-medium transition bg-amber-500 text-slate-950 shadow relative';
    loadReviewQueue();
  } else if (viewName === 'audit') {
    auditView.classList.remove('hidden');
    tabAudit.className = 'px-4 py-1.5 rounded-lg text-sm font-medium transition bg-amber-500 text-slate-950 shadow';
    loadGlobalAuditLogs();
  }
}

// Change logged-in customer persona
function changeCustomer(newCustomerId) {
  currentCustomerId = newCustomerId;
  selectedOrder = null;
  document.getElementById('selectedOrderId').value = '';
  document.getElementById('selectedOrderBadge').innerText = 'No Order Selected';
  document.getElementById('itemsCheckboxes').innerHTML = 'Select an order on the left to see itemized bill.';
  loadOrders();
  loadCustomerDisputes();
}

// 1. Load Authoritative Orders for Active Customer (GET /api/orders)
async function loadOrders() {
  const container = document.getElementById('ordersList');
  container.innerHTML = '<div class="p-8 text-center text-slate-400">Loading orders...</div>';

  try {
    const res = await fetch('/api/orders', {
      headers: { 'x-customer-id': currentCustomerId },
    });
    const data = await res.json();

    if (!data.success || !data.orders || data.orders.length === 0) {
      container.innerHTML = '<div class="p-8 text-center text-slate-400">No orders found for this customer.</div>';
      return;
    }

    currentOrders = data.orders;
    renderOrdersList(data.orders);
  } catch (err) {
    container.innerHTML = `<div class="p-4 bg-red-50 text-red-700 text-xs rounded-xl">Error loading orders: ${err.message}</div>`;
  }
}

// Render Orders List Cards
function renderOrdersList(orders) {
  const container = document.getElementById('ordersList');
  container.innerHTML = '';

  orders.forEach((order) => {
    const isSelected = selectedOrder && selectedOrder.order_id === order.order_id;
    const card = document.createElement('div');
    card.className = `p-4 rounded-xl border transition cursor-pointer ${
      isSelected
        ? 'border-amber-500 bg-amber-50/40 ring-2 ring-amber-500/20'
        : 'border-slate-200 bg-white hover:border-slate-300'
    }`;
    card.onclick = () => selectOrder(order.order_id);

    const itemsSummary = order.items.map((i) => `${i.quantity}x ${i.name}`).join(', ');

    card.innerHTML = `
      <div class="flex items-start justify-between">
        <div>
          <span class="text-xs font-bold text-slate-900 block">${order.order_id}</span>
          <span class="text-sm font-semibold text-slate-800">${order.restaurant_name}</span>
        </div>
        <div class="text-right">
          <span class="text-sm font-bold text-slate-900">₹${Number(order.total_amount).toFixed(2)}</span>
          <span class="block text-xs text-emerald-600 font-medium">${order.order_status}</span>
        </div>
      </div>
      <p class="text-xs text-slate-500 mt-2 truncate">${itemsSummary}</p>
      <div class="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
        <span>${new Date(order.order_timestamp).toLocaleDateString()}</span>
        ${
          order.refund_status !== 'NONE'
            ? `<span class="text-red-500 font-bold">Refunded: ₹${order.previous_refund_amount}</span>`
            : '<span class="text-slate-400">Paid • Delivered</span>'
        }
      </div>
    `;

    container.appendChild(card);
  });
}

// Select an order and bind read-only details
function selectOrder(orderId) {
  selectedOrder = currentOrders.find((o) => o.order_id === orderId);
  if (!selectedOrder) return;

  renderOrdersList(currentOrders);

  document.getElementById('selectedOrderId').value = selectedOrder.order_id;
  document.getElementById('selectedOrderBadge').innerHTML = `
    <span class="text-amber-800 font-bold">${selectedOrder.order_id}</span> (${selectedOrder.restaurant_name} - ₹${selectedOrder.total_amount})
  `;

  // Render Item Checkboxes
  const itemsContainer = document.getElementById('itemsCheckboxes');
  itemsContainer.innerHTML = '';

  selectedOrder.items.forEach((item, idx) => {
    const label = document.createElement('label');
    label.className = 'flex items-center justify-between p-2 rounded-lg hover:bg-white border border-transparent hover:border-slate-200 cursor-pointer transition';
    label.innerHTML = `
      <div class="flex items-center space-x-2">
        <input type="checkbox" name="affected_item" value="${item.name}" ${idx === 0 ? 'checked' : ''} class="rounded text-amber-500 focus:ring-amber-500">
        <span class="text-xs font-medium text-slate-800">${item.quantity}x ${item.name}</span>
      </div>
      <span class="text-xs font-bold text-slate-600">₹${Number(item.price_per_unit).toFixed(2)} ea</span>
    `;
    itemsContainer.appendChild(label);
  });
}

// Submit Dispute Form (POST /api/refunds)
async function submitDispute(event) {
  event.preventDefault();

  if (!selectedOrder) {
    alert('Please select an order from the list on the left first.');
    return;
  }

  const selectedItemCheckboxes = Array.from(document.querySelectorAll('input[name="affected_item"]:checked')).map(
    (cb) => cb.value
  );

  if (selectedItemCheckboxes.length === 0) {
    alert('Please select at least one affected food item from the list.');
    return;
  }

  const submitBtn = document.getElementById('submitDisputeBtn');
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Enqueuing Dispute...';

  try {
    const formData = new FormData();
    formData.append('order_id', selectedOrder.order_id);
    formData.append('issue_category', document.getElementById('issueCategory').value);
    formData.append('affected_items', JSON.stringify(selectedItemCheckboxes));
    formData.append('description', document.getElementById('disputeDescription').value);
    
    const resolution = document.querySelector('input[name="requested_resolution"]:checked').value;
    formData.append('requested_resolution', resolution);

    const fileInput = document.getElementById('evidenceFiles');
    if (fileInput.files.length > 0) {
      for (let i = 0; i < fileInput.files.length; i++) {
        formData.append('evidence', fileInput.files[i]);
      }
    }

    const res = await fetch('/api/refunds', {
      method: 'POST',
      headers: { 'x-customer-id': currentCustomerId },
      body: formData,
    });

    const data = await res.json();

    if (res.status === 202 && data.success) {
      currentTrackingId = data.request_id;
      document.getElementById('disputeForm').reset();
      startLiveTracking(data.request_id);
      loadCustomerDisputes();
      loadOrders();
    } else {
      alert(`Submission rejected: ${data.error || 'Check submission details.'}`);
    }
  } catch (err) {
    alert(`Failed to submit dispute: ${err.message}`);
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<span>Submit Dispute (Async HTTP 202)</span><i class="fa-solid fa-arrow-right ml-2"></i>';
  }
}

// Load All Disputes Submitted by Active Customer (GET /api/refunds)
async function loadCustomerDisputes() {
  const container = document.getElementById('customerDisputesList');
  const countBadge = document.getElementById('customerDisputesCount');
  if (!container) return;

  try {
    const res = await fetch('/api/refunds', {
      headers: { 'x-customer-id': currentCustomerId },
    });
    const data = await res.json();

    if (!data.success || !data.refunds || data.refunds.length === 0) {
      container.innerHTML = '<div class="p-4 bg-white rounded-xl border border-slate-200 text-center text-slate-400 text-xs">No disputes filed yet by this customer.</div>';
      if (countBadge) countBadge.innerText = '0';
      return;
    }

    if (countBadge) countBadge.innerText = data.refunds.length;
    container.innerHTML = '';

    data.refunds.forEach((r) => {
      const isCurrent = currentTrackingId === r.id;
      const card = document.createElement('div');
      card.className = `p-3 rounded-xl border transition cursor-pointer flex items-center justify-between ${
        isCurrent
          ? 'border-amber-500 bg-amber-50/50 ring-2 ring-amber-500/20'
          : 'border-slate-200 bg-white hover:border-slate-300'
      }`;
      card.onclick = () => startLiveTracking(r.id);

      const itemsStr = Array.isArray(r.affected_items) ? r.affected_items.join(', ') : r.affected_items;
      const formattedDate = new Date(r.created_at).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });

      card.innerHTML = `
        <div class="space-y-0.5">
          <div class="flex items-center space-x-2">
            <span class="font-mono font-bold text-xs text-slate-800">${r.id}</span>
            <span class="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase badge-${r.status.toLowerCase()}">${r.status.replace(/_/g, ' ')}</span>
          </div>
          <div class="text-[11px] text-slate-500">
            <span>${r.restaurant_name} (${r.order_id})</span> • <span class="font-medium text-slate-700">${itemsStr}</span>
          </div>
          <div class="text-[10px] text-slate-400">
            ${formattedDate}
          </div>
        </div>
        <div class="text-right pl-3 shrink-0">
          <span class="block font-bold text-xs text-emerald-600">₹${Number(r.final_refund_amount || 0).toFixed(2)}</span>
          <span class="text-[10px] text-amber-600 hover:text-amber-700 font-semibold flex items-center justify-end mt-1">
            Track <i class="fa-solid fa-chevron-right ml-1"></i>
          </span>
        </div>
      `;
      container.appendChild(card);
    });
  } catch (err) {
    container.innerHTML = `<div class="p-3 bg-red-50 text-red-600 text-xs rounded-xl">Failed to load disputes: ${err.message}</div>`;
  }
}

// Manual Dispute ID Tracking from search bar
function manualTrackDispute() {
  const input = document.getElementById('manualTrackIdInput');
  if (!input) return;
  const id = input.value.trim();
  if (!id) {
    alert('Please enter a Dispute ID (e.g. REF231397C892)');
    return;
  }
  startLiveTracking(id);
}

// Start Live Polling for Dispute Tracker
function startLiveTracking(requestId) {
  currentTrackingId = requestId;
  const trackingContainer = document.getElementById('trackingContainer');
  trackingContainer.classList.remove('hidden');
  trackingContainer.scrollIntoView({ behavior: 'smooth' });

  document.getElementById('trackingRequestId').innerText = requestId;

  if (pollInterval) clearInterval(pollInterval);
  pollCurrentDispute();
  pollInterval = setInterval(pollCurrentDispute, 1500); // Poll every 1.5s
}

async function pollCurrentDispute() {
  if (!currentTrackingId) return;

  try {
    const res = await fetch(`/api/refunds/${currentTrackingId}`, {
      headers: { 'x-customer-id': currentCustomerId },
    });
    const data = await res.json();

    if (!data.success || !data.refund) return;

    renderTrackingStatus(data.refund);

    // Stop polling if final terminal state reached
    if (['AUTO_APPROVED', 'AUTO_DECLINED', 'MANUALLY_APPROVED', 'MANUALLY_REJECTED', 'ESCALATED'].includes(data.refund.status)) {
      if (['AUTO_APPROVED', 'AUTO_DECLINED', 'MANUALLY_APPROVED', 'MANUALLY_REJECTED'].includes(data.refund.status)) {
        clearInterval(pollInterval);
      }
      loadReviewQueue(); // Refresh queue counter
      loadCustomerDisputes(); // Refresh dispute history
    }
  } catch (err) {
    console.warn('Poll error:', err);
  }
}

// Render Detailed Tracking State in UI
function renderTrackingStatus(refund) {
  const badge = document.getElementById('trackingStatusBadge');
  badge.className = `px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider badge-${refund.status.toLowerCase()}`;
  badge.innerText = refund.status.replace(/_/g, ' ');

  // Update pipeline visual step markers
  const stepIntake = document.getElementById('stepIntake');
  const stepAI = document.getElementById('stepAI');
  const stepRAG = document.getElementById('stepRAG');
  const stepGuardrails = document.getElementById('stepGuardrails');

  if (refund.status === 'SUBMITTED') {
    stepAI.className = 'p-2 rounded-lg bg-amber-50 text-amber-700 font-medium border border-amber-200 animate-pulse';
    stepRAG.className = 'p-2 rounded-lg bg-slate-100 text-slate-600 font-medium';
    stepGuardrails.className = 'p-2 rounded-lg bg-slate-100 text-slate-600 font-medium';
  } else if (refund.status === 'PROCESSING') {
    stepAI.className = 'p-2 rounded-lg bg-emerald-50 text-emerald-700 font-medium border border-emerald-200';
    stepRAG.className = 'p-2 rounded-lg bg-amber-50 text-amber-700 font-medium border border-amber-200 animate-pulse';
    stepGuardrails.className = 'p-2 rounded-lg bg-slate-100 text-slate-600 font-medium';
  } else {
    stepAI.className = 'p-2 rounded-lg bg-emerald-50 text-emerald-700 font-medium border border-emerald-200';
    stepRAG.className = 'p-2 rounded-lg bg-emerald-50 text-emerald-700 font-medium border border-emerald-200';
    stepGuardrails.className = 'p-2 rounded-lg bg-emerald-50 text-emerald-700 font-medium border border-emerald-200';
  }

  // Basic amounts and routing
  document.getElementById('trackingAmount').innerText = `₹${Number(refund.final_refund_amount || refund.suggested_refund_amount || 0).toFixed(2)}`;
  document.getElementById('trackingEvidenceStatus').innerText = refund.evidence_status || 'PENDING';

  const routingEl = document.getElementById('trackingRoutingDecision');
  if (routingEl) {
    routingEl.innerText = refund.routing_decision || refund.status;
  }

  // Payment Gateway Row
  const paymentRow = document.getElementById('trackingPaymentRow');
  const paymentIdEl = document.getElementById('trackingPaymentId');
  if (paymentRow && paymentIdEl) {
    if (refund.payment_refund_id) {
      paymentRow.classList.remove('hidden');
      paymentIdEl.innerText = refund.payment_refund_id;
    } else {
      paymentRow.classList.add('hidden');
    }
  }

  // Escalation / Decline Cause
  const escalationRow = document.getElementById('trackingEscalationRow');
  if (refund.escalation_reason) {
    escalationRow.classList.remove('hidden');
    document.getElementById('trackingEscalationReason').innerText = refund.escalation_reason;
  } else {
    escalationRow.classList.add('hidden');
  }

  // Supplemental Evidence / Action Required Card (Option 1)
  const suppCard = document.getElementById('supplementalEvidenceCard');
  const suppInstructions = document.getElementById('supplementalInstructions');
  if (suppCard) {
    if (refund.status === 'ACTION_REQUIRED') {
      suppCard.classList.remove('hidden');
      if (suppInstructions) {
        suppInstructions.innerText = refund.reviewer_notes || 'The claims specialist has requested clearer photos or additional documentation before approving this refund.';
      }
    } else {
      suppCard.classList.add('hidden');
    }
  }

  // AI Reasoning Card & Citations
  const reasoningCard = document.getElementById('trackingReasoningCard');
  const reasoningText = document.getElementById('trackingReasoningText');
  const clausesList = document.getElementById('trackingClausesList');
  const citationBadge = document.getElementById('trackingCitationBadge');

  if (reasoningCard && refund.agent_recommendation && refund.agent_recommendation.reasoning) {
    reasoningCard.classList.remove('hidden');
    reasoningText.innerText = `"${refund.agent_recommendation.reasoning}"`;

    if (citationBadge && refund.citation_validation) {
      if (refund.citation_validation.is_valid) {
        citationBadge.className = 'text-[10px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-bold';
        citationBadge.innerHTML = '<i class="fa-solid fa-check mr-1"></i> Citations Verified';
      } else {
        citationBadge.className = 'text-[10px] bg-red-100 text-red-800 px-2 py-0.5 rounded-full font-bold';
        citationBadge.innerHTML = '<i class="fa-solid fa-xmark mr-1"></i> Citation Hallucination Flagged';
      }
    }

    if (clausesList && Array.isArray(refund.retrieved_clauses)) {
      clausesList.innerHTML = refund.retrieved_clauses
        .map(
          (c) => `
          <span class="inline-flex items-center text-[10px] bg-purple-100 text-purple-800 font-mono font-medium px-2 py-0.5 rounded-md" title="${c.policy_text}">
            <strong>${c.clause_id}</strong>: ${c.title}
          </span>
        `
        )
        .join('');
    }
  } else if (reasoningCard) {
    reasoningCard.classList.add('hidden');
  }

  // Deterministic Guardrails Checklist
  const guardrailsCard = document.getElementById('trackingGuardrailsCard');
  const guardrailsSummary = document.getElementById('trackingGuardrailSummary');
  const guardrailsList = document.getElementById('trackingGuardrailsList');

  if (guardrailsCard && Array.isArray(refund.guardrail_results) && refund.guardrail_results.length > 0) {
    guardrailsCard.classList.remove('hidden');
    const passedCount = refund.guardrail_results.filter((g) => g.passed).length;
    guardrailsSummary.innerText = `${passedCount}/${refund.guardrail_results.length} Passed`;

    guardrailsList.innerHTML = refund.guardrail_results
      .map(
        (g) => `
        <div class="flex items-start justify-between py-1 border-b border-slate-100 last:border-0 text-[11px]">
          <div class="space-x-1.5 flex items-center">
            <i class="fa-solid ${g.passed ? 'fa-circle-check text-emerald-500' : 'fa-circle-xmark text-amber-500'}"></i>
            <span class="font-medium text-slate-700">${g.name.replace(/_/g, ' ')}</span>
          </div>
          <span class="text-[10px] font-mono text-slate-500 text-right max-w-[200px] truncate" title="${g.details}">${g.details}</span>
        </div>
      `
      )
      .join('');
  } else if (guardrailsCard) {
    guardrailsCard.classList.add('hidden');
  }

  // Reviewer Notes Card
  const reviewerCard = document.getElementById('trackingReviewerCard');
  const reviewerNotes = document.getElementById('trackingReviewerNotes');
  const reviewerDate = document.getElementById('trackingReviewerDate');

  if (reviewerCard && refund.reviewer_notes) {
    reviewerCard.classList.remove('hidden');
    reviewerNotes.innerText = refund.reviewer_notes;
    reviewerDate.innerText = refund.reviewed_at ? new Date(refund.reviewed_at).toLocaleString() : '';
  } else if (reviewerCard) {
    reviewerCard.classList.add('hidden');
  }

  // Audit Events Timeline
  const auditTimeline = document.getElementById('trackingAuditTimeline');
  if (auditTimeline && Array.isArray(refund.audit_trail)) {
    auditTimeline.innerHTML = refund.audit_trail
      .map((ev) => {
        const time = new Date(ev.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        return `
          <div class="flex items-center justify-between py-0.5 border-b border-slate-100 last:border-0">
            <span class="font-semibold text-slate-700"><span class="font-mono text-slate-400">[${time}]</span> ${ev.event_type} (${ev.actor})</span>
            <span class="font-medium text-slate-500">${ev.refund_amount ? '₹' + Number(ev.refund_amount).toFixed(2) : ''}</span>
          </div>
        `;
      })
      .join('');
  }
}

// Option 1: Submit Supplemental Evidence Form (POST /api/refunds/:requestId/additional-evidence)
async function submitSupplementalEvidence(event) {
  event.preventDefault();
  if (!currentTrackingId) return;

  const btn = document.getElementById('submitSupplementalBtn');
  const fileInput = document.getElementById('supplementalFiles');
  const notesInput = document.getElementById('supplementalNotes');

  if (!fileInput.files || fileInput.files.length === 0) {
    alert('Please select at least one photo to upload.');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Uploading Requested Photos...';

  try {
    const formData = new FormData();
    formData.append('customer_notes', notesInput.value || '');
    for (let i = 0; i < fileInput.files.length; i++) {
      formData.append('evidence', fileInput.files[i]);
    }

    const res = await fetch(`/api/refunds/${currentTrackingId}/additional-evidence`, {
      method: 'POST',
      headers: { 'x-customer-id': currentCustomerId },
      body: formData,
    });

    const data = await res.json();
    if (data.success) {
      alert('Supplemental evidence received! Your dispute has been returned to the specialist review queue.');
      document.getElementById('supplementalForm').reset();
      pollCurrentDispute();
      loadCustomerDisputes();
      loadReviewQueue();
    } else {
      alert(`Upload rejected: ${data.message || data.error}`);
    }
  } catch (err) {
    alert(`Network error: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span>Submit Requested Photos & Re-open Review</span><i class="fa-solid fa-paper-plane text-xs ml-2"></i>';
  }
}

// 2. Load Reviewer Queue (GET /api/review/queue)
async function loadReviewQueue() {
  try {
    const res = await fetch('/api/review/queue');
    const data = await res.json();

    const queueBadge = document.getElementById('queueBadge');
    const queueCountLabel = document.getElementById('queueCountLabel');
    const queueList = document.getElementById('queueList');

    if (!data.success || !data.disputes) return;

    const count = data.disputes.length;
    if (count > 0) {
      queueBadge.classList.remove('hidden');
      queueBadge.innerText = count;
    } else {
      queueBadge.classList.add('hidden');
    }

    queueCountLabel.innerText = `${count} Pending`;

    if (count === 0) {
      queueList.innerHTML = '<div class="p-8 bg-white rounded-xl border border-slate-200 text-center text-slate-400 text-xs">No pending disputes in queue. All caught up! 🎉</div>';
      return;
    }

    queueList.innerHTML = '';
    data.disputes.forEach((d) => {
      const card = document.createElement('div');
      const isSelected = activeReviewDisputeId === d.request_id;
      const isActionReq = d.status === 'ACTION_REQUIRED';
      const statusPill = isActionReq
        ? '<span class="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase bg-amber-100 text-amber-800 border border-amber-300">Awaiting Customer Info</span>'
        : '<span class="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase bg-red-100 text-red-800">Needs Review</span>';

      card.className = `p-4 rounded-xl border transition cursor-pointer ${
        isSelected ? 'border-red-500 bg-red-50/40 ring-2 ring-red-500/20' : 'border-slate-200 bg-white hover:border-slate-300'
      }`;
      card.onclick = () => openCockpitDetail(d.request_id);

      card.innerHTML = `
        <div class="flex items-start justify-between">
          <div>
            <div class="flex items-center space-x-2">
              <span class="text-xs font-bold text-slate-900 block">${d.request_id}</span>
              ${statusPill}
            </div>
            <span class="text-xs font-semibold text-slate-700">${d.customer_name}</span>
          </div>
          <span class="text-xs font-bold text-red-600">₹${Number(d.final_refund_amount).toFixed(2)}</span>
        </div>
        <p class="text-xs text-slate-500 mt-2 truncate font-medium">${d.restaurant_name} • ${d.affected_items.join(', ')}</p>
        <p class="text-xs ${isActionReq ? 'text-amber-700 font-medium' : 'text-red-600'} mt-1 line-clamp-2">${isActionReq ? 'Specialist Note: ' + (d.reviewer_notes || 'More info needed') : d.escalation_reason}</p>
      `;

      queueList.appendChild(card);
    });
  } catch (err) {
    console.warn('Review queue error:', err);
  }
}

// Open Reviewer Cockpit View for a Single Dispute
async function openCockpitDetail(requestId) {
  activeReviewDisputeId = requestId;
  loadReviewQueue();

  const emptyState = document.getElementById('cockpitEmptyState');
  const container = document.getElementById('cockpitContainer');

  emptyState.classList.add('hidden');
  container.classList.remove('hidden');

  try {
    const res = await fetch(`/api/review/${requestId}`);
    const data = await res.json();

    if (!data.success || !data.cockpit) return;

    const c = data.cockpit;

    document.getElementById('cockpitRequestId').innerText = c.dispute_id;
    document.getElementById('cockpitAmount').innerText = `₹${c.amounts.final_calculated.toFixed(2)}`;
    document.getElementById('cockpitEscalationReason').innerText = c.escalation_reason || 'Manual review requested.';
    document.getElementById('cockpitRestaurantName').innerText = c.order.restaurant;
    document.getElementById('cockpitTotalPaid').innerText = `₹${c.order.total_paid.toFixed(2)}`;

    // Render Bill items
    const billContainer = document.getElementById('cockpitBillItems');
    billContainer.innerHTML = '';
    c.order.items.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'flex justify-between items-center';
      row.innerHTML = `
        <span>${item.quantity}x ${item.name}</span>
        <span class="font-semibold">₹${item.total_price.toFixed(2)}</span>
      `;
      billContainer.appendChild(row);
    });

    // Render Evidence Images
    const imgContainer = document.getElementById('cockpitEvidenceImages');
    imgContainer.innerHTML = '';
    if (c.evidence.files.length === 0) {
      imgContainer.innerHTML = '<span class="text-xs text-slate-400">No photos uploaded.</span>';
    } else {
      c.evidence.files.forEach((file) => {
        const img = document.createElement('img');
        const filename = file.stored_path.split('/').pop();
        img.src = `/uploads/${filename}`;
        img.className = 'h-24 w-24 object-cover rounded-lg border border-slate-300 shadow-sm hover:scale-105 transition cursor-pointer';
        img.title = `SHA-256: ${file.sha256_hash}`;
        img.onclick = () => window.open(img.src, '_blank');
        imgContainer.appendChild(img);
      });
    }

    document.getElementById('cockpitEvidenceStatus').innerText = c.evidence.evidence_status;
    document.getElementById('cockpitEvidenceStatus').className = `ml-1 font-bold ${
      c.evidence.evidence_status === 'CONSISTENT' ? 'text-emerald-600' : 'text-amber-600'
    }`;

    // AI recommendation & policies
    const aiBadge = document.getElementById('cockpitAiDecisionBadge');
    aiBadge.innerText = c.ai_recommendation?.decision || 'ANALYZED';
    aiBadge.className = `px-2 py-0.5 rounded font-bold uppercase ${
      c.ai_recommendation?.decision === 'APPROVE' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
    }`;

    document.getElementById('cockpitAiReasoning').innerText = `"${c.ai_recommendation?.reasoning || 'Evaluated against platform rules.'}"`;

    const policyContainer = document.getElementById('cockpitPolicyList');
    policyContainer.innerHTML = '';
    if (c.retrieved_policies) {
      c.retrieved_policies.forEach((p) => {
        const item = document.createElement('div');
        item.className = 'text-xs text-slate-600 flex items-start space-x-1';
        item.innerHTML = `<span class="font-bold text-amber-800">[${p.clause_id}]</span> <span>${p.title}: "${p.policy_text}"</span>`;
        policyContainer.appendChild(item);
      });
    }

    // Set initial override amount input
    document.getElementById('reviewerOverrideAmount').value = c.amounts.final_calculated;
  } catch (err) {
    alert(`Failed to load cockpit: ${err.message}`);
  }
}

// Submit Reviewer Action (POST /api/review/:requestId/action)
async function submitReviewerAction(action) {
  if (!activeReviewDisputeId) return;

  const notes = document.getElementById('reviewerNotes').value.trim();
  if (notes.length < 5) {
    alert('Reviewer notes are mandatory (minimum 5 characters) for audit compliance.');
    return;
  }

  const overrideAmount = parseFloat(document.getElementById('reviewerOverrideAmount').value);

  try {
    const res = await fetch(`/api/review/${activeReviewDisputeId}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        reviewer_id: 'REV_DEEPAK_99',
        reviewer_name: 'Deepak Senior Specialist',
        notes,
        override_amount: isNaN(overrideAmount) ? undefined : overrideAmount,
      }),
    });

    const data = await res.json();

    if (data.success) {
      alert(`Decision recorded! Action: ${data.action}. Transaction ID: ${data.transaction_id || 'N/A'}`);
      document.getElementById('reviewerNotes').value = '';
      document.getElementById('cockpitContainer').classList.add('hidden');
      document.getElementById('cockpitEmptyState').classList.remove('hidden');
      activeReviewDisputeId = null;
      loadReviewQueue();
      loadOrders();
      loadCustomerDisputes();
    } else {
      alert(`Action failed: ${data.error}`);
    }
  } catch (err) {
    alert(`Network error: ${err.message}`);
  }
}

// 3. Load Global Audit Logs (GET /api/review/audit-all)
async function loadGlobalAuditLogs() {
  const tbody = document.getElementById('auditTableBody');
  tbody.innerHTML = '<tr><td colspan="6" class="px-6 py-8 text-center text-slate-400">Loading audit trail...</td></tr>';

  try {
    const res = await fetch('/api/review/audit-all');
    const data = await res.json();

    if (!data.success || !data.audit_logs || data.audit_logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="px-6 py-8 text-center text-slate-400">No audit events recorded yet.</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    data.audit_logs.forEach((log) => {
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-slate-50 transition';

      tr.innerHTML = `
        <td class="px-6 py-3 text-slate-500 whitespace-nowrap">${new Date(log.created_at).toLocaleTimeString()}</td>
        <td class="px-6 py-3 font-bold text-slate-800">${log.refund_request_id}</td>
        <td class="px-6 py-3">
          <span class="px-2 py-0.5 bg-slate-100 rounded text-slate-700 font-semibold text-2xs">${log.event_type}</span>
        </td>
        <td class="px-6 py-3 text-slate-600 font-medium">${log.actor}</td>
        <td class="px-6 py-3 font-bold text-slate-900">${log.refund_amount ? `₹${Number(log.refund_amount).toFixed(2)}` : '—'}</td>
        <td class="px-6 py-3 text-slate-500 font-mono text-2xs max-w-xs truncate" title='${JSON.stringify(log.payload)}'>
          ${JSON.stringify(log.payload)}
        </td>
      `;

      tbody.appendChild(tr);
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="px-6 py-4 text-center text-red-600">Failed to load audit logs: ${err.message}</td></tr>`;
  }
}
