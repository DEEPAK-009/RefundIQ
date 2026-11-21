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
    }
  } catch (err) {
    console.warn('Poll error:', err);
  }
}

// Render Tracking State in UI
function renderTrackingStatus(refund) {
  const badge = document.getElementById('trackingStatusBadge');
  badge.className = `px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider badge-${refund.status.toLowerCase()}`;
  badge.innerText = refund.status.replace('_', ' ');

  // Update pipeline visual step markers
  const stepIntake = document.getElementById('stepIntake');
  const stepAI = document.getElementById('stepAI');
  const stepRAG = document.getElementById('stepRAG');
  const stepGuardrails = document.getElementById('stepGuardrails');

  if (refund.status === 'SUBMITTED') {
    stepAI.className = 'p-2 rounded-lg bg-amber-50 text-amber-700 font-medium border border-amber-200 animate-pulse';
  } else if (refund.status === 'PROCESSING') {
    stepAI.className = 'p-2 rounded-lg bg-emerald-50 text-emerald-700 font-medium border border-emerald-200';
    stepRAG.className = 'p-2 rounded-lg bg-amber-50 text-amber-700 font-medium border border-amber-200 animate-pulse';
  } else {
    stepAI.className = 'p-2 rounded-lg bg-emerald-50 text-emerald-700 font-medium border border-emerald-200';
    stepRAG.className = 'p-2 rounded-lg bg-emerald-50 text-emerald-700 font-medium border border-emerald-200';
    stepGuardrails.className = 'p-2 rounded-lg bg-emerald-50 text-emerald-700 font-medium border border-emerald-200';
  }

  document.getElementById('trackingAmount').innerText = `₹${Number(refund.final_refund_amount || refund.suggested_refund_amount || 0).toFixed(2)}`;
  document.getElementById('trackingEvidenceStatus').innerText = refund.evidence_status || 'ANALYZING...';

  const escalationRow = document.getElementById('trackingEscalationRow');
  if (refund.escalation_reason) {
    escalationRow.classList.remove('hidden');
    document.getElementById('trackingEscalationReason').innerText = refund.escalation_reason;
  } else {
    escalationRow.classList.add('hidden');
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
      card.className = `p-4 rounded-xl border transition cursor-pointer ${
        isSelected ? 'border-red-500 bg-red-50/40 ring-2 ring-red-500/20' : 'border-slate-200 bg-white hover:border-slate-300'
      }`;
      card.onclick = () => openCockpitDetail(d.request_id);

      card.innerHTML = `
        <div class="flex items-start justify-between">
          <div>
            <span class="text-xs font-bold text-slate-900 block">${d.request_id}</span>
            <span class="text-xs font-semibold text-slate-700">${d.customer_name}</span>
          </div>
          <span class="text-xs font-bold text-red-600">₹${Number(d.final_refund_amount).toFixed(2)}</span>
        </div>
        <p class="text-xs text-slate-500 mt-2 truncate font-medium">${d.restaurant_name} • ${d.affected_items.join(', ')}</p>
        <p class="text-xs text-red-600 mt-1 line-clamp-2">${d.escalation_reason}</p>
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
