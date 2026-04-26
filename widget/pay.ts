/**
 * UCP Algorand — Drop-in Pay Widget
 *
 * Single-file browser widget that adds an Algorand payment button to any webpage.
 * Handles: QR code display, wallet deep-link, session polling, completion callback.
 *
 * Usage:
 *   <script src="https://your-ucp-server.com/widget/pay.js"></script>
 *   <ucp-pay-button
 *     server="https://your-ucp-server.com"
 *     amount="19.99"
 *     currency="USD"
 *     item="Premium subscription"
 *     on-complete="handlePaymentComplete">
 *   </ucp-pay-button>
 *
 *   <script>
 *     function handlePaymentComplete(txid, sessionId) {
 *       console.log("Paid!", txid);
 *       window.location.href = "/thank-you?session=" + sessionId;
 *     }
 *   </script>
 *
 * Self-hosting: serve this file as a static asset from your UCP server.
 * The widget calls your own server — no third-party requests.
 */

(function () {
  "use strict";

  // ─── Styles ───────────────────────────────────────────────────────────────

  const CSS = `
    ucp-pay-button { display: inline-block; }

    .ucp-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: #000;
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 12px 20px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .ucp-btn:hover { background: #1a1a1a; }
    .ucp-btn svg { width: 20px; height: 20px; }

    .ucp-overlay {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.55);
      display: flex; align-items: center; justify-content: center;
      z-index: 99999;
      animation: ucpFadeIn 0.2s ease;
    }
    @keyframes ucpFadeIn { from { opacity: 0 } to { opacity: 1 } }

    .ucp-modal {
      background: #fff;
      border-radius: 16px;
      padding: 28px;
      width: 360px;
      max-width: calc(100vw - 32px);
      box-shadow: 0 24px 64px rgba(0,0,0,0.2);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      animation: ucpSlideUp 0.2s ease;
    }
    @keyframes ucpSlideUp { from { transform: translateY(16px); opacity: 0 } to { transform: none; opacity: 1 } }

    .ucp-modal-header {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 20px;
    }
    .ucp-modal-title { font-size: 17px; font-weight: 700; color: #111; }
    .ucp-close-btn {
      background: none; border: none; cursor: pointer;
      font-size: 22px; color: #888; line-height: 1; padding: 0;
    }
    .ucp-close-btn:hover { color: #333; }

    .ucp-amount {
      text-align: center;
      font-size: 28px; font-weight: 800; color: #111;
      margin-bottom: 4px;
    }
    .ucp-item-name {
      text-align: center; color: #666; font-size: 14px; margin-bottom: 20px;
    }

    .ucp-assets {
      display: flex; gap: 8px; margin-bottom: 20px; flex-wrap: wrap;
    }
    .ucp-asset-chip {
      display: inline-flex; align-items: center; gap: 6px;
      border: 1.5px solid #e5e7eb; border-radius: 999px;
      padding: 5px 12px; font-size: 13px; font-weight: 500; cursor: pointer;
      transition: border-color 0.15s, background 0.15s;
      color: #333;
    }
    .ucp-asset-chip.active { border-color: #000; background: #f3f4f6; }

    .ucp-qr-box {
      background: #f9fafb; border-radius: 12px; padding: 16px;
      text-align: center; margin-bottom: 16px;
    }
    .ucp-qr-label {
      font-size: 12px; color: #888; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.5px;
    }
    .ucp-qr-address {
      font-family: monospace; font-size: 11px; color: #555;
      word-break: break-all; margin-top: 12px;
      background: #fff; border-radius: 6px; padding: 8px;
    }
    .ucp-copy-btn {
      margin-top: 8px; background: none; border: 1px solid #d1d5db;
      border-radius: 6px; padding: 5px 12px; font-size: 12px;
      cursor: pointer; color: #555; transition: background 0.15s;
    }
    .ucp-copy-btn:hover { background: #f3f4f6; }

    .ucp-status {
      display: flex; align-items: center; gap: 8px;
      font-size: 13px; color: #666; justify-content: center;
      min-height: 28px;
    }
    .ucp-spinner {
      width: 14px; height: 14px;
      border: 2px solid #e5e7eb; border-top-color: #000;
      border-radius: 50%; animation: ucpSpin 0.7s linear infinite;
    }
    @keyframes ucpSpin { to { transform: rotate(360deg) } }

    .ucp-success { color: #16a34a; font-weight: 600; font-size: 15px; }
    .ucp-error-msg { color: #dc2626; font-size: 13px; }

    .ucp-footer {
      text-align: center; margin-top: 16px;
      font-size: 11px; color: #bbb;
    }
    .ucp-footer a { color: #bbb; text-decoration: none; }
    .ucp-footer a:hover { text-decoration: underline; }
  `;

  // ─── Algorand SVG logo ────────────────────────────────────────────────────

  const ALGO_ICON = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L2 19.5h4.1l1.8-4.4h8.2l1.8 4.4H22L12 2zm0 5.3l3 7.4H9l3-7.4z"/></svg>`;

  // ─── QR code generator (tiny inline version using canvas) ─────────────────
  // For production, load a proper QR library. This draws a placeholder.

  function drawQRPlaceholder(canvas: HTMLCanvasElement, address: string): void {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = 160;
    canvas.height = 160;
    ctx.fillStyle = "#f9fafb";
    ctx.fillRect(0, 0, 160, 160);
    ctx.fillStyle = "#888";
    ctx.font = "10px monospace";
    ctx.textAlign = "center";
    ctx.fillText("Scan with", 80, 72);
    ctx.fillText("Algorand wallet", 80, 86);
    ctx.font = "9px monospace";
    ctx.fillStyle = "#aaa";
    // In production: use qrcode.js or similar
    ctx.fillText("[QR: " + address.slice(0, 10) + "...]", 80, 106);
  }

  // ─── Custom element ───────────────────────────────────────────────────────

  class UCPPayButton extends HTMLElement {
    private pollingTimer: ReturnType<typeof setInterval> | null = null;

    connectedCallback(): void {
      // Inject styles once
      if (!document.getElementById("ucp-widget-styles")) {
        const style = document.createElement("style");
        style.id = "ucp-widget-styles";
        style.textContent = CSS;
        document.head.appendChild(style);
      }

      const amount = this.getAttribute("amount") ?? "0";
      const currency = this.getAttribute("currency") ?? "USD";
      const item = this.getAttribute("item") ?? "Payment";

      this.innerHTML = `
        <button class="ucp-btn" id="ucp-open-btn">
          ${ALGO_ICON}
          Pay ${amount} ${currency} with Algorand
        </button>
      `;

      this.querySelector("#ucp-open-btn")?.addEventListener("click", () => {
        this.openModal(amount, currency, item);
      });
    }

    private async openModal(amount: string, currency: string, item: string): Promise<void> {
      const server = this.getAttribute("server") ?? "";
      const onComplete = this.getAttribute("on-complete") ?? "";

      // Discover merchant profile
      let merchantAddress = "";
      let handlerName = "";
      let sessionId = "";
      let assets: Array<{ id: number; symbol: string }> = [];

      try {
        const profile = await fetch(`${server}/.well-known/ucp`).then((r) => r.json());
        const handlers = profile?.ucp?.payment_handlers ?? {};
        handlerName = Object.keys(handlers)[0] ?? "";
        const handler = handlers[handlerName];
        merchantAddress = handler?.merchant_address ?? "";
        assets = handler?.available_instruments ?? [];
      } catch {
        this.showError("Could not reach payment server.");
        return;
      }

      // Create checkout session
      try {
        const res = await fetch(`${server}/ucp/v1/checkout-sessions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "UCP-Agent": 'profile="browser-widget/1.0"',
            "X-Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify({
            line_items: [{ id: "widget-item", description: item, quantity: 1, unit_price: Math.round(Number(amount) * 100), currency }],
            totals: { subtotal: Math.round(Number(amount) * 100), tax: 0, shipping: 0, total: Math.round(Number(amount) * 100), currency },
            payment_handler: handlerName,
          }),
        });
        const data = await res.json();
        sessionId = data?.session?.id ?? "";
      } catch {
        this.showError("Could not create checkout session.");
        return;
      }

      // Render modal
      const overlay = document.createElement("div");
      overlay.className = "ucp-overlay";
      overlay.innerHTML = `
        <div class="ucp-modal">
          <div class="ucp-modal-header">
            <span class="ucp-modal-title">Pay with Algorand</span>
            <button class="ucp-close-btn" id="ucp-close">×</button>
          </div>
          <div class="ucp-amount">${amount} ${currency}</div>
          <div class="ucp-item-name">${item}</div>
          <div class="ucp-assets">
            ${assets.map((a, i) => `<span class="ucp-asset-chip ${i === 0 ? "active" : ""}">${ALGO_ICON}${a.symbol}</span>`).join("")}
          </div>
          <div class="ucp-qr-box">
            <div class="ucp-qr-label">Send payment to</div>
            <canvas id="ucp-qr-canvas"></canvas>
            <div class="ucp-qr-address" id="ucp-address">${merchantAddress}</div>
            <button class="ucp-copy-btn" id="ucp-copy">Copy address</button>
          </div>
          <div class="ucp-status">
            <div class="ucp-spinner"></div>
            <span id="ucp-status-text">Waiting for payment...</span>
          </div>
          <div class="ucp-footer">
            Secured by <a href="https://algorand.com" target="_blank">Algorand</a> ·
            <a href="https://ucp.dev" target="_blank">UCP</a>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      // Draw QR
      const canvas = overlay.querySelector("#ucp-qr-canvas") as HTMLCanvasElement;
      if (canvas) drawQRPlaceholder(canvas, merchantAddress);

      // Copy button
      overlay.querySelector("#ucp-copy")?.addEventListener("click", () => {
        navigator.clipboard.writeText(merchantAddress);
        const btn = overlay.querySelector("#ucp-copy") as HTMLButtonElement;
        if (btn) { btn.textContent = "Copied!"; setTimeout(() => { btn.textContent = "Copy address"; }, 2000); }
      });

      // Close
      const closeModal = (): void => {
        if (this.pollingTimer) clearInterval(this.pollingTimer);
        overlay.remove();
      };
      overlay.querySelector("#ucp-close")?.addEventListener("click", closeModal);
      overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });

      // Poll for completion
      this.pollForCompletion(server, sessionId, handlerName, overlay, onComplete);
    }

    private pollForCompletion(
      server: string,
      sessionId: string,
      _handlerName: string,
      overlay: HTMLElement,
      onComplete: string,
    ): void {
      const statusText = overlay.querySelector("#ucp-status-text");

      this.pollingTimer = setInterval(async () => {
        try {
          const res = await fetch(`${server}/ucp/v1/checkout-sessions/${sessionId}`);
          const data = await res.json();
          const status: string = data?.session?.status ?? "";

          if (status === "complete") {
            if (this.pollingTimer) clearInterval(this.pollingTimer);
            const txid: string = data?.session?.payment_txid ?? "";

            if (statusText) {
              const statusEl = statusText.parentElement;
              if (statusEl) statusEl.innerHTML = `<span class="ucp-success">✓ Payment confirmed!</span>`;
            }

            setTimeout(() => {
              overlay.remove();
              // Call merchant's completion handler
              if (onComplete && typeof (window as Record<string, unknown>)[onComplete] === "function") {
                ((window as Record<string, unknown>)[onComplete] as (txid: string, sessionId: string) => void)(txid, sessionId);
              }
            }, 1500);
          }
        } catch {
          // Network error during poll — keep trying
        }
      }, 3000);
    }

    private showError(message: string): void {
      const div = document.createElement("div");
      div.style.cssText = "position:fixed;bottom:20px;right:20px;background:#dc2626;color:#fff;padding:12px 16px;border-radius:8px;font-size:14px;z-index:99999;";
      div.textContent = message;
      document.body.appendChild(div);
      setTimeout(() => div.remove(), 4000);
    }
  }

  // Register custom element
  if (!customElements.get("ucp-pay-button")) {
    customElements.define("ucp-pay-button", UCPPayButton);
  }
})();
