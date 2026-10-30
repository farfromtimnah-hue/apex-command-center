# Business System audit: every place that lists, counts or sums across clients

Date: 2026-10-30. Worker: `worker/index.js`. Tests: `~/code-reports/business-system-harness-results.txt`.

## The rule

`clients.plan` is `consulting` or `business_system`. Staff list and report endpoints take `?plan=`.

- Missing or unknown `?plan=`: `consulting`. An old cached page keeps today's numbers.
- `?plan=all`: both plans. Used only by screens that must serve both (billing client picker, developer preview pickers).
- Some endpoints are shared with billing or with the booking calendar. For those the filter is opt-in (no `?plan=` means every row, as before). This is a deliberate exception to the default rule and is marked **opt-in** below.
- The staff pages send the side through one helper, `window.apexSidePath` in `nav.js`, called from each page's `apiFetch`.

Decision codes: **FILTER** = filtered by plan. **CONSULTING ONLY** = automation or report meant only for consulting clients. **BOTH** = left as it is because it must serve both plans.

## A. Staff lists, reports and dashboard numbers (FILTER)

| Function | Reads | Decision | Reason |
|---|---|---|---|
| `handleGetClients` | clients | FILTER (`plan`, default consulting; `all` allowed) | Feeds the Clients, Dashboard and Client analytics pages and many pickers. Now also returns `plan`, `split_mode`, `monthly_amount_cents`. |
| `handleGetClient` (single) | clients | LEAVE, returns plan fields | Single-client lookup. The profile needs the plan fields. |
| `handleGetClientEngagementDates` | clients, packages, sessions | FILTER | Calendar helper for consulting packages. |
| `handleGetClientsNeedingReview` | clients | FILTER | Consulting contract review queue. |
| `handleGetClientResourcesPending` | client_resources JOIN clients | FILTER | Clients page strip. |
| `handleGetClientResourcesProgress` | client_resources | FILTER (client subquery) | Dashboard resources bar. |
| `handleGetSalesGrowthRanking` | clients, client_growth_entries | FILTER | Sales page. |
| `handleGetLeaderboard` | clients, daily entries | FILTER | Sales page. |
| `handleGetClientsAverage` | clients, daily entries | FILTER | Client analytics. Average, sample size and the 3-client suppression all use the same filtered list. |
| `handleGetPipelineGap` | client_daily_entries, gm_leads, clients | FILTER (names query) | Staff view of the pipeline gap. |
| `handleGetSessions` (unfiltered list) | sessions | FILTER (client subquery; no-client sessions count as consulting) | Dashboard session counts. The `client_id` branch is a single-client lookup and is untouched. |
| `handleGetConsultantTasks` | tasks LEFT JOIN clients | FILTER (no-client tasks count as consulting) | Dashboard task card. |
| `handleGetConsultantTasksOverdue` | tasks | FILTER | Dashboard overdue count. |
| `handleGetAllTasks` | tasks | FILTER | Dashboard task lists. |
| `handleGetGoalApprovals` | client_field_config JOIN clients | FILTER | Dashboard goal approvals. |
| `handleGetPrepBlockQueue` | prep_custom_blocks | FILTER | Developer queue on the dashboard. |
| `handleGetAdminStaleContractNotices` | gm_contract_notices JOIN clients | FILTER (list only; a call for one client is not filtered) | Dashboard warning. Business System clients use the same notices, so the Business System dashboard sees their own. |
| `handleGetGmDormantLogins` | login_people JOIN clients | FILTER | Dashboard. Each side sees its own dormant logins. |
| `handleGetGmSellerLoginRequests` | gm_seller_login_requests | FILTER (list only; a call for one client is not filtered) | Dashboard approval queue, per side. |
| `handleGetVaultClients` | clients | FILTER | Export for Pr Rafa's Claude. Consulting by default. |
| `handleGetFinanceNewAttention` (terms count) | clients | CONSULTING ONLY (hard filter) | Counts clients missing package terms. A Business System client has none and would show as missing. |
| `clientTermsContractProgressRows` | clients, client_package_terms | CONSULTING ONLY | Package contract progress is a consulting concept. |
| `handleGetClientTermsNext` | clients, client_terms | CONSULTING ONLY | Consulting terms questions. |
| `handleGetClientTermsForecast` | clients, client_terms | CONSULTING ONLY | Consulting forecast. |
| `handlePostSessionsVoice` (client roster) | clients | CONSULTING ONLY | Voice session booking matches consulting clients. |

## B. Opt-in filters (shared with billing or booking)

| Function | Decision | Reason |
|---|---|---|
| `handleGetFinanceNewInvoices` | **opt-in** `?plan=` | The billing page shows every invoice. The Dashboard sends `?plan=` so its sums follow the side. Without it, every invoice is returned, as before. |
| `handleGetSessionsCalendar` | **opt-in** `?plan=` | The booking link reads busy slots from this list. A filter by default could hide a busy slot and cause a double booking. The Dashboard sends `?plan=`. |

## C. Scheduled jobs and automations

The only cron is `*/5 * * * *`. `scheduled` runs `runAppointmentReminders` and `loginActivityPurgeDaily` every 5 minutes, and the rest on the 4-hour tick.

| Function | Decision | Reason |
|---|---|---|
| `apptRemFindSessions` (session reminders: staff push and client SMS) | CONSULTING ONLY (client subquery added) | Weekly meeting reminders. Business System clients have no meetings and must never get them. |
| `apptRemFindClientEvents` (client calendar events, push to owner, SMS to the homeowner who booked) | BOTH | Portal calendar feature for the client's own customers. |
| `loginActivityPurgeDaily` | BOTH | Housekeeping. |
| `checkIntegrationHealth`, `pollWatchedFiles` | BOTH | Staff alerts about Apex's own integrations. |
| `syncPlaidTransactions`, `applyKnownPayerMatches`, `buildMatchCandidates`, `categorizeClientIncome` | BOTH | Apex's own bank and payment matching. Business System clients pay Apex, so they must be matched. |
| `runRecurringInvoices`, `notifyUnsentInvoices` | BOTH | Monthly Business System billing depends on it. |
| `syncStripe` | BOTH | Payments. |
| `metaCron`, `thumbtackCron` | BOTH | Lead integrations of the client's own portal. |
| `pollForwardedBillEmails`, `billRunAllReminders` | BOTH | Apex's own bills. |
| Weekly meeting link creation (`handlePostSchedulingRequest`) | CONSULTING ONLY (refuses a Business System client with a plain message) | The weekly meeting link is a consulting flow. Business System clients never get a request, so `handleGetSchedulingClientState` stays empty for them and the portal hides the card. |
| Daily log nudges | CONSULTING ONLY | Driven by `daily_log_enabled`. Graduating or creating a Business System client turns it off through the same switch (value, who, when, pause memory cleared). |

No cron job sends a "weekly meeting reminder" apart from the session reminders above.

## D. Left alone on purpose (BOTH)

Billing and money handlers that join to clients for a name or a Zoho id: `handleGetFinanceNewBillsOverdue`, `handleGetFinanceNewVendors`, invoice view, send and pay handlers, recurring invoice tables, Stripe and Plaid matching. These serve both plans.

Single-client lookups (`WHERE id = ?`), login handlers, the passkey and people routes, `handlePostTasksVoice` (tasks serve both plans), `handleGetApexPartners` (partner counts of referred clients: unchanged, still counts every referred client), `handleGetWatchedFiles`, support tickets, settings routes.

## E. Counts
About 202 occurrences of `FROM clients` / `JOIN clients` were found. 26 staff list or report queries were filtered or hard-limited (24 in table A, 2 opt-in in table B), 1 automation was limited to consulting, 1 flow (weekly meeting link) refuses Business System clients, and the rest (single-client lookups, billing, integrations) are left as they are.

## F. Screens that read `GET /api/clients` and need both plans
The developer preview pickers in `nav.js` and the invoice client picker in `finance-new.html` now ask for `?plan=all`. The client profile's previous/next arrows follow the current side.

## G. Login rules for Business System
- A new Business System client is created with no legacy username or password, and the legacy cutover is applied at creation (a business with no password login passes the safety check at once).
- `POST /api/clients/:id/login` (the temporary password) is refused for a Business System client.
- A client that graduates with a legacy login keeps it. The cutover is tried at graduation; it applies only if every password login of that business already has an active passkey. Otherwise it stays pending, and it is applied automatically when the owner registers a passkey (hook in `handlePostPasskeyInviteRegister`, before the new session is minted).
- The existing handler `POST /api/gm/clients/:id/legacy-login` now calls the same helper (`legacyCutoverApply`), so there is one safety rule.
