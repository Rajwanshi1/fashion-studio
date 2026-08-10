# WhatsApp invoice delivery — one-time Meta setup

The admin dashboard can send each order's PDF invoice straight to the customer's
WhatsApp (`POST /api/admin/orders/:id/invoice/send`). Delivery goes through the
**Meta WhatsApp Business Cloud API**; until the steps below are done, the
endpoint answers 503 and the admin UI toasts "WhatsApp sending is not
configured". Everything else (invoice PDF preview/download) works without it.

## What the code expects

| Piece | Where | Value |
| --- | --- | --- |
| Access token | Secrets Manager `fashion/prod/whatsapp-access-token` | System-user token with `whatsapp_business_messaging` + `whatsapp_business_management` |
| Phone Number ID | SSM param `/fashion/prod/whatsapp-phone-number-id` | The Cloud API **Phone Number ID** (a long numeric id — not the phone number) |
| Provider switch | CloudFormation param `WhatsAppProvider` | `meta` |
| Template | Meta Business Manager | Name `order_invoice`, language **English**, category **UTILITY** — must match `INVOICE_TEMPLATE` in `backend/src/services/whatsapp.provider.ts` |

Template to submit (header type **Document**, three body variables):

> Hello {{1}}! Thank you for shopping with Tanvi Agnihotry. Your bill for order
> {{2}} ({{3}}) is attached. We will keep you posted as your outfit progresses.
> — Team TA

Sample values for the review form: `Aanya` / `TA-2026-00042` / `₹1,84,000`.
Keep the wording strictly transactional; marketing-flavoured copy gets the
template reclassified as MARKETING (pricier, and users can opt out).

**Coupling note:** the template name/language and the three body variables are
mirrored in code. Changing the copy in Meta needs re-approval; adding/removing
variables needs a code change in `whatsapp.provider.ts` too.

## Setup steps

1. **Verify the business** in [Meta Business Manager](https://business.facebook.com)
   (Durga Trishakti Creations). Verification can take days — start early.
2. **Create a Meta developer app** (developers.facebook.com) → add the
   **WhatsApp** product. This creates/links a WhatsApp Business Account (WABA).
3. **Pick the phone number — decision needed.** Registering a number on the
   Cloud API **disconnects it from the WhatsApp Business app** on the shop
   phone (coexistence is limited/beta). The store number +91 8118892523 is used
   daily in the app, so the recommendation is a **separate dedicated number**
   for automated invoice sends. The store number stays printed on the PDF
   header either way.
4. **Register the number** under the WABA and note its **Phone Number ID**
   (WhatsApp → API Setup shows it under the number).
5. **Create a system user** (Business Settings → Users → System users, admin
   role) → **Generate token** with no expiry, scopes
   `whatsapp_business_messaging` and `whatsapp_business_management`.
6. **Submit the `order_invoice` template** (WhatsApp Manager → Message
   templates → Create): category Utility, language English, header Document,
   body as above. Wait for approval (minutes to a day).
7. **Attach a payment method** to the WABA (Billing) — utility template
   messages in India carry a small per-message fee.
8. **Provision the deployment:**

   ```sh
   aws secretsmanager create-secret \
     --name fashion/prod/whatsapp-access-token \
     --secret-string '<system-user token>' --region ap-south-1
   aws ssm put-parameter \
     --name /fashion/prod/whatsapp-phone-number-id \
     --type String --value '<phone number id>' --region ap-south-1
   ```

9. **Stack update + instance refresh** with `WhatsAppProvider=meta` (the
   user-data reads the secret at boot, so a refresh is required regardless).
   Boot log should say `whatsapp: invoice sends via the Meta Cloud API`.
10. **Smoke test:** open a recent order in the admin Orders page and send the
    invoice to your own number before using it with customers.

## Operations

- **Token rotation:** update the secret, then run an instance refresh — the
  token is read once at boot (same behaviour as the Anthropic key).
- **Failures surface in the admin UI**: a failed send toasts Meta's error
  message (bad token → 401 text, unapproved template → "Template name does not
  exist", etc.) and does not stamp "Invoice sent".
- **Local dev:** the compose file defaults to `WHATSAPP_PROVIDER=console`,
  which logs `[whatsapp] would send …` instead of delivering. To smoke-test
  real delivery locally, put the `meta` provider + both creds in the root
  `.env`.
