const lifecycleSteps = [
  { key: 'submitted', label: 'Submitted' },
  { key: 'acknowledged', label: 'Acknowledged', optional: true },
  { key: 'confirmed', label: 'Confirmed', optional: true },
  { key: 'asnReceived', label: 'ASN', optional: true },
  { key: 'markedReceived', label: 'Received' },
  { key: 'invoiceReceived', label: 'Invoiced' },
  { key: 'reconciled', label: 'Reconciled' },
];

const appState = {
  orders: [],
  selectedOrderId: null,
  selectedSnapshot: null,
  pollHandle: null,
};

function formatDate(value) {
  if (!value) {
    return 'N/A';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatCurrency(value, currency) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
  }).format(value);
}

function totalOrderValue(order) {
  return order.lineItems.reduce((total, lineItem) => {
    return total + lineItem.quantity * lineItem.unitPrice;
  }, 0);
}

async function apiFetch(path, init) {
  const response = await fetch(path, init);

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({ error: 'Request failed.' }));
    throw new Error(errorBody.error ?? 'Request failed.');
  }

  return response.json();
}

function createLineItemRow(defaults = {}) {
  const row = document.createElement('div');
  row.className = 'line-item-row';
  row.innerHTML = `
    <label>SKU<input name="sku" type="text" value="${defaults.sku ?? ''}" required /></label>
    <label>Description<input name="description" type="text" value="${defaults.description ?? ''}" required /></label>
    <label>Qty<input name="quantity" type="number" min="1" step="1" value="${defaults.quantity ?? 1}" required /></label>
    <label>Unit Price<input name="unitPrice" type="number" min="0" step="0.01" value="${defaults.unitPrice ?? 0}" required /></label>
    <button type="button" class="button subtle remove-line-item-button">Remove</button>
  `;
  row.querySelector('.remove-line-item-button').addEventListener('click', () => {
    row.remove();
  });
  return row;
}

function renderOrderList() {
  const container = document.getElementById('order-list');
  container.innerHTML = '';

  if (appState.orders.length === 0) {
    container.innerHTML = '<p class="muted">No orders yet. Create one or seed the demo.</p>';
    return;
  }

  for (const order of appState.orders) {
    const card = document.createElement('article');
    card.className = `order-card ${order.orderId === appState.selectedOrderId ? 'active' : ''}`;
    card.innerHTML = `
      <div class="order-card-header">
        <div>
          <h3>${order.orderId}</h3>
          <p class="muted">${order.vendorName}</p>
        </div>
        <span class="status-chip">${order.currentStatus}</span>
      </div>
      <div class="order-card-meta">
        <div>
          <strong>Ship Date</strong>
          <div>${order.requestedShipDate}</div>
        </div>
        <div>
          <strong>Exceptions</strong>
          <div>${order.exceptionCount}</div>
        </div>
        <div>
          <strong>Vendor Ref</strong>
          <div>${order.vendorReference ?? 'Pending'}</div>
        </div>
        <div>
          <strong>Updated</strong>
          <div>${formatDate(order.lastUpdatedAt)}</div>
        </div>
      </div>
    `;

    card.addEventListener('click', () => {
      appState.selectedOrderId = order.orderId;
      window.location.hash = `#order/${order.orderId}`;
      loadOrderDetail();
      renderOrderList();
    });

    container.append(card);
  }
}

function renderLifecycleRail(snapshot) {
  const rail = document.getElementById('lifecycle-rail');
  rail.innerHTML = '';

  for (const step of lifecycleSteps) {
    const node = document.createElement('div');
    node.className = `lifecycle-step ${snapshot[step.key] ? 'complete' : ''} ${step.optional ? 'optional' : ''}`;
    node.innerHTML = `
      <strong>${step.label}</strong>
      <div>${snapshot[step.key] ? 'Captured' : step.optional ? 'Optional' : 'Pending'}</div>
    `;
    rail.append(node);
  }
}

function renderOrderSummary(snapshot) {
  const summary = document.getElementById('order-summary');
  summary.innerHTML = `
    <dl class="meta-list">
      <dt>Vendor</dt>
      <dd>${snapshot.vendorName}</dd>
      <dt>Requested Ship Date</dt>
      <dd>${snapshot.order.requestedShipDate}</dd>
      <dt>Vendor Reference</dt>
      <dd>${snapshot.vendorReference ?? 'Pending vendor acceptance'}</dd>
      <dt>Total Value</dt>
      <dd>${formatCurrency(totalOrderValue(snapshot.order), snapshot.order.currency)}</dd>
      <dt>Line Items</dt>
      <dd>${snapshot.order.lineItems
        .map((lineItem) => `${lineItem.quantity} × ${lineItem.description}`)
        .join('<br />')}</dd>
      <dt>Last Update</dt>
      <dd>${formatDate(snapshot.lastUpdatedAt)}</dd>
    </dl>
  `;
}

function renderExceptions(snapshot) {
  const exceptionList = document.getElementById('exception-list');
  const exceptionChip = document.getElementById('detail-exception-chip');

  if (!snapshot.openExceptions.length) {
    exceptionList.innerHTML = '<p class="muted">No open operational exceptions.</p>';
    exceptionChip.classList.add('hidden');
    exceptionChip.textContent = '';
    return;
  }

  exceptionChip.classList.remove('hidden');
  exceptionChip.textContent = `${snapshot.openExceptions.length} exception${snapshot.openExceptions.length > 1 ? 's' : ''}`;
  exceptionList.innerHTML = '';

  for (const exception of snapshot.openExceptions) {
    const card = document.createElement('article');
    card.className = 'exception-card';
    card.innerHTML = `
      <strong>${exception.message}</strong>
      <div class="muted">${exception.code} • opened ${formatDate(exception.openedAt)}</div>
    `;
    exceptionList.append(card);
  }
}

function renderTimeline(snapshot) {
  const timeline = document.getElementById('timeline');
  timeline.innerHTML = '';

  const events = [...snapshot.timeline].reverse();

  for (const event of events) {
    const card = document.createElement('article');
    card.className = 'timeline-card';
    const warnings = event.warnings?.length
      ? `<div>${event.warnings.map((warning) => `<span class="warning-chip">${warning}</span>`).join(' ')}</div>`
      : '';

    card.innerHTML = `
      <div class="timeline-card-header">
        <div>
          <strong>${event.type.replaceAll('_', ' ')}</strong>
          <div class="muted">${event.source}${event.actor ? ` • ${event.actor}` : ''}</div>
        </div>
        <div class="muted">${formatDate(event.receivedAt)}</div>
      </div>
      <div class="timeline-card-body">
        ${warnings}
        <div><strong>Occurred:</strong> ${formatDate(event.occurredAt)}</div>
        <div><strong>Received:</strong> ${formatDate(event.receivedAt)}</div>
        <pre class="timeline-payload">${JSON.stringify(event.payload ?? {}, null, 2)}</pre>
      </div>
    `;
    timeline.append(card);
  }
}

function renderOrderDetail(snapshot) {
  const detail = document.getElementById('order-detail');
  const empty = document.getElementById('order-detail-empty');

  if (!snapshot) {
    detail.classList.add('hidden');
    empty.classList.remove('hidden');
    return;
  }

  detail.classList.remove('hidden');
  empty.classList.add('hidden');
  document.getElementById('detail-order-title').textContent = snapshot.orderId;
  document.getElementById('detail-order-subtitle').textContent =
    `${snapshot.vendorName} • requested ship ${snapshot.order.requestedShipDate}`;
  document.getElementById('detail-status-chip').textContent = snapshot.currentStatus;
  renderLifecycleRail(snapshot);
  renderOrderSummary(snapshot);
  renderExceptions(snapshot);
  renderTimeline(snapshot);
}

async function loadOrders() {
  appState.orders = await apiFetch('/api/orders');

  if (!appState.selectedOrderId && appState.orders.length > 0) {
    const hashMatch = window.location.hash.match(/#order\/(.+)$/);
    appState.selectedOrderId = hashMatch?.[1] ?? appState.orders[0].orderId;
  }

  renderOrderList();
}

async function loadOrderDetail() {
  if (!appState.selectedOrderId) {
    renderOrderDetail(null);
    return;
  }

  try {
    appState.selectedSnapshot = await apiFetch(`/api/orders/${appState.selectedOrderId}`);
    renderOrderDetail(appState.selectedSnapshot);
    renderOrderList();
  } catch (error) {
    console.error(error);
  }
}

async function submitManualEvent(type, payloadBuilder) {
  if (!appState.selectedOrderId || !appState.selectedSnapshot) {
    return;
  }

  const payload = payloadBuilder();

  await apiFetch(`/api/orders/${appState.selectedOrderId}/user-events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  await loadOrderDetail();
}

function setupActions() {
  document.getElementById('refresh-orders-button').addEventListener('click', async () => {
    await loadOrders();
    await loadOrderDetail();
  });

  document.getElementById('seed-demo-button').addEventListener('click', async () => {
    const result = await apiFetch('/api/demo/seed', {
      method: 'POST',
    });

    appState.selectedOrderId = result.orderIds[0] ?? null;
    await loadOrders();
    await loadOrderDetail();
  });

  document.getElementById('mark-received-button').addEventListener('click', async () => {
    await submitManualEvent('MARKED_RECEIVED', () => ({
      type: 'MARKED_RECEIVED',
      actor: 'warehouse@byteinventory.demo',
      payload: {
        receivedQuantity: appState.selectedSnapshot.order.lineItems.reduce((total, lineItem) => {
          return total + lineItem.quantity;
        }, 0),
      },
    }));
  });

  document.getElementById('add-invoice-button').addEventListener('click', async () => {
    const amount = totalOrderValue(appState.selectedSnapshot.order);

    await submitManualEvent('INVOICE_RECEIVED', () => ({
      type: 'INVOICE_RECEIVED',
      actor: 'ap@byteinventory.demo',
      payload: {
        invoiceNumber: `INV-${appState.selectedSnapshot.orderId}`,
        amount,
      },
    }));
  });

  document.getElementById('record-credit-button').addEventListener('click', async () => {
    const amount = window.prompt('Credit amount', '25.00');

    if (!amount) {
      return;
    }

    await submitManualEvent('CREDIT_POSTED', () => ({
      type: 'CREDIT_POSTED',
      actor: 'ap@byteinventory.demo',
      payload: {
        amount: Number(amount),
      },
    }));
  });

  document.getElementById('mark-reconciled-button').addEventListener('click', async () => {
    await submitManualEvent('RECONCILED', () => ({
      type: 'RECONCILED',
      actor: 'controller@byteinventory.demo',
      payload: {
        note: 'Reconciled in demo UI',
      },
    }));
  });

  document.getElementById('cancel-order-button').addEventListener('click', async () => {
    if (!appState.selectedOrderId) {
      return;
    }

    const reason = window.prompt('Cancellation reason', 'Canceled for demo');

    if (!reason) {
      return;
    }

    await apiFetch(`/api/orders/${appState.selectedOrderId}/cancel`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        reason,
        actor: 'buyer@byteinventory.demo',
      }),
    });

    await loadOrderDetail();
  });
}

function setupCreateOrderForm() {
  const lineItems = document.getElementById('line-items');
  const form = document.getElementById('create-order-form');
  const addLineItemButton = document.getElementById('add-line-item-button');

  lineItems.append(
    createLineItemRow({
      sku: 'GLOVES-001',
      description: 'Nitrile Gloves',
      quantity: 10,
      unitPrice: 24.99,
    }),
  );

  addLineItemButton.addEventListener('click', () => {
    lineItems.append(createLineItemRow());
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const formData = new FormData(form);
    const rows = [...lineItems.querySelectorAll('.line-item-row')];
    const lineItemsPayload = rows.map((row) => ({
      sku: row.querySelector('input[name="sku"]').value,
      description: row.querySelector('input[name="description"]').value,
      quantity: Number(row.querySelector('input[name="quantity"]').value),
      unitPrice: Number(row.querySelector('input[name="unitPrice"]').value),
    }));

    const result = await apiFetch('/api/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        vendorName: formData.get('vendorName'),
        requestedShipDate: formData.get('requestedShipDate'),
        notes: formData.get('notes'),
        lineItems: lineItemsPayload,
      }),
    });

    appState.selectedOrderId = result.orderId;
    form.reset();
    lineItems.innerHTML = '';
    lineItems.append(createLineItemRow());
    window.location.hash = `#order/${result.orderId}`;
    await loadOrders();
    await loadOrderDetail();
  });
}

function startPolling() {
  clearInterval(appState.pollHandle);
  appState.pollHandle = setInterval(async () => {
    await loadOrders();
    await loadOrderDetail();
  }, 4_000);
}

async function boot() {
  setupCreateOrderForm();
  setupActions();
  await loadOrders();
  await loadOrderDetail();
  startPolling();
}

window.addEventListener('hashchange', async () => {
  const hashMatch = window.location.hash.match(/#order\/(.+)$/);
  appState.selectedOrderId = hashMatch?.[1] ?? appState.selectedOrderId;
  await loadOrderDetail();
});

boot().catch((error) => {
  console.error(error);
  window.alert(error.message ?? 'Failed to load the demo UI.');
});
