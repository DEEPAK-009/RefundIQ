// RefundIQ Frontend Application Logic — Support Chat Bot & Inspector

let currentCustomerId = 'CUST101';
let currentOrders = [];
let selectedOrder = null;
let currentTrackingId = null;
let pollInterval = null;
let currentEventSource = null;
let activeReviewDisputeId = null;

// Chat State variables
let chatActiveIssue = null;
let chatMessagesHistory = [];

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  loadOrders();
  loadCustomerDisputes();
  loadReviewQueue();
  setInterval(loadReviewQueue, 10000);
});

// Switch between Chat Bot, Inspector, Reviewer Cockpit, and Audit views
function switchView(viewName) {
  const customerView = document.getElementById('customerView');
  const inspectorView = document.getElementById('inspectorView');
  const reviewerView = document.getElementById('reviewerView');
  const auditView = document.getElementById('auditView');

  const tabCustomer = document.getElementById('tabBtnCustomer');
  const tabInspector = document.getElementById('tabBtnInspector');
  const tabReviewer = document.getElementById('tabBtnReviewer');
  const tabAudit = document.getElementById('tabBtnAudit');

  [tabCustomer, tabInspector, tabReviewer, tabAudit].forEach((btn) => {
    if (btn) btn.className = 'px-4 py-1.5 rounded-lg text-sm font-medium transition text-slate-300 hover:text-white relative';
  });

  customerView.classList.add('hidden');
  inspectorView.classList.add('hidden');
  reviewerView.classList.add('hidden');
  auditView.classList.add('hidden');

  if (viewName === 'customer') {
    customerView.classList.remove('hidden');
    tabCustomer.className = 'px-4 py-1.5 rounded-lg text-sm font-medium transition bg-amber-500 text-slate-950 shadow';
    loadCustomerDisputes();
  } else if (viewName === 'inspector') {
    inspectorView.classList.remove('hidden');
    tabInspector.className = 'px-4 py-1.5 rounded-lg text-sm font-medium transition bg-amber-500 text-slate-950 shadow';
    if (currentTrackingId) {
      document.getElementById('manualTrackIdInput').value = currentTrackingId;
      pollCurrentDispute();
    }
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

// Change customer persona
function changeCustomer(newCustomerId) {
  currentCustomerId = newCustomerId;
  selectedOrder = null;
  currentTrackingId = null;
  resetChatFlow();
  loadOrders();
  loadCustomerDisputes();
}

// 1. Load Delivered Orders (GET /api/orders)
async function loadOrders() {
  const container = document.getElementById('ordersList');
  container.innerHTML = '<div class="p-8 text-center text-slate-400 text-xs">Loading orders...</div>';

  try {
    const res = await fetch('/api/orders', {
      headers: { 'x-customer-id': currentCustomerId },
    });
    const data = await res.json();

    if (!data.success || !data.orders || data.orders.length === 0) {
      container.innerHTML = '<div class="p-8 text-center text-slate-400 text-xs">No orders found for this customer.</div>';
      return;
    }

    currentOrders = data.orders;
    renderOrdersList(data.orders);
    
    // If chat is idle, initialize greeting
    if (!selectedOrder && !currentTrackingId) {
      renderChatGreeting(data.customer?.name || 'there');
    }
  } catch (err) {
    container.innerHTML = `<div class="p-4 bg-red-50 text-red-700 text-xs rounded-xl">Error loading orders: ${err.message}</div>`;
  }
}

// Render Orders in Sidebar
function renderOrdersList(orders) {
  const container = document.getElementById('ordersList');
  container.innerHTML = '';

  orders.forEach((order) => {
    const isSelected = selectedOrder && selectedOrder.order_id === order.order_id;
    const card = document.createElement('div');
    card.className = `p-3 rounded-xl border transition cursor-pointer ${
      isSelected
        ? 'border-amber-500 bg-amber-50/50 ring-2 ring-amber-500/20'
        : 'border-slate-200 bg-white hover:border-slate-300'
    }`;
    card.onclick = () => selectOrderForChat(order.order_id);

    const itemsSummary = order.items.map((i) => `${i.quantity}x ${i.name}`).join(', ');

    card.innerHTML = `
      <div class="flex items-start justify-between">
        <div>
          <span class="font-bold text-xs text-slate-900">${order.restaurant_name}</span>
          <span class="text-[10px] font-mono text-slate-400 block">${order.order_id}</span>
        </div>
        <span class="font-bold text-xs text-slate-900">₹${Number(order.total_amount).toFixed(2)}</span>
      </div>
      <p class="text-[11px] text-slate-500 mt-1.5 truncate">${itemsSummary}</p>
      <div class="flex items-center justify-between mt-2 pt-2 border-t border-slate-100 text-[10px]">
        <span class="text-emerald-700 font-semibold flex items-center">
          <i class="fa-solid fa-circle-check mr-1 text-[8px]"></i> ${order.order_status}
        </span>
        <button class="text-amber-600 font-bold hover:text-amber-700">Get Help &rarr;</button>
      </div>
    `;
    container.appendChild(card);
  });
}

// Load Past Customer Disputes
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
      container.innerHTML = '<div class="p-3 bg-white rounded-xl border border-slate-200 text-center text-slate-400 text-xs">No disputes filed yet.</div>';
      if (countBadge) countBadge.innerText = '0';
      return;
    }

    if (countBadge) countBadge.innerText = data.refunds.length;
    container.innerHTML = '';

    data.refunds.forEach((r) => {
      const isCurrent = currentTrackingId === r.id;
      const card = document.createElement('div');
      card.className = `p-2.5 rounded-xl border transition cursor-pointer flex items-center justify-between ${
        isCurrent
          ? 'border-amber-500 bg-amber-50/60 ring-1 ring-amber-500/30'
          : 'border-slate-200 bg-white hover:border-slate-300'
      }`;
      card.onclick = () => loadPastDisputeChat(r.id);

      const itemsStr = Array.isArray(r.affected_items) ? r.affected_items.join(', ') : r.affected_items;

      card.innerHTML = `
        <div class="space-y-0.5">
          <div class="flex items-center space-x-1.5">
            <span class="font-mono font-bold text-xs text-slate-800">${r.id}</span>
            <span class="text-[9px] px-1.5 py-0.2 rounded-full font-bold uppercase badge-${r.status.toLowerCase()}">${r.status.replace(/_/g, ' ')}</span>
          </div>
          <p class="text-[10px] text-slate-500 truncate max-w-[140px]">${r.restaurant_name} • ${itemsStr}</p>
        </div>
        <div class="text-right shrink-0">
          <span class="block font-bold text-xs text-emerald-600">₹${Number(r.final_refund_amount || 0).toFixed(2)}</span>
          <span class="text-[9px] text-amber-600 font-semibold">View &rarr;</span>
        </div>
      `;
      container.appendChild(card);
    });
  } catch (err) {
    container.innerHTML = `<div class="p-2 bg-red-50 text-red-600 text-xs rounded-xl">Error: ${err.message}</div>`;
  }
}

// ==================== CHAT BOT CONVERSATIONAL ENGINE ====================

function renderChatGreeting(customerName) {
  const chatMessages = document.getElementById('chatMessages');
  const chatControls = document.getElementById('chatControls');
  document.getElementById('chatActiveOrderSubtitle').innerText = 'Select an order to begin';

  chatMessages.innerHTML = `
    <!-- Bot Message: Greeting -->
    <div class="flex items-start space-x-3">
      <div class="w-8 h-8 rounded-full bg-amber-500 text-slate-950 font-bold flex items-center justify-center text-xs shrink-0 shadow">
        <i class="fa-solid fa-robot"></i>
      </div>
      <div class="max-w-lg bg-white rounded-2xl rounded-tl-sm p-4 border border-slate-200 shadow-sm space-y-2 text-xs text-slate-800">
        <p class="font-semibold text-slate-900">Hello ${customerName}!</p>
        <p>I'm your <strong>RefundIQ Support Assistant</strong>. I can help resolve issues with your delivered food orders, process refunds, or connect you with our claims team.</p>
        <p class="text-slate-500">Please choose an order from the left to report an issue, or click any past dispute to see its latest status.</p>
      </div>
    </div>
  `;

  chatControls.innerHTML = `
    <div class="text-center py-2 text-xs text-slate-400">
      <i class="fa-solid fa-hand-pointer mr-1"></i> Select an order on the left panel to begin.
    </div>
  `;
}

// Step 1: User selects an order
function selectOrderForChat(orderId) {
  const order = currentOrders.find((o) => o.order_id === orderId);
  if (!order) return;

  selectedOrder = order;
  currentTrackingId = null;
  renderOrdersList(currentOrders);

  document.getElementById('chatActiveOrderSubtitle').innerText = `Active Order: ${order.order_id} (${order.restaurant_name})`;

  const chatMessages = document.getElementById('chatMessages');
  const itemsText = order.items.map((i) => `${i.quantity}x ${i.name}`).join(', ');

  chatMessages.innerHTML = `
    <!-- Bot Greeting -->
    <div class="flex items-start space-x-3">
      <div class="w-8 h-8 rounded-full bg-amber-500 text-slate-950 font-bold flex items-center justify-center text-xs shrink-0 shadow">
        <i class="fa-solid fa-robot"></i>
      </div>
      <div class="max-w-lg bg-white rounded-2xl rounded-tl-sm p-3.5 border border-slate-200 shadow-sm text-xs text-slate-800 space-y-1">
        <p class="font-semibold text-slate-900">Order #${order.order_id} selected:</p>
        <p class="text-slate-600 font-medium">${order.restaurant_name} • Total: ₹${Number(order.total_amount).toFixed(2)}</p>
        <p class="text-slate-500 text-[11px]">${itemsText}</p>
      </div>
    </div>

    <!-- Bot Question: What issue? -->
    <div class="flex items-start space-x-3">
      <div class="w-8 h-8 rounded-full bg-amber-500 text-slate-950 font-bold flex items-center justify-center text-xs shrink-0 shadow">
        <i class="fa-solid fa-robot"></i>
      </div>
      <div class="max-w-lg bg-white rounded-2xl rounded-tl-sm p-3.5 border border-slate-200 shadow-sm text-xs text-slate-800 space-y-2">
        <p class="font-medium text-slate-900">What went wrong with this order?</p>
        <p class="text-slate-500 text-[11px]">Select your issue category below to proceed:</p>
      </div>
    </div>
  `;

  renderIssueCategoryChips();
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Step 2: Render Issue Category Chips
function renderIssueCategoryChips() {
  const chatControls = document.getElementById('chatControls');
  chatControls.innerHTML = `
    <div class="space-y-2">
      <span class="block text-2xs uppercase tracking-wider font-bold text-slate-500">Select Issue Category:</span>
      <div class="flex flex-wrap gap-2">
        <button onclick="selectChatIssue('missing_item', 'Missing item(s) in delivery')" class="px-3 py-2 bg-slate-100 hover:bg-amber-100 hover:border-amber-400 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 transition flex items-center space-x-1.5">
          <i class="fa-solid fa-utensils"></i><span>Missing item(s)</span>
        </button>
        <button onclick="selectChatIssue('damaged_spilled', 'Damaged or spilled food')" class="px-3 py-2 bg-slate-100 hover:bg-amber-100 hover:border-amber-400 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 transition flex items-center space-x-1.5">
          <i class="fa-solid fa-box-open"></i><span>Damaged / Spilled Food</span>
        </button>
        <button onclick="selectChatIssue('wrong_item', 'Wrong item delivered')" class="px-3 py-2 bg-slate-100 hover:bg-amber-100 hover:border-amber-400 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 transition flex items-center space-x-1.5">
          <i class="fa-solid fa-repeat"></i><span>Wrong Item Delivered</span>
        </button>
        <button onclick="selectChatIssue('food_quality', 'Food quality or cold food')" class="px-3 py-2 bg-slate-100 hover:bg-amber-100 hover:border-amber-400 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 transition flex items-center space-x-1.5">
          <i class="fa-solid fa-snowflake"></i><span>Food Quality / Cold</span>
        </button>
        <button onclick="selectChatIssue('other', 'Other issue')" class="px-3 py-2 bg-slate-100 hover:bg-amber-100 hover:border-amber-400 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 transition flex items-center space-x-1.5">
          <i class="fa-solid fa-circle-question"></i><span>Other Issue</span>
        </button>
      </div>
    </div>
  `;
}

// Step 3: User clicks an issue chip
function selectChatIssue(issueCategory, issueLabel) {
  chatActiveIssue = { category: issueCategory, label: issueLabel };
  const chatMessages = document.getElementById('chatMessages');

  // User chat bubble
  chatMessages.innerHTML += `
    <div class="flex items-end justify-end space-x-2">
      <div class="max-w-md bg-amber-500 text-slate-950 font-medium rounded-2xl rounded-tr-sm px-4 py-2.5 text-xs shadow-sm">
        ${issueLabel}
      </div>
    </div>
  `;

  // Bot response bubble
  chatMessages.innerHTML += `
    <div class="flex items-start space-x-3">
      <div class="w-8 h-8 rounded-full bg-amber-500 text-slate-950 font-bold flex items-center justify-center text-xs shrink-0 shadow">
        <i class="fa-solid fa-robot"></i>
      </div>
      <div class="max-w-lg bg-white rounded-2xl rounded-tl-sm p-3.5 border border-slate-200 shadow-sm text-xs text-slate-800 space-y-1">
        <p class="font-semibold text-slate-900">Which item(s) are affected?</p>
        <p class="text-slate-500">Please choose the food items from your bill and attach photo evidence (JPG, PNG, WebP only):</p>
      </div>
    </div>
  `;

  renderDisputeSubmissionTray();
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Step 4: Render item checkboxes & image upload inside chat control tray
function renderDisputeSubmissionTray() {
  const chatControls = document.getElementById('chatControls');
  if (!selectedOrder) return;

  const itemsHtml = selectedOrder.items
    .map(
      (item) => `
      <label class="flex items-center justify-between p-2 rounded-lg border border-slate-200 bg-slate-50 hover:bg-amber-50/50 cursor-pointer text-xs">
        <div class="flex items-center space-x-2">
          <input type="checkbox" name="chat_affected_item" value="${item.name}" class="rounded text-amber-500 focus:ring-amber-500">
          <span class="font-medium text-slate-800">${item.quantity}x ${item.name}</span>
        </div>
        <span class="font-bold text-slate-600">₹${Number(item.price_per_unit).toFixed(2)}</span>
      </label>
    `
    )
    .join('');

  chatControls.innerHTML = `
    <form id="chatDisputeForm" onsubmit="submitChatDispute(event)" class="space-y-3">
      <div>
        <span class="block text-2xs uppercase tracking-wider font-bold text-slate-500 mb-1">Select Affected Items:</span>
        <div class="max-h-28 overflow-y-auto space-y-1.5">
          ${itemsHtml}
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label class="block text-2xs uppercase tracking-wider font-bold text-slate-500 mb-1">Explain what happened:</label>
          <input type="text" id="chatDescription" required placeholder="e.g. Fries was completely missing from delivery bag..." class="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-1.5 text-xs text-slate-800 outline-none focus:ring-2 focus:ring-amber-500">
        </div>

        <div>
          <label class="block text-2xs uppercase tracking-wider font-bold text-slate-500 mb-1">
            Attach Photo Evidence <span class="text-amber-600 font-semibold">(Images only, Max 2)</span>:
          </label>
          <!-- capture="environment" (Keep commented out during local testing; uncomment to force mobile camera) -->
          <input type="file" id="chatEvidenceFiles" accept="image/png, image/jpeg, image/webp" multiple required onchange="if(this.files.length > 2){ alert('Maximum of 2 images allowed for initial submission. Please re-select up to 2 photos.'); this.value = ''; }" class="text-xs text-slate-600 file:mr-2 file:py-1 file:px-2.5 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-slate-800 file:text-white hover:file:bg-slate-900 cursor-pointer w-full">
        </div>
      </div>

      <div class="flex items-center justify-between pt-1">
        <div class="flex items-center space-x-3 text-xs text-slate-600">
          <label class="flex items-center space-x-1 cursor-pointer">
            <input type="radio" name="chat_resolution" value="partial_refund" checked class="text-amber-500">
            <span>Partial Refund</span>
          </label>
          <label class="flex items-center space-x-1 cursor-pointer">
            <input type="radio" name="chat_resolution" value="full_refund" class="text-amber-500">
            <span>Full Refund</span>
          </label>
        </div>

        <button type="submit" id="chatSubmitBtn" class="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl text-xs transition shadow flex items-center space-x-1.5">
          <span>Submit Dispute</span>
          <i class="fa-solid fa-paper-plane text-xs"></i>
        </button>
      </div>
    </form>
  `;
}

// Step 5: Submit dispute from chat
async function submitChatDispute(event) {
  event.preventDefault();

  if (!selectedOrder) {
    alert('Please select an order first.');
    return;
  }

  const selectedItems = Array.from(document.querySelectorAll('input[name="chat_affected_item"]:checked')).map(
    (cb) => cb.value
  );

  if (selectedItems.length === 0) {
    alert('Please select at least one affected food item from the list.');
    return;
  }

  const fileInput = document.getElementById('chatEvidenceFiles');
  if (!fileInput.files || fileInput.files.length === 0) {
    alert('Please attach photo evidence (JPG, PNG, or WebP).');
    return;
  }
  if (fileInput.files.length > 2) {
    alert('A maximum of 2 photos are accepted for the initial dispute. Please select up to 2 images.');
    return;
  }

  const description = document.getElementById('chatDescription').value.trim();
  const resolution = document.querySelector('input[name="chat_resolution"]:checked').value;

  const submitBtn = document.getElementById('chatSubmitBtn');
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Submitting...';

  try {
    const formData = new FormData();
    formData.append('order_id', selectedOrder.order_id);
    formData.append('issue_category', chatActiveIssue.category);
    formData.append('affected_items', JSON.stringify(selectedItems));
    formData.append('description', description);
    formData.append('requested_resolution', resolution);

    for (let i = 0; i < fileInput.files.length; i++) {
      formData.append('evidence', fileInput.files[i]);
    }

    const res = await fetch('/api/refunds', {
      method: 'POST',
      headers: { 'x-customer-id': currentCustomerId },
      body: formData,
    });

    const data = await res.json();

    if (res.status === 202 && data.success) {
      currentTrackingId = data.request_id;

      // Append user bubble to chat
      const chatMessages = document.getElementById('chatMessages');
      chatMessages.innerHTML += `
        <div class="flex items-end justify-end space-x-2">
          <div class="max-w-md bg-amber-500 text-slate-950 font-medium rounded-2xl rounded-tr-sm p-3.5 text-xs shadow-sm space-y-1">
            <p><strong>Reported issue:</strong> ${chatActiveIssue.label}</p>
            <p><strong>Items:</strong> ${selectedItems.join(', ')}</p>
            <p class="italic">"${description}"</p>
            <p class="text-[10px] text-amber-950 font-semibold pt-1">[${fileInput.files.length} Photo attached]</p>
          </div>
        </div>
      `;

      // Append initial Bot acknowledging bubble
      chatMessages.innerHTML += `
        <div id="chatPendingBubble" class="flex items-start space-x-3">
          <div class="w-8 h-8 rounded-full bg-amber-500 text-slate-950 font-bold flex items-center justify-center text-xs shrink-0 shadow">
            <i class="fa-solid fa-robot"></i>
          </div>
          <div class="max-w-lg bg-white rounded-2xl rounded-tl-sm p-3.5 border border-slate-200 shadow-sm text-xs text-slate-800 space-y-1.5">
            <div class="flex items-center space-x-2">
              <span class="font-bold text-slate-900">Dispute Registered</span>
              <span class="font-mono text-2xs bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded font-semibold">${data.request_id}</span>
            </div>
            <p class="text-slate-600">We've received your report. Our automated system is currently verifying your claim against the restaurant bill...</p>
            <div class="flex items-center space-x-1.5 text-amber-600 text-[11px] pt-1">
              <i class="fa-solid fa-spinner fa-spin text-xs"></i>
              <span>Analyzing photo evidence and store policies...</span>
            </div>
          </div>
        </div>
      `;

      chatMessages.scrollTop = chatMessages.scrollHeight;

      // Clear controls tray
      document.getElementById('chatControls').innerHTML = `
        <div class="flex items-center justify-between text-xs py-1">
          <span class="text-slate-500">Tracking dispute <strong>${data.request_id}</strong>...</span>
          <button onclick="switchView('inspector')" class="text-amber-600 hover:text-amber-700 font-semibold flex items-center">
            <i class="fa-solid fa-microchip mr-1"></i> View Technical Inspector &rarr;
          </button>
        </div>
      `;

      loadCustomerDisputes();
      startLiveTracking(data.request_id);
    } else {
      alert(`Submission rejected: ${data.message || data.error || 'Check upload requirements.'}`);
    }
  } catch (err) {
    alert(`Submission error: ${err.message}`);
  }
}

// Reset chat flow
function resetChatFlow() {
  selectedOrder = null;
  currentTrackingId = null;
  chatActiveIssue = null;
  if (pollInterval) clearInterval(pollInterval);
  if (currentEventSource) {
    try { currentEventSource.close(); } catch {}
    currentEventSource = null;
  }
  renderOrdersList(currentOrders);
  renderChatGreeting('there');
}

// Load past dispute into chat view
async function loadPastDisputeChat(requestId) {
  currentTrackingId = requestId;
  switchView('customer');

  const chatMessages = document.getElementById('chatMessages');
  const chatControls = document.getElementById('chatControls');
  document.getElementById('chatActiveOrderSubtitle').innerText = `Viewing Dispute: ${requestId}`;

  chatMessages.innerHTML = `
    <div class="flex items-start space-x-3">
      <div class="w-8 h-8 rounded-full bg-amber-500 text-slate-950 font-bold flex items-center justify-center text-xs shrink-0 shadow">
        <i class="fa-solid fa-robot"></i>
      </div>
      <div class="max-w-lg bg-white rounded-2xl rounded-tl-sm p-3.5 border border-slate-200 shadow-sm text-xs text-slate-800 space-y-1">
        <p class="font-semibold text-slate-900">Loading dispute ${requestId}...</p>
      </div>
    </div>
  `;

  chatControls.innerHTML = `
    <div class="flex items-center justify-between text-xs py-1">
      <span class="text-slate-500">Tracking ticket <strong>${requestId}</strong></span>
      <button onclick="switchView('inspector')" class="text-amber-600 hover:text-amber-700 font-semibold flex items-center">
        <i class="fa-solid fa-microchip mr-1"></i> View System Inspector &rarr;
      </button>
    </div>
  `;

  startLiveTracking(requestId);
}

// ==================== REAL-TIME LIVE TRACKING & UPDATES ====================

function startLiveTracking(requestId) {
  currentTrackingId = requestId;
  document.getElementById('trackingRequestId').innerText = requestId;

  // Initial snapshot fetch
  pollCurrentDispute();

  // Open Real-time SSE Stream
  setupRealtimeEventStream(requestId);

  // Fallback interval
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(pollCurrentDispute, 3000);
}

// SSE Real-time connection
function setupRealtimeEventStream(requestId) {
  if (currentEventSource) {
    try { currentEventSource.close(); } catch {}
    currentEventSource = null;
  }

  if (!window.EventSource) return;

  try {
    currentEventSource = new EventSource(`/api/refunds/${requestId}/stream`);

    currentEventSource.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        console.log('[SSE Event]:', event);

        if (event.stage) {
          updatePipelineStageVisual(event.stage);
        }

        if (
          event.type === 'STATUS_UPDATED' ||
          event.type === 'REVIEW_ACTION' ||
          event.type === 'ADDITIONAL_EVIDENCE_RECEIVED' ||
          event.type === 'STAGE_CHANGE'
        ) {
          pollCurrentDispute();
          loadCustomerDisputes();
          loadReviewQueue();
        }
      } catch (err) {}
    };

    currentEventSource.onerror = () => {
      // Graceful fallback to HTTP polling
    };
  } catch (err) {}
}

async function pollCurrentDispute() {
  if (!currentTrackingId) return;

  try {
    const res = await fetch(`/api/refunds/${currentTrackingId}`, {
      headers: { 'x-customer-id': currentCustomerId },
    });
    const data = await res.json();

    if (!data.success || !data.refund) return;

    // 1. Render concise customer chat update
    renderChatShortUpdate(data.refund);

    // 2. Render deep technical inspector details
    renderInspectorDetails(data.refund);

    // Terminal states
    if (['AUTO_APPROVED', 'AUTO_DECLINED', 'MANUALLY_APPROVED', 'MANUALLY_REJECTED'].includes(data.refund.status)) {
      if (pollInterval) clearInterval(pollInterval);
      loadReviewQueue();
      loadCustomerDisputes();
    }
  } catch (err) {
    console.warn('Poll error:', err);
  }
}

// Option A: Render Proper Short Format Update in the Chat Bot
function renderChatShortUpdate(refund) {
  const pendingBubble = document.getElementById('chatPendingBubble');
  const chatMessages = document.getElementById('chatMessages');

  let updateHtml = '';

  if (refund.status === 'AUTO_APPROVED' || refund.status === 'MANUALLY_APPROVED') {
    updateHtml = `
      <div class="flex items-start space-x-3">
        <div class="w-8 h-8 rounded-full bg-emerald-500 text-white font-bold flex items-center justify-center text-xs shrink-0 shadow">
          <i class="fa-solid fa-check"></i>
        </div>
        <div class="max-w-lg bg-emerald-50 rounded-2xl rounded-tl-sm p-4 border border-emerald-200 shadow-sm text-xs text-emerald-950 space-y-2">
          <div class="flex items-center justify-between">
            <span class="font-bold text-sm text-emerald-800 flex items-center">
              <i class="fa-solid fa-circle-check mr-1.5 text-emerald-600"></i> Refund Approved!
            </span>
            <span class="text-base font-black text-emerald-700">₹${Number(refund.final_refund_amount).toFixed(2)}</span>
          </div>
          <p class="leading-relaxed">
            Good news! Your dispute for order <strong>${refund.order_id}</strong> has been approved. A refund of <strong>₹${Number(refund.final_refund_amount).toFixed(2)}</strong> was executed to your original payment method.
          </p>
          <div class="text-[10px] text-emerald-800 font-mono bg-white/70 p-2 rounded-lg border border-emerald-200">
            Payment Ref: <strong>${refund.payment_refund_id || 'rfnd_test_settled'}</strong>
          </div>
        </div>
      </div>
    `;
  } else if (refund.status === 'ACTION_REQUIRED') {
    updateHtml = `
      <div class="flex items-start space-x-3">
        <div class="w-8 h-8 rounded-full bg-yellow-500 text-white font-bold flex items-center justify-center text-xs shrink-0 shadow">
          <i class="fa-solid fa-circle-exclamation"></i>
        </div>
        <div class="max-w-lg bg-amber-50 rounded-2xl rounded-tl-sm p-4 border border-amber-300 shadow-sm text-xs text-amber-950 space-y-2.5">
          <div class="flex items-center space-x-2 text-amber-900 font-bold text-sm">
            <i class="fa-solid fa-circle-exclamation text-amber-600"></i>
            <span>Action Required: Specialist Note</span>
          </div>
          <p class="leading-relaxed bg-white/80 p-2.5 rounded-lg border border-amber-200 italic font-medium">
            "${refund.reviewer_notes || 'Please provide clearer photo evidence.'}"
          </p>
          <form onsubmit="submitSupplementalFromChat(event)" class="space-y-2 pt-1">
            <label class="block text-2xs uppercase tracking-wider font-bold text-amber-900">Upload Requested Photo (Images only):</label>
            <!-- capture="environment" (Keep commented out during local testing; uncomment to force mobile camera) -->
            <input type="file" id="chatActionRequiredFile" accept="image/png, image/jpeg, image/webp" multiple required class="text-xs text-slate-700 file:mr-2 file:py-1 file:px-2.5 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-amber-600 file:text-white cursor-pointer w-full">
            <button type="submit" id="chatActionRequiredBtn" class="w-full bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold py-1.5 rounded-lg text-xs transition shadow flex items-center justify-center space-x-1.5">
              <span>Submit Requested Photo & Re-open Review</span>
              <i class="fa-solid fa-paper-plane text-xs"></i>
            </button>
          </form>
        </div>
      </div>
    `;
  } else if (refund.status === 'ESCALATED') {
    updateHtml = `
      <div class="flex items-start space-x-3">
        <div class="w-8 h-8 rounded-full bg-amber-500 text-slate-950 font-bold flex items-center justify-center text-xs shrink-0 shadow">
          <i class="fa-solid fa-user-clock"></i>
        </div>
        <div class="max-w-lg bg-amber-50/70 rounded-2xl rounded-tl-sm p-4 border border-amber-200 shadow-sm text-xs text-amber-950 space-y-1.5">
          <span class="font-bold text-sm text-amber-900 block flex items-center">
            <i class="fa-solid fa-shield-halved mr-1.5 text-amber-600"></i> Under Specialist Review
          </span>
          <p class="leading-relaxed">
            Your dispute has been forwarded to our senior resolution team for a quick manual verification (exterior packaging photo was inconclusive). A claims specialist is reviewing your case now.
          </p>
        </div>
      </div>
    `;
  } else if (refund.status === 'AUTO_DECLINED' || refund.status === 'MANUALLY_REJECTED') {
    updateHtml = `
      <div class="flex items-start space-x-3">
        <div class="w-8 h-8 rounded-full bg-slate-400 text-white font-bold flex items-center justify-center text-xs shrink-0 shadow">
          <i class="fa-solid fa-xmark"></i>
        </div>
        <div class="max-w-lg bg-slate-100 rounded-2xl rounded-tl-sm p-4 border border-slate-200 shadow-sm text-xs text-slate-700 space-y-1.5">
          <span class="font-bold text-sm text-slate-900 block">Dispute Not Approved</span>
          <p class="leading-relaxed">
            We reviewed your claim against platform policies. Unfortunately, this refund request cannot be approved. Reason: <strong>${refund.reviewer_notes || refund.escalation_reason || 'Ineligible claim under refund policy.'}</strong>
          </p>
        </div>
      </div>
    `;
  }

  if (updateHtml) {
    if (pendingBubble) {
      pendingBubble.outerHTML = updateHtml;
    } else {
      const existingUpdate = document.getElementById('chatFinalUpdateBubble');
      if (existingUpdate) {
        existingUpdate.innerHTML = updateHtml;
      } else {
        const wrap = document.createElement('div');
        wrap.id = 'chatFinalUpdateBubble';
        wrap.innerHTML = updateHtml;
        chatMessages.appendChild(wrap);
      }
    }
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
}

// Submit supplemental evidence directly from chat
async function submitSupplementalFromChat(event) {
  event.preventDefault();
  if (!currentTrackingId) return;

  const btn = document.getElementById('chatActionRequiredBtn');
  const fileInput = document.getElementById('chatActionRequiredFile');

  if (!fileInput.files || fileInput.files.length === 0) {
    alert('Please select at least one photo (PNG, JPG, or WebP).');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Uploading...';

  try {
    const formData = new FormData();
    formData.append('customer_notes', 'Customer uploaded requested photo from chat.');
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
      alert('Photo received! Your dispute has been returned to the review queue.');
      pollCurrentDispute();
      loadReviewQueue();
      loadCustomerDisputes();
    } else {
      alert(`Upload rejected: ${data.message || data.error}`);
    }
  } catch (err) {
    alert(`Upload error: ${err.message}`);
  }
}

// ==================== SYSTEM INSPECTOR (ENGINEERING DETAILS) ====================

function renderInspectorDetails(refund) {
  const badge = document.getElementById('trackingStatusBadge');
  if (badge) {
    badge.className = `px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider badge-${refund.status.toLowerCase()}`;
    badge.innerText = refund.status.replace(/_/g, ' ');
  }

  updatePipelineStageVisual(
    refund.status === 'SUBMITTED' ? 'INTAKE' :
    refund.status === 'PROCESSING' ? 'AI_EXTRACTION' : 'COMPLETED'
  );

  const amountEl = document.getElementById('trackingAmount');
  if (amountEl) {
    amountEl.innerText = `₹${Number(refund.final_refund_amount || refund.suggested_refund_amount || 0).toFixed(2)}`;
  }

  const evStatusEl = document.getElementById('trackingEvidenceStatus');
  if (evStatusEl) {
    evStatusEl.innerText = refund.evidence_status || 'PENDING';
  }

  const routingEl = document.getElementById('trackingRoutingDecision');
  if (routingEl) {
    routingEl.innerText = refund.routing_decision || refund.status;
  }

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

  const escalationRow = document.getElementById('trackingEscalationRow');
  if (escalationRow) {
    if (refund.escalation_reason) {
      escalationRow.classList.remove('hidden');
      document.getElementById('trackingEscalationReason').innerText = refund.escalation_reason;
    } else {
      escalationRow.classList.add('hidden');
    }
  }

  // AI Reasoning & Citations
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
        citationBadge.innerHTML = '<i class="fa-solid fa-check mr-1"></i> Citations Grounded';
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

  // Guardrails checklist
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

  // Reviewer notes
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

  // Audit trail
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

function updatePipelineStageVisual(stage) {
  const stepIntake = document.getElementById('stepIntake');
  const stepAI = document.getElementById('stepAI');
  const stepRAG = document.getElementById('stepRAG');
  const stepGuardrails = document.getElementById('stepGuardrails');
  if (!stepIntake) return;

  if (stage === 'INTAKE') {
    stepIntake.className = 'p-2 rounded-lg bg-emerald-50 text-emerald-700 font-medium border border-emerald-200';
  } else if (stage === 'AI_EXTRACTION') {
    stepIntake.className = 'p-2 rounded-lg bg-emerald-50 text-emerald-700 font-medium border border-emerald-200';
    stepAI.className = 'p-2 rounded-lg bg-amber-50 text-amber-700 font-medium border border-amber-200 animate-pulse';
  } else if (stage === 'POLICY_RAG') {
    stepAI.className = 'p-2 rounded-lg bg-emerald-50 text-emerald-700 font-medium border border-emerald-200';
    stepRAG.className = 'p-2 rounded-lg bg-amber-50 text-amber-700 font-medium border border-amber-200 animate-pulse';
  } else if (stage === 'GUARDRAILS') {
    stepRAG.className = 'p-2 rounded-lg bg-emerald-50 text-emerald-700 font-medium border border-emerald-200';
    stepGuardrails.className = 'p-2 rounded-lg bg-amber-50 text-amber-700 font-medium border border-amber-200 animate-pulse';
  } else if (stage === 'COMPLETED') {
    stepAI.className = 'p-2 rounded-lg bg-emerald-50 text-emerald-700 font-medium border border-emerald-200';
    stepRAG.className = 'p-2 rounded-lg bg-emerald-50 text-emerald-700 font-medium border border-emerald-200';
    stepGuardrails.className = 'p-2 rounded-lg bg-emerald-50 text-emerald-700 font-medium border border-emerald-200';
  }
}

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

// ==================== REVIEWER COCKPIT ====================

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

    if (queueCountLabel) queueCountLabel.innerText = `${count} Pending`;

    if (count === 0) {
      queueList.innerHTML = '<div class="p-8 bg-white rounded-xl border border-slate-200 text-center text-slate-400 text-xs">No pending disputes in queue. All caught up!</div>';
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

// Open Cockpit Detail
async function openCockpitDetail(requestId) {
  activeReviewDisputeId = requestId;
  loadReviewQueue();

  const emptyState = document.getElementById('cockpitEmptyState');
  const container = document.getElementById('cockpitContainer');

  try {
    const res = await fetch(`/api/review/${requestId}`);
    const data = await res.json();

    if (!data.success || !data.cockpit) {
      alert('Failed to load cockpit details.');
      return;
    }

    const { cockpit } = data;

    emptyState.classList.add('hidden');
    container.classList.remove('hidden');

    document.getElementById('cockpitRequestId').innerText = cockpit.dispute_id;
    document.getElementById('cockpitOrderId').innerText = cockpit.order.order_id;
    document.getElementById('cockpitRestaurant').innerText = cockpit.order.restaurant_name;
    document.getElementById('cockpitCustomer').innerText = `${cockpit.customer.name} (${cockpit.customer.customer_id})`;
    document.getElementById('cockpitRefundRate').innerText = `${(Number(cockpit.customer.refund_rate) * 100).toFixed(1)}% (${cockpit.customer.refund_count}/${cockpit.customer.total_orders})`;
    document.getElementById('cockpitOrderTotal').innerText = `₹${Number(cockpit.order.total_amount).toFixed(2)}`;

    // Itemized Bill
    const itemsContainer = document.getElementById('cockpitItemsList');
    itemsContainer.innerHTML = cockpit.order.items
      .map(
        (i) => `
        <div class="flex justify-between py-1 border-b border-slate-100 last:border-0 text-xs">
          <span>${i.quantity}x ${i.name}</span>
          <span class="font-bold text-slate-700">₹${Number(i.total_price).toFixed(2)}</span>
        </div>
      `
      )
      .join('');

    // Customer Complaint
    const claimedItems = cockpit.complaint?.claimed_items || cockpit.complaint?.affected_items || [];
    document.getElementById('cockpitClaimedItems').innerText = Array.isArray(claimedItems) ? claimedItems.join(', ') : (claimedItems || 'None');
    
    const categoryName = cockpit.complaint?.issue_category || cockpit.complaint?.category || 'general';
    document.getElementById('cockpitCategory').innerText = categoryName.replace(/_/g, ' ');
    document.getElementById('cockpitCustomerDesc').innerText = `"${cockpit.complaint?.customer_description || ''}"`;

    // Escalation Cause
    document.getElementById('cockpitEscalationReason').innerText = cockpit.escalation_reason || 'Manual review required';

    // Evidence Gallery
    const gallery = document.getElementById('cockpitEvidenceGallery');
    document.getElementById('cockpitEvidenceStatus').innerText = cockpit.complaint?.evidence_status || cockpit.evidence?.evidence_status || 'PENDING';
    const filesList = Array.isArray(cockpit.evidence)
      ? cockpit.evidence
      : (cockpit.evidence?.files || []);

    if (filesList.length > 0) {
      gallery.innerHTML = filesList
        .map((e) => {
          let provenanceBadge = '';
          if (e.forensics) {
            if (e.forensics.classification === 'AUTHENTIC_CAMERA_CAPTURE') {
              provenanceBadge = `<span class="text-[9px] bg-emerald-100 text-emerald-800 font-bold px-1.5 py-0.5 rounded block truncate" title="${e.forensics.summary}"><i class="fa-solid fa-camera mr-1"></i>${e.forensics.cameraMake || ''} ${e.forensics.cameraModel || 'Camera'}</span>`;
            } else if (e.forensics.classification === 'EDITED_OR_GENERATED') {
              provenanceBadge = `<span class="text-[9px] bg-rose-100 text-rose-800 font-bold px-1.5 py-0.5 rounded block truncate" title="${e.forensics.summary}"><i class="fa-solid fa-wand-magic-sparkles mr-1"></i>Edited / Synthetic</span>`;
            } else {
              provenanceBadge = `<span class="text-[9px] bg-amber-100 text-amber-800 font-bold px-1.5 py-0.5 rounded block truncate" title="${e.forensics.summary}"><i class="fa-solid fa-globe mr-1"></i>Web / No EXIF</span>`;
            }
          }

          return `
          <div class="border rounded-lg p-2 bg-white text-center space-y-1.5 shadow-sm">
            <a href="${e.file_url}" target="_blank" class="block">
              <img src="${e.file_url}" alt="Evidence" class="h-28 w-full object-cover rounded bg-slate-100 hover:opacity-90 transition">
            </a>
            <span class="text-[10px] text-slate-600 font-medium block truncate" title="${e.filename || e.original_filename}">${e.filename || e.original_filename}</span>
            ${provenanceBadge}
          </div>
        `;
        })
        .join('');
    } else {
      gallery.innerHTML = '<span class="text-xs text-slate-400">No photos uploaded.</span>';
    }

    // AI Summary
    if (cockpit.ai_recommendation) {
      document.getElementById('cockpitAiDecision').innerText = cockpit.ai_recommendation.decision;
      document.getElementById('cockpitAiReasoning').innerText = `"${cockpit.ai_recommendation.reasoning}"`;
      document.getElementById('cockpitClauses').innerHTML = (cockpit.ai_recommendation.clauses_used || [])
        .map((c) => `<span class="bg-purple-100 text-purple-800 text-[10px] px-1.5 py-0.5 rounded font-mono font-bold">${c}</span>`)
        .join('');
    }

    document.getElementById('cockpitCalculatedRefund').innerText = `₹${Number(cockpit.amounts.final_calculated).toFixed(2)}`;
  } catch (err) {
    alert(`Failed to load cockpit: ${err.message}`);
  }
}

// Reviewer Actions (APPROVE / REJECT / REQUEST_INFO)
async function submitReviewAction(action) {
  if (!activeReviewDisputeId) return;

  const notes = document.getElementById('reviewerNotes').value.trim();
  if (notes.length < 5) {
    alert('Please enter reviewer audit notes (minimum 5 characters) before proceeding.');
    return;
  }

  try {
    const res = await fetch(`/api/review/${activeReviewDisputeId}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        reviewer_id: 'REV_AGENT_01',
        reviewer_name: 'Senior Claims Specialist',
        notes,
      }),
    });

    const data = await res.json();

    if (data.success) {
      alert(`Action processed: ${data.action}!`);
      document.getElementById('reviewerNotes').value = '';
      document.getElementById('cockpitContainer').classList.add('hidden');
      document.getElementById('cockpitEmptyState').classList.remove('hidden');
      activeReviewDisputeId = null;
      loadReviewQueue();
      loadOrders();
      loadCustomerDisputes();
      if (currentTrackingId) pollCurrentDispute();
    } else {
      alert(`Action failed: ${data.error}`);
    }
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

// 4. Load Global Audit Logs
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
