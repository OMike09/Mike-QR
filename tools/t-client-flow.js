const B = process.env.BASE || 'http://127.0.0.1:4931';
const ck = (r) => (r.headers.getSetCookie ? r.headers.getSetCookie() : []).map((l) => l.split(';')[0]).filter((p) => !p.endsWith('=')).join('; ');
const call = async (m, p, b, c) => {
  const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json', ...(c ? { cookie: c } : {}) }, body: (b && m !== 'GET') ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (_) {} return { s: r.status, j, c: ck(r) };
};
(async () => {
  let r = await call('POST', '/api/auth/login', { username: 'admin', password: 'admin1234' }); const admin = r.c;
  const tag = Date.now().toString(36).slice(-5);
  const phone = '+22507' + String(Math.floor(Math.random() * 90000000) + 10000000);

  // --- marchand + boutique publiée + produit
  let c = await call('POST', '/api/admin/merchants', { username: 'cl' + tag, displayName: 'Chez Awa', phone: '+22507001' + String(Math.floor(Math.random() * 9000) + 1000), password: '314159' }, admin);
  let l = await call('POST', '/api/merchant/auth/login', { username: 'cl' + tag, password: '314159' });
  await call('POST', '/api/merchant/auth/change-password', { currentPassword: '314159', password: '271828', confirmPassword: '271828' }, l.c);
  l = await call('POST', '/api/merchant/auth/login', { username: 'cl' + tag, password: '271828' }); const mck = l.c;
  await call('PUT', '/api/merchant/store', { name: 'Chez Awa ' + tag, isPublished: true, acceptsOrders: true }, mck);
  let shop = await call('GET', '/api/merchant/store', null, mck);
  const slug = shop.j?.data?.slug;
  const prod = await call('POST', '/api/merchant/products', { name: 'Bière 65cl', priceXof: 1500, stockQuantity: 100, trackStock: true }, mck);
  const product = prod.j?.data;
  console.log('boutique:', slug, '| produit:', prod.s, product?.name);

  // --- client : code
  r = await call('POST', '/api/client/auth/request-code', { phone });
  const code = r.j?.data?.devCode;
  r = await call('POST', '/api/client/auth/verify-code', { phone, code });
  const cc = r.c;
  console.log('client connecté:', r.s, '| commandes rattachées:', r.j?.data?.linkedOrders);

  // --- commande publique (comme depuis le QR)
  const order = await call('POST', `/api/public/shops/${slug}/orders`, {
    clientRequestId: ('req' + tag + 'a').padEnd(24, 'x'), customerName: 'Client Test', customerPhone: phone,
    deliveryAddress: 'Sur place', orderMode: 'pickup',
    items: [{ productId: product.id, quantity: 2 }],
  });
  console.log('commande publique:', order.s, order.j?.data?.order?.reference, order.s >= 400 ? JSON.stringify(order.j).slice(0, 160) : '');

  // --- le client retrouve sa commande
  r = await call('GET', '/api/client/orders', null, cc);
  console.log('mes commandes:', r.s, 'nombre:', r.j?.data?.length, '| référence:', r.j?.data?.[0]?.reference);
  const reference = r.j?.data?.[0]?.reference;

  // --- statut changé par le marchand -> notification client
  // L'identifiant technique n'est pas exposé sur la réponse publique : on le lit dans la liste
  // du client (qui la renvoie), sinon dans la liste des commandes du marchand.
  const orderId = r.j?.data?.[0]?.id || (await call('GET', '/api/merchant/orders', null, mck)).j?.data?.find((o) => o.reference === reference)?.id;
  if (!orderId) throw new Error('identifiant de commande introuvable : impossible de tester l’acceptation marchand');
  const st = await call('POST', `/api/merchant/orders/${orderId}/status`, { status: 'confirmed' }, mck);
  console.log('marchand accepte:', st.s, st.s >= 400 ? JSON.stringify(st.j).slice(0, 140) : (st.j?.data?.order?.status || ''));
  r = await call('GET', '/api/client/notifications', null, cc);
  console.log('notifications client:', r.s, (r.j?.data || []).map((n) => `${n.type}:${n.title}`).join(' | '));

  // --- annulation d'une commande encore en attente
  const order2 = await call('POST', `/api/public/shops/${slug}/orders`, {
    clientRequestId: ('req' + tag + 'b').padEnd(24, 'x'), customerName: 'Client Test', customerPhone: phone,
    deliveryAddress: 'Sur place', orderMode: 'pickup', items: [{ productId: product.id, quantity: 1 }],
  });
  const ref2 = order2.j?.data?.order?.reference;
  const cancel = await call('POST', `/api/client/orders/${ref2}/cancel`, { requestId: ('cancel' + tag + '0001').padEnd(26, 'y'), reason: 'Changement d’avis' }, cc);
  console.log('annulation en attente ->', cancel.s, JSON.stringify(cancel.j?.data));
  const cancel2 = await call('POST', `/api/client/orders/${ref2}/cancel`, { requestId: ('cancel' + tag + '0001').padEnd(26, 'y'), reason: 'Changement d’avis' }, cc);
  console.log('rejeu même demande ->', cancel2.s, 'idempotent:', cancel2.j?.data?.idempotent);
  r = await call('GET', `/api/client/orders/${ref2}`, null, cc);
  console.log('statut après annulation:', r.j?.data?.status);

  // --- annulation d'une commande déjà acceptée -> demande soumise
  const cancel3 = await call('POST', `/api/client/orders/${reference}/cancel`, { requestId: ('cancel' + tag + '0002').padEnd(26, 'y'), reason: 'Retard' }, cc);
  console.log('annulation d’une commande acceptée ->', cancel3.s, JSON.stringify(cancel3.j?.data));

  // --- cloisonnement : un autre client ne voit rien
  const otherPhone = '+22507' + String(Math.floor(Math.random() * 90000000) + 10000000);
  const other = await call('POST', '/api/client/auth/request-code', { phone: otherPhone });
  const other2 = await call('POST', '/api/client/auth/verify-code', { phone: otherPhone, code: other.j?.data?.devCode });
  const pierre = await call('GET', '/api/client/orders', null, other2.c);
  console.log('autre client -> commandes visibles:', pierre.j?.data?.length);
  const steal = await call('GET', `/api/client/orders/${reference}`, null, other2.c);
  console.log('autre client tente de lire une commande ->', steal.s, steal.j?.error);

  // --- scan client
  const scan = await call('POST', '/api/client/scan', { target: `${B}/shop/${slug}` }, cc);
  console.log('scan client ->', scan.s, JSON.stringify(scan.j?.data));
  r = await call('GET', '/api/client/stores', null, cc);
  console.log('boutiques visitées:', r.s, (r.j?.data || []).map((s) => s.name).join(', '));

  // --- consignation liée au numéro du client puis visible dans son espace
  let bt = await call('POST', '/api/merchant/consignment-settings/bottle-types', { label: 'Bouteille 65cl', unitValueXof: 150 }, mck);
  const dep = await call('POST', '/api/merchant/consignments', { kind: 'bottle', customerName: 'Client Test', customerPhone: phone, bottleTypeId: bt.j?.data?.id, quantity: 5, idempotencyKey: 'cli-' + tag }, mck);
  console.log('consignation marchand ->', dep.s, dep.j?.data?.consignment?.reference, 'code:', dep.j?.data?.code);
  r = await call('GET', '/api/client/consignments', null, cc);
  console.log('consignations du client:', r.s, (r.j?.data || []).map((x) => `${x.reference}:${x.balanceQuantity}`).join(' | '));
  r = await call('GET', '/api/client/notifications', null, cc);
  console.log('notifications après consignation:', (r.j?.data || []).map((n) => n.type).join(' | '));

  // --- le client retrouve la consignation par son code, dans SA boutique
  const found = await call('POST', '/api/client/consignments/lookup', { storeSlug: slug, code: dep.j?.data?.code }, cc);
  console.log('recherche par code ->', found.s, found.j?.data?.reference, 'solde', found.j?.data?.balanceQuantity);
  const wrong = await call('POST', '/api/client/consignments/lookup', { storeSlug: slug, code: 'AAAAAA' }, cc);
  console.log('code faux ->', wrong.s, wrong.j?.error);
})();
