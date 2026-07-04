/* ============================================================
   TANVI AGNIHOTRY — Slide-out mini-bag drawer (shared)
   Include on any page: <script src="cart-drawer.js"></script>
   Any element with class "bag" or [data-open-bag] opens it.
   ============================================================ */
(function () {
  const CSS = `
  .cd-backdrop { position: fixed; inset: 0; background: rgba(35,43,38,0.42); opacity: 0; visibility: hidden; transition: opacity 320ms cubic-bezier(.22,1,.36,1); z-index: 300; }
  .cd-backdrop.open { opacity: 1; visibility: visible; }
  .cd-drawer { position: fixed; top: 0; right: 0; height: 100%; width: min(420px, 92vw); background: var(--paper); z-index: 310; display: flex; flex-direction: column; transform: translateX(100%); transition: transform 380ms cubic-bezier(.22,1,.36,1); box-shadow: -30px 0 60px -30px rgba(35,43,38,0.5); }
  .cd-drawer.open { transform: none; }
  .cd-head { display: flex; align-items: center; justify-content: space-between; padding: 1.5rem 1.6rem; border-bottom: 1px solid var(--hairline); }
  .cd-head h3 { font-family: var(--serif-display); font-size: 1.25rem; }
  .cd-head .x { background: none; border: 0; cursor: pointer; font-size: 1.3rem; color: var(--ink); line-height: 1; }
  .cd-head .x:hover { color: var(--gold); }
  .cd-note { background: var(--celadon-50); color: var(--ink-soft); font-size: 0.66rem; letter-spacing: var(--track-wide); text-transform: uppercase; text-align: center; padding: 0.7rem; border-bottom: 1px solid var(--hairline); }
  .cd-items { flex: 1; overflow-y: auto; padding: 0.5rem 1.6rem; }
  .cd-item { display: grid; grid-template-columns: 70px 1fr auto; gap: 1rem; padding: 1.3rem 0; border-bottom: 1px solid var(--hairline); }
  .cd-item image-slot { width: 70px; aspect-ratio: 3/4; }
  .cd-item .nm { font-family: var(--serif-display); font-size: 0.98rem; line-height: 1.2; }
  .cd-item .at { font-size: 0.7rem; color: var(--fg-muted); margin-top: 0.35rem; }
  .cd-item .rm { font-size: 0.6rem; letter-spacing: var(--track-wide); text-transform: uppercase; color: var(--fg-muted); background: none; border: 0; cursor: pointer; padding: 0; margin-top: 0.6rem; border-bottom: 1px solid var(--hairline); }
  .cd-item .rm:hover { color: var(--gold); }
  .cd-item .pr { font-family: var(--serif-soft); font-size: 1.05rem; color: var(--forest-700); white-space: nowrap; }
  .cd-foot { padding: 1.4rem 1.6rem 1.7rem; border-top: 1px solid var(--hairline); }
  .cd-sub { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 0.3rem; }
  .cd-sub .l { font-size: 0.74rem; letter-spacing: var(--track-wide); text-transform: uppercase; }
  .cd-sub .v { font-family: var(--serif-soft); font-size: 1.5rem; color: var(--forest-700); }
  .cd-ship { font-size: 0.68rem; color: var(--fg-muted); margin-bottom: 1.1rem; }
  .cd-actions { display: grid; gap: 0.6rem; }
  .cd-actions a { text-decoration: none; }
  `;
  const ITEMS = [
    { id: 1, nm: 'Sage Sequin Jacket Lehenga', at: 'Sage · Size S', pr: 184000, ph: 'Item 1' },
    { id: 2, nm: 'Pistachio Threadwork Anarkali', at: 'Pistachio · Size M', pr: 142000, ph: 'Item 2' },
  ];
  const fmt = n => '₹' + n.toLocaleString('en-IN');

  function build() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const backdrop = document.createElement('div');
    backdrop.className = 'cd-backdrop';

    const drawer = document.createElement('aside');
    drawer.className = 'cd-drawer';
    drawer.setAttribute('aria-label', 'Shopping bag');

    const sub = ITEMS.reduce((a, i) => a + i.pr, 0);
    drawer.innerHTML = `
      <div class="cd-head"><h3>Your Bag</h3><button class="x" aria-label="Close">✕</button></div>
      <div class="cd-note">Complimentary shipping · Made to order</div>
      <div class="cd-items">
        ${ITEMS.map(i => `
          <div class="cd-item" data-id="${i.id}">
            <image-slot id="cd-img-${i.id}" placeholder="${i.ph}"></image-slot>
            <div>
              <div class="nm">${i.nm}</div>
              <div class="at">${i.at} · Qty 1</div>
              <button class="rm">Remove</button>
            </div>
            <div class="pr">${fmt(i.pr)}</div>
          </div>`).join('')}
      </div>
      <div class="cd-foot">
        <div class="cd-sub"><span class="l">Subtotal</span><span class="v cd-subval">${fmt(sub)}</span></div>
        <div class="cd-ship">Shipping &amp; duties calculated at checkout</div>
        <div class="cd-actions">
          <a class="btn-buy gold" href="Checkout.html">Checkout</a>
          <a class="btn-outline" href="Cart.html">View Full Bag</a>
        </div>
      </div>`;

    document.body.appendChild(backdrop);
    document.body.appendChild(drawer);

    const open = () => { backdrop.classList.add('open'); drawer.classList.add('open'); document.body.style.overflow = 'hidden'; };
    const close = () => { backdrop.classList.remove('open'); drawer.classList.remove('open'); document.body.style.overflow = ''; };

    backdrop.addEventListener('click', close);
    drawer.querySelector('.x').addEventListener('click', close);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

    function recalc() {
      let s = 0;
      drawer.querySelectorAll('.cd-item').forEach(el => {
        const id = +el.dataset.id;
        const it = ITEMS.find(x => x.id === id);
        if (it) s += it.pr;
      });
      drawer.querySelector('.cd-subval').textContent = fmt(s);
    }
    drawer.querySelectorAll('.cd-item .rm').forEach(btn => {
      btn.addEventListener('click', () => {
        const row = btn.closest('.cd-item');
        row.style.transition = 'opacity .25s, transform .25s';
        row.style.opacity = '0'; row.style.transform = 'translateX(10px)';
        setTimeout(() => { row.remove(); recalc(); }, 250);
      });
    });

    // wire openers
    document.querySelectorAll('.bag, [data-open-bag]').forEach(el => {
      el.addEventListener('click', e => { e.preventDefault(); open(); });
    });
    window.openCartDrawer = open;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
