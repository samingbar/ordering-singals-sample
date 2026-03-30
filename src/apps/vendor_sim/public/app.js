async function apiFetch(path, init) {
  const response = await fetch(path, init);

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({ error: 'Request failed.' }));
    throw new Error(errorBody.error ?? 'Request failed.');
  }

  return response.json();
}

function formatDate(value) {
  if (!value) {
    return 'N/A';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function buildPayload(type, orderId) {
  if (type === 'ASN_RECEIVED') {
    return { trackingNumber: `TRK-${orderId}` };
  }

  if (type === 'INVOICE_RECEIVED') {
    return { invoiceNumber: `INV-${orderId}` };
  }

  if (type === 'CREDIT_POSTED') {
    return { amount: 25 };
  }

  return { note: `${type} sent from vendor simulator` };
}

async function sendEvent(orderId, type, controls) {
  const payload = controls.payloadInput.value.trim()
    ? JSON.parse(controls.payloadInput.value)
    : buildPayload(type, orderId);

  await apiFetch(`/api/orders/${orderId}/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type,
      payload,
      occurredAt: controls.occurredAtInput.value || undefined,
      delaySeconds: controls.delayInput.value ? Number(controls.delayInput.value) : 0,
    }),
  });
}

async function sendDuplicate(orderId, controls) {
  await apiFetch(`/api/orders/${orderId}/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      duplicateLastEvent: true,
      delaySeconds: controls.delayInput.value ? Number(controls.delayInput.value) : 0,
    }),
  });
}

async function sendScenario(orderId, scenarioId) {
  await apiFetch(`/api/orders/${orderId}/scenarios/${scenarioId}`, {
    method: 'POST',
  });
}

function renderOrders(orders) {
  const container = document.getElementById('vendor-order-list');
  container.innerHTML = '';

  if (!orders.length) {
    container.innerHTML = '<p>No vendor-side orders yet. Create one from the ByteInventory UI.</p>';
    return;
  }

  for (const order of orders) {
    const card = document.createElement('article');
    card.className = 'vendor-card';

    card.innerHTML = `
      <div class="vendor-card-header">
        <div>
          <h3>${order.orderId}</h3>
          <p>${order.vendorName}</p>
        </div>
      </div>
      <div class="vendor-meta">
        <div><strong>Vendor Ref</strong><br />${order.vendorReference}</div>
        <div><strong>Accepted</strong><br />${formatDate(order.acceptedAt)}</div>
        <div><strong>Last Event</strong><br />${order.lastVendorEvent?.type ?? 'None yet'}</div>
        <div><strong>Last Event ID</strong><br />${order.lastVendorEvent?.eventId ?? 'N/A'}</div>
      </div>
      <div class="controls">
        <label>
          Delay Seconds
          <input class="delay-input" type="number" min="0" step="1" value="0" />
        </label>
        <label>
          Custom Occurred Time
          <input class="occurred-at-input" type="datetime-local" />
        </label>
        <label>
          Custom Payload JSON
          <textarea class="payload-input" rows="4" placeholder='{"trackingNumber":"1Z999"}'></textarea>
        </label>
      </div>
      <div class="button-grid">
        <button class="button ghost" data-event="ACKNOWLEDGED">Send Acknowledge</button>
        <button class="button ghost" data-event="CONFIRMED">Send Confirm</button>
        <button class="button ghost" data-event="ASN_RECEIVED">Send ASN</button>
        <button class="button ghost" data-event="INVOICE_RECEIVED">Send Invoice</button>
        <button class="button ghost" data-event="CREDIT_POSTED">Send Credit</button>
        <button class="button danger" data-duplicate="true">Send Duplicate Last Event</button>
      </div>
      <div class="button-grid" style="margin-top: 10px">
        <button class="button subtle" data-scenario="happy-path">Run Happy Path</button>
        <button class="button subtle" data-scenario="out-of-order">Run Out-of-Order</button>
        <button class="button subtle" data-scenario="duplicate-asn">Run Duplicate ASN</button>
      </div>
    `;

    const controls = {
      delayInput: card.querySelector('.delay-input'),
      occurredAtInput: card.querySelector('.occurred-at-input'),
      payloadInput: card.querySelector('.payload-input'),
    };

    for (const button of card.querySelectorAll('[data-event]')) {
      button.addEventListener('click', async () => {
        await sendEvent(order.orderId, button.dataset.event, controls);
        await loadOrders();
      });
    }

    card.querySelector('[data-duplicate="true"]').addEventListener('click', async () => {
      await sendDuplicate(order.orderId, controls);
      await loadOrders();
    });

    for (const button of card.querySelectorAll('[data-scenario]')) {
      button.addEventListener('click', async () => {
        await sendScenario(order.orderId, button.dataset.scenario);
        await loadOrders();
      });
    }

    container.append(card);
  }
}

async function loadOrders() {
  const orders = await apiFetch('/api/orders');
  renderOrders(orders);
}

document.getElementById('refresh-button').addEventListener('click', loadOrders);

setInterval(() => {
  void loadOrders();
}, 4_000);

loadOrders().catch((error) => {
  console.error(error);
  window.alert(error.message ?? 'Failed to load vendor orders.');
});
