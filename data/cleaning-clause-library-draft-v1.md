---
tags: [project, apex, spec, cleaning]
status: draft
area: consulting
related: [projects/apex-client-contract-spec, projects/apex-contract-clause-library-draft, projects/apex-client-docs-research-2026-09-26, projects/apex-status]
---

## Context
Draft 1 of the CLEANING contract clause library for Apex's clients (Florida cleaning companies). Companion to the Florida home-improvement library (`apex-contract-clause-library-draft.md`), same structure and wording style. Written 2026-10-04 by a Claude agent from the cleaning research (spec section "Cleaning research (2026-09-26)" and R3-A, R3-B in `apex-client-docs-research-2026-09-26.md`), with the legal points re-read against official or near-official text on 2026-10-04 (see the Verification summary table at the end). NOT attorney-reviewed. Cleaning is the last item on the build list; this file is the input for it. If this file is revised after being staged for Code, stage the revision as a NEW version (v2), never overwrite v1.

# Contract Clause Library: Florida Cleaning Services (Four Templates)

**DRAFT - NOT REVIEWED BY AN ATTORNEY**

This library is a first draft prepared from research notes and from the text of Florida statutes, the Florida Administrative Code and federal regulations as read on 2026-10-04. It is not legal advice and it is not tax advice. No option in it has been reviewed or approved by a lawyer or a tax professional. Every clause, every locked block, every fee and every rule about when a block appears must be reviewed by a Florida attorney before any business uses it with a customer. Until that review happens, every generated cleaning contract must carry the line: "This contract template has not been reviewed by an attorney. Have your attorney review it."

Version: draft 1, 2026-10-04.

Templates covered: **T1** Residential recurring; **T2** One-time or move-out (move-in, deep clean); **T3** Short-term-rental (STR) turnover; **T4** Small commercial office. Mixed-use property (for example a home with a business suite, a lodging establishment, or a building with separately used commercial space) is **not** a template: it goes to manual review (see section 1).

Where this library says a point is "verified", it means the text was read on the named official or near-official page on 2026-10-04. Where it says "attorney question", the point is deliberately left open and is not resolved here. Where something could not be verified, the library says so plainly.

---

## 1. How to read this library

- **Locked blocks (LC1 to LC7)** carry the text of a statute or rule where the official text was read, or a builder rule where there is no required text. The business cannot edit them. The contract builder inserts them by rule. A block that quotes a rule word for word is labeled with its cite and the verification date. A block whose wording is drafted by this library says so.
- **Clause areas (CL01 to CL19)** are the editable part. "Editable" means the business picks one approved option per clause area, per template. Free text is only allowed through the custom-clause process in the contract spec (C11), which removes the "reviewed by an attorney" line from that contract.
- Each option has an ID like `CL08-B`. IDs never get reused. If an attorney rewrites an option, it gets a new version number, not a new meaning under the old ID.
- **"Templates"** says which of T1, T2, T3, T4 see the option. "all" means every template.
- **"For the owner"** is what the business owner reads in the builder. It describes how the option differs. It does not recommend one.
- **"When this block appears"** is the builder rule for the clause area or locked block.
- **Placeholders** look like `{visit_price}`. Every placeholder is listed in section 5 with its data source. Cross-references look like `{sec_CL08}`; the builder replaces them with the final section number, because the builder renumbers sections when an area does not appear.
- Customer-facing text is English. The **Resumo em português** line under each option is for Pastor Rafael's review only and is never printed on a contract.
- Rafa's rules apply here as in the construction library: American-customer standard (direct sentences, explicit dates and next steps, a deadline on every customer obligation); the price is firm, a discount request is answered with schedule flexibility; collections escalate in three steps (due-date reminder, friendly follow-up the next day, contract language only at step three); never a refund tied to a revenue or results target; termination notice is stated plainly.
- **Template selection questions the builder asks (in this order):**
  1. What is being cleaned: a home, a short-term rental (STR), an office or other commercial space? (A building with more than one use goes to manual review.)
  2. Is the customer an individual buying for personal, family or household use? (If the customer is a business, an owner entity or a property manager, answer No and note who signs.)
  3. One visit or repeating? If repeating: weekly, biweekly, monthly, or per request?
  4. Fixed term, or open-ended (month to month)? Does it renew by itself?
  5. Was this sold during a visit to the customer's home or workplace? (default Yes if the first quote visit ended in a signature on the spot; see LC2.)
  6. Payment methods and billing rhythm.
- **Fee guardrails (product rule, draft, attorney to confirm):** every fee in CL08 (cancellation, lockout, skip) is entered as an amount tied to the visit price and its stated reason (reserved labor, travel, lost slot). The builder refuses a fee above 100 percent of the scheduled visit price and shows the owner a warning above 50 percent. Neither number comes from a statute; both are product guardrails for the attorney to confirm or replace.
- **Facts you must not claim in a contract without a document on file:** "insured", "bonded", "background-checked", a coverage limit, or a license number. The builder inserts those sentences only when the matching record exists (see LC6).

---

## 2. Locked blocks

Sources, all read on **2026-10-04**: Florida statutes on Online Sunshine (leg.state.fl.us, pages showing "The 2026 Florida Statutes"); federal text on eCFR (ecfr.gov, current, retrieved through its renderer API); the Florida Administrative Code text through Cornell LII's copy of the official code (the official flrules.org page for the rule shows only the rule's metadata and a viewer link, not the text); Florida Department of Revenue brochure GT-800015 (R. 09/22).

### LC1  Continuing-services cancellation notice (Rule 2-18.002, F.A.C.)

- **Source URL:** https://www.law.cornell.edu/regulations/florida/Fla-Admin-Code-Ann-R-2-18-002 (official rule page, metadata only: https://www.flrules.org/gateway/ruleNo.asp?id=2-18.002)
- **Verification:** text read 2026-10-04 on the Cornell LII copy of the Florida Administrative Code. That is a secondary copy of the official code, not the official site. Rulemaking authority 501.205 FS; law implemented 501.204 FS; last amended 6-19-96 (as shown on that page).
- **CORRECTION to the spec summary:** the spec's cleaning research paragraph quotes only the first of the three statements the rule requires. The rule says the contract must carry "the following statements", and the text has three paragraphs: the 3-business-day right, a doctor's-order and services-cease right with a pro rata retention, and a line allowing a broader right instead. The block below carries the rule's statements as printed. The seller's name goes in the parenthesis.
- **What the rule says about format (subsection (2)):** it is an unfair or deceptive act for the seller to fail to furnish the buyer with a fully completed copy of the contract at the time of its execution, showing the date of the transaction and the name and address of the seller, and, in immediate proximity to the space reserved for the buyer's signature (or on the front page of the receipt if no contract is used), in bold-face type of a size of 10 points, the statements below. Subsection (4): refusing a cancellation request made under the notice is an unfair or deceptive act. Subsection (5): failing to issue a refund within 20 days after receipt of notice of cancellation is an unfair or deceptive act.
- **Builder rule:** render in bold, at least 10 point, directly next to the customer signature line. The contract date must appear above it ("from the above date"). The builder stores the contract date and the 3-business-day deadline, and the delivery of a completed copy.
- **Business day:** this rule's text does not define "business day". Section 501.021(2) defines it as "any calendar day except Sunday or a federal holiday" for the home solicitation act. Whether the same count applies to this rule is an attorney question (question 3). The app shows the deadline using that definition and says so.

> **Consumer's Right Of Cancellation**
>
> **You may cancel this contract without any penalty or obligation within 3 business days from the above date, and receive a full refund of all payments made to the seller.**
>
> **You may also cancel this contract if upon a doctor's order you cannot physically receive the services, or you may cancel the contract if the services cease to be offered as stated in the contract. If you cancel the contract for either of these reasons, the seller, {business_legal_name}, may keep only a portion of the contract price equal to a pro rata portion of the total price representing the proportion of services you used or completed, plus the cost to the seller of any related goods which you have consumed or retained.**
>
> **Nothing required in this disclosure shall prohibit the use of a notice, in lieu of the above notice, which advises the consumer of a broader right of cancellation.**
>
> CUSTOMER SIGNATURE: {customer_signature}    DATE: {customer_signature_date}

#### LC1-B  Warning to assignees (Rule 2-18.002(3)), **NOT ENABLED until the attorney confirms the wording**

- Subsection (3) requires that the contract forms or promissory notes used by the seller disclose a warning to potential assignees "in capital letters in 10 point bold-face type". The copy of the rule read on 2026-10-04 prints that warning as: "This contract or note is the future consumer services and puts all assignees on notice of the consumer's right to cancel under Chapter 2-18, F.A.C." The sentence appears to be missing words after "is". It could not be compared against an official rendering. This library does NOT guess the missing words.
- Builder rule: LC1-B stays off. It switches on only after the attorney supplies the exact official wording (attorney question 4). A cleaning company that never assigns its contracts or notes to a third party has no assignee, but the rule says the forms "shall also disclose" the warning, so the attorney decides whether it must print anyway.

**When this block appears (LC1):** the contract is T1 (residential recurring) and the customer is an individual buying for personal, family or household use. The rule applies to "any contract which includes a provision for consumer services to be rendered in the future on a continuing basis". For T2 (one visit) it is off unless the contract also commits to further visits. For T3 and T4 it is off by default and the builder shows "attorney question: does the rule reach this customer?" to the owner only as a flag, not as advice. The rule's text read on 2026-10-04 does not define "consumer" or say whether business customers are excluded, so any default for T3 and T4 is an attorney question (question 2). The block cannot be removed by the business for T1.

### LC2  Three-day cancellation for sales made at the customer's home or workplace (FTC Cooling-Off Rule, 16 CFR 429.1)

- **Source URL:** https://www.ecfr.gov/current/title-16/chapter-I/subchapter-D/part-429/section-429.1 and /section-429.0 (text retrieved through the eCFR renderer API for each section on 2026-10-04).
- **Verification:** 429.1 and 429.0 read in full on 2026-10-04; text below is verbatim.
- **Cleaning-specific uncertainty, left open on purpose:** the definition in 429.0(a) says a door-to-door sale "does not include a transaction ... (5) In which the buyer has initiated the contact and specifically requested the seller to visit the buyer's home for the purpose of repairing or performing maintenance upon the buyer's personal property." The text names "personal property". Whether a customer-requested house cleaning (cleaning a dwelling, which is real property) is covered by that exclusion, or is a covered door-to-door sale, is NOT decided by this library. It is attorney question 5. Until the attorney answers, the builder treats a T1 or T2 sale that was closed during a visit to the customer's home as covered (insert LC2), because leaving the notice out is the riskier error. The research said "do not suppress the federal notice solely because the company labels cleaning as maintenance"; this draft follows that.
- **Other definitional points read in 429.0:** "consumer goods or services" means goods or services "purchased, leased, or rented primarily for personal, family, or household purposes"; the sale must be $25 or more at the buyer's residence ($130 or more elsewhere); the definition excludes a transaction "Conducted and consummated entirely by mail or telephone; and without any other contact" before the services, and one "Made pursuant to prior negotiations in the course of a visit by the buyer to a retail business establishment having a fixed permanent location". Business day: "any calendar day except Sunday or any federal holiday".
- **What the rule requires of the seller (429.1, read in full):** (a) a fully completed receipt or copy of the contract, in the same language as that principally used in the oral sales presentation, showing the date and the seller's name and address, with the statement in LC2-A in bold 10 point or larger in immediate proximity to the buyer's signature; (b) two completed copies of the NOTICE OF CANCELLATION in ten point bold; (c) both copies completed with the seller name, address, date of the transaction and the deadline (not earlier than the third business day after the transaction); (d) no waiver of the right to cancel in the contract; (e) oral notice of the right to cancel at signing; (f) no misrepresentation of the right; (g) refund within 10 business days of a valid cancellation; (h) no assignment of a note before midnight of the fifth business day.
- **Language:** if the sales presentation is in Portuguese, the rule requires the contract and forms in Portuguese. This library has no Portuguese locked text. See attorney question 6.

#### LC2-A  Statement beside the buyer's signature (16 CFR 429.1(a))

> **You, the buyer, may cancel this transaction at any time prior to midnight of the third business day after the date of this transaction. See the attached notice of cancellation form for an explanation of this right.**

If the forms are not attached to the contract, the rule requires the last sentence to be changed to say where they are.

#### LC2-B  NOTICE OF CANCELLATION, two completed copies (16 CFR 429.1(b) and (c))

Print two copies, each on its own page or clearly separated, each in ten point bold. Complete the bracketed items from the contract before delivery.

> **Notice of Cancellation**
>
> **{transaction_date}** (Date)
>
> **You may CANCEL this transaction, without any Penalty or Obligation, within THREE BUSINESS DAYS from the above date.**
>
> **If you cancel, any property traded in, any payments made by you under the contract or sale, and any negotiable instrument executed by you will be returned within TEN BUSINESS DAYS following receipt by the seller of your cancellation notice, and any security interest arising out of the transaction will be cancelled.**
>
> **If you cancel, you must make available to the seller at your residence, in substantially as good condition as when received, any goods delivered to you under this contract or sale, or you may, if you wish, comply with the instructions of the seller regarding the return shipment of the goods at the seller's expense and risk.**
>
> **If you do make the goods available to the seller and the seller does not pick them up within 20 days of the date of your Notice of Cancellation, you may retain or dispose of the goods without any further obligation. If you fail to make the goods available to the seller, or if you agree to return the goods to the seller and fail to do so, then you remain liable for performance of all obligations under the contract.**
>
> **To cancel this transaction, mail or deliver a signed and dated copy of this Cancellation Notice or any other written notice, or send a telegram, to {business_legal_name}, at {business_address} NOT LATER THAN MIDNIGHT OF {cancel_deadline_date}.**
>
> **I HEREBY CANCEL THIS TRANSACTION.**
>
> **(Date) ____________   (Buyer's signature) ____________**

Note: the goods-return paragraphs are printed whole because the rule says the notice contains the listed statements "(where applicable)". Whether they may be omitted for a pure services contract is attorney question 7.

#### LC2-C  Oral notice reminder (16 CFR 429.1(e)), builder rule

At signing, the builder shows the seller a required step: "Tell the customer out loud, now, that they may cancel within three business days. Mark this done." The record stores who confirmed it and when. This is a product step, not contract text.

**When this block appears (LC2):** the builder asks "Was this sold during a visit to the customer's home?" (spec decision C9, default Yes) and the customer is an individual buying for personal, family or household use, and the contract is T1 or T2. If the answer is No (the whole sale was by phone, mail or online, or at the company's own fixed place of business), LC2 is not inserted and the builder shows the exclusion that applies. T3 and T4 default to off because the customer buys for a business purpose; the builder still asks the question and flags it for the attorney (question 5). **The seller sees the calculated deadline:** midnight of the third business day after the transaction date, counting Saturdays and skipping Sundays and federal holidays.

### LC3  Florida home solicitation sale statement (§501.031) and related rules

- **Source URLs:** http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0500-0599/0501/Sections/0501.021.html (and the same path with 0501.022, 0501.025, 0501.031, 0501.041, 0501.045, 0501.055).
- **Verification:** each section read in full on Online Sunshine, "The 2026 Florida Statutes", on 2026-10-04. The block text below is verbatim from §501.031(2).
- **Scope facts read:** §501.021(1) defines a "home solicitation sale" as a sale of consumer goods or services over $25 in which the seller personally solicits at a place other than the seller's fixed location business establishment and the buyer's agreement is given and the sale consummated at such a place. It "does not include ... a sale, lease, or rental that results from a request for specific goods or services by the purchaser or lessee". §501.022(1)(b)2 excludes from the permit requirement "Solicitors, salespersons, or agents making a call or business visit upon the express invitation, oral or written, of an inhabitant of the premises or her or his agent." §501.025: the buyer may cancel until midnight of the third business day after signing, by written notice in person, by telegram, or by mail; mail notice is effective on postmarking. §501.041: refund within 10 days after cancellation. §501.045: "If the seller has performed any services pursuant to a home solicitation sale prior to its cancellation, the seller is entitled to no compensation for such services." §501.055: violations of ss. 501.025 to 501.047 are first-degree misdemeanors, and conducting a home solicitation sale without a required permit is a first-degree misdemeanor.
- **Left open:** whether a quote the homeowner asked for ("a request for specific goods or services") takes ordinary cleaning sales outside the Act, and whether a permit under §501.022 is ever needed by a cleaning company. Attorney question 8. This draft inserts LC3 whenever LC2 is inserted, as the construction library does with its L5-C, and adds the permit flag to the owner's setup screen as a question, not a conclusion.

#### LC3-A  The statement

> **BUYER'S RIGHT TO CANCEL**
>
> **This is a home solicitation sale, and if you do not want the goods or services, you may cancel this agreement by providing written notice to the seller in person, by telegram, or by mail. This notice must indicate that you do not want the goods or services and must be delivered or postmarked before midnight of the third business day after you sign this agreement. If you cancel this agreement, the seller may not keep all or part of any cash down payment.**

Format: the statute requires the conspicuous caption "BUYER'S RIGHT TO CANCEL" and the statement; it does not state a type size (not found in the text read). The builder prints it in bold at least 10 point beside the signature so it matches LC2.

**When this block appears (LC3):** whenever LC2 is inserted (see above), pending the attorney's rule. The date of the transaction in the contract must be the date the buyer actually signs (§501.031(1)).

### LC4  Automatic renewal disclosure and reminder (§501.165)

- **Source URL:** http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0500-0599/0501/Sections/0501.165.html
- **Verification:** full section read on 2026-10-04, "The 2026 Florida Statutes". The statute prescribes no exact words. The text of the notices below is DRAFTED by this library, not statutory.
- **What the statute says (verified):**
  - "Automatic renewal provision" means a provision under which a service contract "is renewed for a specified period of more than 1 month if the renewal causes the service contract to be in effect more than 6 months after the day of the initiation of the service contract", effective unless the consumer gives notice to terminate. "Service contract" means "a written contract for the performance of services over a fixed period of time or for a specified duration." "Consumer" is an individual receiving service, maintenance or repair, and does not include an individual acting for a business or government.
  - (2)(a) The seller shall "disclose the automatic renewal provision clearly and conspicuously in the contract or contract offer."
  - (2)(b) When the term is a specified period of 12 months or more and the contract automatically renews for more than 1 month, the seller shall give written or electronic notice. The statute prints the timing as "no less than 30 days or no more than 60 days before the cancellation deadline", and the notice must state that unless the consumer cancels the contract will automatically renew, and how the consumer can get details (a telephone number or address, the contract, or another method). The builder schedules the notice 45 days before the cancellation deadline (the middle of the 30-to-60 window; a product choice, not statutory).
  - (2)(c) a safe harbor for a seller with written compliance procedures, a failure caused by error, and a refund of the unearned portion.
  - (2)(d) the seller "must allow the consumer to cancel the service contract in the same manner, and by the same means, as the consumer manifested his or her acceptance." (If the customer accepted by e-signature, the customer can cancel by the same electronic means.)
  - (2)(e) exemptions (financial institutions, health studios, insurance-chapter entities, electric utilities and certain private water or sewer companies). None is a cleaning company.
  - (2)(f) "A violation of this subsection renders the automatic renewal provision void and unenforceable."
- **Open-ended month-to-month contracts:** whether a contract with no fixed period is a "service contract" at all (it is defined by a fixed period or specified duration) and whether it can have an "automatic renewal provision" is not decided here. Attorney question 9.

#### LC4-A  Conspicuous renewal panel (drafted)

Printed in a bordered box, bold, at least 12 point, immediately above the customer signature:

> **AUTOMATIC RENEWAL. This contract renews automatically for {renewal_term} unless you cancel. To stop the renewal, tell {business_legal_name} you are cancelling by {cancel_deadline_rule}, in the same way you accepted this contract ({acceptance_method}), or by any other method listed in Section {sec_CL09}. {renewal_notice_sentence}**

`{renewal_notice_sentence}` is "We will send you a written or electronic reminder between 30 and 60 days before the cancellation deadline." when the initial term is 12 months or more, otherwise empty.

#### LC4-B  Reminder message template (drafted, T1 and T4 with a 12-month or longer fixed term)

> Reminder from {business_legal_name}: your cleaning contract will renew automatically on {renewal_date} for {renewal_term} unless you cancel by {cancel_deadline_date}. To cancel, {cancel_method}. Details are in Section {sec_CL09} of your contract, or call {business_phone}.

The builder logs the date, channel and delivery of each reminder as evidence.

**When this block appears (LC4):** the contract is CL09-B (fixed term with automatic renewal). Not inserted for CL09-A (month to month, no automatic renewal), CL09-C (fixed term, ends on its own) or one-time contracts. LC4-A appears for T1 (consumer) and also for T4 as a conservative default, because the statute excludes individuals acting for a business but an owner-operated small office may still sign as an individual. LC4-B is scheduled only when the term is 12 months or more.

### LC5  Sales tax on commercial cleaning (information and invoice rule, Florida DOR)

- **Source URLs:** https://floridarevenue.com/Forms_library/current/brochure/gt800015.pdf (Florida Department of Revenue, "Sales and Use Tax on Cleaning Services", GT-800015, R.09/22, read 2026-10-04) and http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0200-0299/0212/Sections/0212.05.html (§212.05(1)(i)1.b read 2026-10-04).
- **Verified:** §212.05(1)(i)1.b imposes tax "At the rate of 6 percent on charges for all: ... Nonresidential cleaning, excluding cleaning of the interiors of transportation equipment, and nonresidential building pest control services (NAICS National Numbers 561710 and 561720)." The DOR brochure says charges for NAICS 561720 cleaning "provided to nonresidential building interiors, such as office buildings, warehouses, restaurants and other commercial or industrial buildings, are taxable"; lists maid, janitorial, office cleaning, restroom cleaning, floor waxing, disinfecting and "Window cleaning (interior or exterior)" among taxable examples; says the rate is the state 6 percent "plus any applicable discretionary sales surtax" based on the county where the services are provided; says sellers of nonresidential cleaning "are required to register with the Department of Revenue"; and says an exempt buyer (governmental entity or nonprofit) needs a current Florida Consumer's Certificate of Exemption (Form DR-14) and must pay directly. It says "Charges for cleaning residential facilities are not taxable", lists detached homes, apartments, condominiums, beach cottages, nursing homes, timeshare units and the common areas of those, and says this holds "even if the rental, lease, letting, or licensing of such living accommodations is taxable." It lists "Carpet cleaning" and exterior pressure washing as other nontaxable cleaning services. It says a mandatory cleaning fee a guest or tenant must pay for the right to use the accommodations is part of the taxable rental charge (citing Rule 12A-1.061, F.A.C., which was NOT read), and gives an example where the cleaning charge from the cleaner to the owner is not taxable. The brochure says it "provides general information" and "is not intended to change the law or its meaning."
- **Not decided here:** how a mixed-use building, a lodging establishment (public lodging may count as nonresidential; the research recorded this and the brochure's list of residential facilities does not name hotels), carpet cleaning in a commercial office, or a bundled price (cleaning plus supplies plus a restocking fee) is taxed. Attorney or tax professional question 11.
- **Builder rules (product, drafted):**
  1. T1 and T2 residential: no tax line on the contract or invoice. Contract sentence in CL07.
  2. T3 STR turnover: no tax on the cleaner's invoice to the owner or manager. Printed note (LC5-B) separates this from the host's guest fee.
  3. T4 commercial: the contract and every invoice show a tax line: state 6 percent plus the county surtax for the service location, with the effective date of the rate. The owner must enter the company's sales tax registration status; the builder never invents a registration number. The repeating-invoices build must offer a "taxable commercial service" mode (spec).
  4. Mixed-use property: manual review, no automatic tax decision.

#### LC5-A  Commercial tax sentence (drafted)

> **Sales tax.** Cleaning of nonresidential buildings is subject to Florida sales tax. Contractor will add Florida sales tax at 6 percent plus the discretionary sales surtax for {service_county} County ({county_surtax_rate} percent) to each invoice, shown on its own line. If Customer is a governmental entity or a nonprofit organization exempt from sales tax, Customer will give Contractor a current Florida Consumer's Certificate of Exemption (Form DR-14) before the first service, and Customer will pay Contractor directly.

#### LC5-B  STR turnover tax note (drafted)

> **Sales tax.** Contractor's charges to Owner for cleaning the rental home are not charged sales tax. This does not change any tax that applies to Owner's rental charges to guests, including any mandatory cleaning fee charged to guests. Owner is responsible for that tax and for any tax advice about it.

**When this block appears (LC5):** LC5-A for T4. LC5-B for T3. Neither for T1 and T2. The tax line and rates are updated by the Admin (county surtax table with effective dates), never by the client.

### LC6  Insurance, bonding, license and screening representations gate (builder rule)

There is no statute behind this block. It is a safeguard from the spec ("never claim bonded or insured without a document on file").
- The contract may say the company is insured only if the Settings record holds a current certificate of insurance with an expiry date. It may say "workers' compensation coverage" only if a policy or an exemption document is on file with an expiry date. It may say "bonded" only with a bond document on file. It may say personnel are "background-screened" only if the company confirms in Settings that the described screening was completed for the people who will be assigned and the screening type is recorded. It may print a license or local business tax receipt number only if the owner enters it; the builder never invents one.
- If a document expires, the builder removes the sentence from new contracts and warns the owner.
- A coverage limit is printed only if the document shows it.

**When this block appears:** whenever CL13 or CL14 is on the contract.

### LC7  Notices that are NOT inserted by default (explicit non-inclusion)

The construction lien notice (§713.015), the Homeowners' Construction Recovery Fund notice (§489.1425), the construction defect notice (§558.005(6)) and the pool documents are not part of any cleaning template. The research found no authority applying them to ordinary house or office cleaning, but it also did not verify that they do not apply (it said not to represent their inapplicability as a confirmed legal conclusion). This library follows that: they are off by default, and the point is attorney question 13 (including post-construction "final clean" work performed for a builder or on an active construction project). The builder shows a flag "Is this a post-construction or builder clean?" and, if Yes, routes the contract to manual review.

---

## 3. Which blocks appear by template (summary)

| Block | T1 Residential recurring | T2 One-time or move-out | T3 STR turnover | T4 Small commercial office |
|---|---|---|---|---|
| LC1 Rule 2-18.002 notice | Yes (consumer) | Only if further visits are promised | Off by default (attorney Q2) | Off by default (attorney Q2) |
| LC1-B assignee warning | Off until attorney supplies wording | Off | Off | Off |
| LC2 FTC three-day notice and forms | If sold at the home (default Yes) | If sold at the home | Off by default (business purpose); flagged | Off by default; flagged |
| LC3 Florida statement | With LC2 | With LC2 | With LC2 if LC2 | With LC2 if LC2 |
| LC4 Auto-renewal panel and reminder | Only with CL09-B | No | Only with CL09-B | Only with CL09-B |
| LC5 Sales tax | None | None | LC5-B note | LC5-A tax line |
| LC6 Representation gate | Yes | Yes | Yes | Yes |
| LC7 Construction notices | Off | Off (post-construction: manual review) | Off | Off (post-construction: manual review) |

---

## 4. Clause areas

Every clause text below uses "Contractor" for the cleaning company and "Customer" for the person or business paying. For T3 the builder substitutes "Owner" where the paying party is the property owner and "Manager" where a property manager signs; the placeholder `{customer_label}` carries this and defaults to "Customer". Every option's text is printed under its heading with the section number equal to the CL number (the builder renumbers).

---

### CL01  Parties, property and signers

**When this block appears:** always, one option per contract, chosen by the template and the customer type.

### CL01-A  Individual homeowner or tenant
- Templates: T1, T2
- For the owner: The customer is a person who lives at the property. Signs for themselves.
- Clause text:

> **1. Parties and Property.** This Agreement is between {business_legal_name} ("Contractor"), {business_address}, telephone {business_phone}, and {customer_full_name} ("Customer"), {customer_phone}, {customer_email}. Contractor will clean the home at {service_address} (the "Property"). Customer confirms that Customer lives at the Property or has the right to authorize cleaning there{landlord_consent_sentence}. This Agreement begins on {contract_date}.

- Fields: business_legal_name, business_address, business_phone, customer_full_name, customer_phone, customer_email, service_address, landlord_consent_sentence (empty, or " and has the landlord's consent where needed"), contract_date
- Resumo em português: Identifica a empresa e o cliente (pessoa física) com endereço do serviço e data do contrato. O cliente confirma que mora lá ou pode autorizar a limpeza. Responde aos pontos 2 e 3 da auditoria do Rafa (partes não identificadas, sem endereço do serviço).

### CL01-B  Owner or property manager signs for the property owner
- Templates: T2, T3
- For the owner: The person signing is an agent, such as a property manager or host's co-host, or the owner themselves for a rental. The contract states the signer's authority and who pays.
- Clause text:

> **1. Parties and Property.** This Agreement is between {business_legal_name} ("Contractor"), {business_address}, telephone {business_phone}, and {customer_full_name}{customer_entity_sentence} ("Customer"), {customer_phone}, {customer_email}. Contractor will clean the property at {service_address} (the "Property"), owned by {property_owner_name}. The person signing for Customer confirms that they are the owner or are authorized in writing by the owner to book cleaning and approve charges for the Property. Invoices are paid by {paying_party}. Access is arranged by {access_contact_name}, {access_contact_phone}.

- Fields: as CL01-A plus customer_entity_sentence, property_owner_name, paying_party, access_contact_name, access_contact_phone
- Resumo em português: Para gerente de imóvel ou anfitrião: diz quem é o proprietário, quem assina, quem paga e quem libera o acesso. O assinante confirma que tem autoridade por escrito.

### CL01-C  Business customer (office)
- Templates: T4
- For the owner: The customer is a company, office or landlord. The contract names the entity, who may give instructions and the building contact.
- Clause text:

> **1. Parties and Property.** This Agreement is between {business_legal_name} ("Contractor"), {business_address}, telephone {business_phone}, and {customer_entity_name}, a {customer_entity_type} ("Customer"), {customer_address}. The person signing, {signer_name}, {signer_title}, confirms authority to bind Customer. Contractor will clean the premises at {service_address}, {suite_or_floor} (the "Premises"), which are used only as {premises_use}. If Customer is a tenant, Customer confirms that the lease allows Customer to hire Contractor and that building management has approved Contractor's access where required. Customer's day-to-day contact is {site_contact_name}, {site_contact_phone}.

- Fields: customer_entity_name, customer_entity_type, customer_address, signer_name, signer_title, suite_or_floor, premises_use, site_contact_name, site_contact_phone
- Resumo em português: Para empresa: nomeia a empresa, quem assina e com que cargo, o local e o uso (somente escritório), confirma que o contrato de locação permite e que o prédio autoriza o acesso. Se o uso for misto, o app manda para revisão manual.

---

### CL02  Scope of services by template

**When this block appears:** always, one option per contract, by template. An attached `{scope_checklist}` (Exhibit A) is required for every option; the builder will not send a contract with an empty checklist. Each task is marked Included or Excluded.

### CL02-A  Residential recurring: fixed checklist
- Templates: T1
- For the owner: The customer pays for a fixed list of tasks in listed rooms. Anything not on the list is extra, with written approval.
- Clause text:

> **2. Services.** Contractor will perform the tasks marked "Included" in Exhibit A for the rooms and areas listed there at each visit. Tasks marked "Excluded", tasks not listed, and areas not listed are not part of the service. Contractor can do an excluded or unlisted task if Customer asks and Contractor agrees, for an added charge stated before the task is done and approved in writing (a text or email is enough). Rotating or periodic tasks (for example inside the oven, inside the refrigerator, baseboards, interior windows) are performed on the schedule in Exhibit A: {rotation_schedule}.

- Fields: scope_checklist, rotation_schedule
- Resumo em português: Lista fixa de tarefas por cômodo. O que não está na lista é extra, com aprovação por escrito antes. Tarefas periódicas (forno, geladeira, rodapés) seguem um rodízio definido.

### CL02-B  Residential recurring: purchased hours, priorities in order
- Templates: T1
- For the owner: The customer buys a number of labor hours per visit. The crew works through the customer's priority list in order and does not promise to finish everything in the time.
- Clause text:

> **2. Services.** Customer is buying up to {hours_per_visit} labor-hours of cleaning per visit, performed by {crew_size} cleaners. Contractor will work through Customer's priority list in Exhibit A, in order, and will tell Customer at the end of each visit which items were not reached. Contractor does not promise that every item will be finished within the purchased time. Customer may add time for a future visit by asking in writing at least {time_change_notice_hours} hours before the visit. Tasks listed as "Excluded" in Exhibit A are not part of the service.

- Fields: hours_per_visit, crew_size, scope_checklist, time_change_notice_hours
- Resumo em português: O cliente compra horas de trabalho por visita; a equipe faz a lista de prioridades em ordem e avisa o que não deu tempo. Sem promessa de terminar tudo no tempo.

### CL02-C  One-time or move-out: itemized scope with condition limits
- Templates: T2
- For the owner: A one-time deep, move-in or move-out clean. The customer gets the itemized list. The price assumes the home is in the condition described; extreme conditions are re-quoted.
- Clause text:

> **2. Services.** Contractor will perform one cleaning at the Property on {service_date}, starting at {arrival_window}, of the type "{clean_type}" (for example move-out, move-in, deep clean), and will perform the tasks marked "Included" in Exhibit A. The price is based on the Property being {size_description} and in {condition_description} condition on the date of the quote. If, when the crew arrives, the Property is in clearly worse condition or has materially more area than described (for example heavy grease build-up, unremoved belongings, or an unlisted room), Contractor will tell Customer before starting and may either re-quote in writing or clean only the described scope. Contractor will not start extra work without Customer's written approval. Items left in the home are not removed or discarded unless listed in Exhibit A.

- Fields: service_date, arrival_window, clean_type, scope_checklist, size_description, condition_description
- Resumo em português: Limpeza única (profunda, entrada ou saída). O preço vale para o tamanho e a condição informados; se estiver bem pior ou maior, a equipe avisa antes e re-orça por escrito. Nada é descartado sem estar na lista.

### CL02-D  Short-term-rental turnover: checklist
- Templates: T3
- For the owner: Each turnover follows an attached checklist (cleaning, linens, restocking, damage observations, completion photos). Laundry, restocking and heavy-condition work are included only when ticked.
- Clause text:

> **2. Services.** At each turnover, Contractor will perform the checklist in Exhibit A for the Property, including only the items marked "Included": cleaning, bed linen change, laundry ({laundry_option}), restocking of {restock_list}, and the completion photos and observations described in Section {sec_CL16}. Items marked "Excluded", including extra-condition cleaning (for example cleanup after a party, smoke, or pet accidents), maintenance, repair coordination and trash removal beyond {trash_scope}, are charged only if Customer or its manager approves them in writing before they are done. A turnover is complete when the checklist is finished and the completion photos are sent.

- Fields: scope_checklist, laundry_option, restock_list, trash_scope
- Resumo em português: Cada virada de hóspede segue uma lista (limpeza, roupa de cama, reposição, fotos de conclusão). Lavanderia, reposição e condições extremas só entram se marcados. A virada termina quando a lista acaba e as fotos são enviadas.

### CL02-E  Small commercial office: scope exhibit with frequency by area
- Templates: T4
- For the owner: The contract lists each area of the office and how often each task is done (daily, weekly, monthly). Exclusions are listed.
- Clause text:

> **2. Services.** Contractor will clean the Premises on the schedule and to the specification in Exhibit A, which lists each area, each task, and how often it is done. Tasks and areas not listed are excluded. Contractor does not clean the interiors of vehicles, perform repairs, move heavy furniture or equipment, handle confidential papers, or touch computers, files or other items on desks unless Exhibit A says so. Changes to Exhibit A are made by a written change signed or approved by email by {approver_name}, and take effect on the next visit after approval, with any price change stated in the approval.

- Fields: scope_checklist, approver_name
- Resumo em português: Lista cada área e a frequência de cada tarefa (diária, semanal, mensal). Não toca em computadores, papéis ou itens pessoais. Mudanças só por aprovação escrita de um contato nomeado.

---

### CL03  Access, keys, alarm codes and lockouts

**When this block appears:** always, one access option per contract chosen by how the crew enters. Pets are in CL04. The lockout and no-access charge itself is in CL08; this clause only describes what counts as no access and what happens at the door.

### CL03-A  Customer present or home unlocked
- Templates: T1, T2
- For the owner: The customer is home or leaves the door unlocked at the agreed time. After a short wait with no entry the visit counts as a no-access visit.
- Clause text:

> **3. Access.** Customer will make sure Contractor can enter the Property at the scheduled time, either by being present or by leaving the Property open and safe to enter. If Contractor cannot get in within {access_wait_minutes} minutes of the start of the arrival window, Contractor will try to reach Customer at {customer_phone}. If access is still not available after another {access_wait_minutes} minutes, the visit is a no-access visit under Section {sec_CL08}. Contractor will not enter a home by any means other than the ones Customer has provided.

- Fields: access_wait_minutes, customer_phone
- Resumo em português: O cliente está em casa ou deixa aberto. Se a equipe não entra dentro do prazo, tenta ligar; se continuar sem acesso, vira visita sem acesso (cobrança na cláusula de cancelamento). A equipe nunca entra por outro meio.

### CL03-B  Key or lockbox held by Contractor
- Templates: T1, T2, T3
- For the owner: The customer gives the company a key, key code or lockbox code to use only for scheduled service. Keys are stored coded, not labeled with the address, and returned when service ends.
- Clause text:

> **3. Access and Keys.** Customer authorizes Contractor to use the key, lockbox or door code described in {access_instructions} only to enter the Property for scheduled service under this Agreement. Contractor will keep any key coded, without the Property address written on it, in a secure place, and will return it, or delete or ask Customer to change any code, within {key_return_days} days after this Agreement ends. Contractor's staff will not copy keys or share codes. If a key is lost, Contractor will tell Customer within {key_loss_notice_hours} hours. Customer may change locks or codes at any time and will give Contractor the new information at least {access_change_notice_hours} hours before the next visit.

- Fields: access_instructions, key_return_days, key_loss_notice_hours, access_change_notice_hours
- Resumo em português: O cliente autoriza usar a chave ou código só para o serviço agendado. A empresa guarda a chave codificada, sem endereço, devolve ou apaga o código após o fim do contrato, avisa se perder e não copia nem compartilha códigos.

### CL03-C  Alarm, gate, smart lock and parking instructions
- Templates: T1, T2, T3, T4
- For the owner: Adds alarm codes, gate codes, smart-lock and parking details. The customer is responsible for accurate and current information; the company is responsible if its staff trip an alarm by not following the instructions given.
- Clause text:

> **3. Alarm, Gate and Parking.** Customer will give Contractor, before the first visit, accurate and current instructions for the alarm, gate, smart lock, parking and building entry: {alarm_gate_instructions}. Customer will tell Contractor in writing at least {access_change_notice_hours} hours before the next visit if any of this changes. Contractor will follow the instructions, will not share them, and will tell Customer right away if an alarm is triggered. If an alarm company or the police charge a fee for a false alarm that was caused by incorrect or outdated instructions from Customer, Customer is responsible for that fee. If the alarm was caused by Contractor's staff not following the instructions Customer gave, Contractor is responsible for that fee.

- Fields: alarm_gate_instructions (stored encrypted, shown only to assigned staff; never included in the printed contract text), access_change_notice_hours
- Resumo em português: Códigos de alarme, portão, fechadura inteligente e estacionamento. O cliente garante que estão certos e atuais; quem causou o falso alarme paga a multa. Os códigos ficam guardados em campo protegido e não aparecem no contrato impresso.

### CL03-D  Commercial after-hours access
- Templates: T4
- For the owner: The crew cleans outside business hours with a key card, key or code. The contract sets who is responsible for building security rules.
- Clause text:

> **3. After-Hours Access and Security.** Customer will give Contractor access to the Premises during {service_hours}, using {access_method}. Customer or building management will tell Contractor in writing of any rule for after-hours entry, sign-in, security alarms, or restricted areas, and Contractor will follow them. Contractor will lock the Premises and re-set any alarm when finished, and will keep keys, cards and codes secure. Contractor will tell Customer's contact within {key_loss_notice_hours} hours if a key, card or code is lost. Customer will tell Contractor within {access_change_notice_hours} hours of any change that affects access, such as a lock change or a new alarm code.

- Fields: service_hours, access_method, key_loss_notice_hours, access_change_notice_hours
- Resumo em português: Limpeza fora do expediente com cartão, chave ou código. O cliente informa as regras do prédio por escrito; a empresa tranca, rearma o alarme e avisa em tempo definido se perder uma chave ou código.

---

### CL04  Pets, hazards and unsafe conditions

**When this block appears:** pets option for T1, T2, T3 (always one pets option). The hazards option appears for every template (one option, default CL04-D). Height and lifting limits (CL04-E) are an optional add-on printed after any hazards option.

### CL04-A  All pets secured away from the work area
- Templates: T1, T2, T3
- For the owner: Pets must be secured before the crew arrives and stay secured. The company does not feed, walk or clean up animal waste.
- Clause text:

> **4. Pets.** Customer will secure all pets away from the work area before Contractor's staff enter, and will keep them secured throughout the visit. Contractor does not supervise, feed, walk or handle pets, and does not clean up animal waste, except as listed as Included in Exhibit A. If a pet is not secured and Contractor's staff feel unsafe, Contractor may start later, work around the animal, or treat the visit as a no-access visit under Section {sec_CL08}.

- Fields: none
- Resumo em português: Todos os animais presos fora da área durante a visita. A empresa não cuida de animais nem limpa fezes. Se um animal solto torna o trabalho inseguro, a visita pode ser adiada ou contar como sem acesso.

### CL04-B  Disclosed gentle pets may stay
- Templates: T1, T2
- For the owner: The customer lists pets that stay at home. The crew may ask to confine a pet that interferes or seems unsafe, and may stop work.
- Clause text:

> **4. Pets.** Customer has told Contractor about these pets in the home: {pets_list}. They may stay in the home during the visit at Customer's risk. Contractor's staff may ask Customer to confine a pet, and may stop work if a pet interferes with safe work or behaves aggressively. If the visit is stopped for that reason, it is a no-access visit under Section {sec_CL08}. Customer will tell Contractor before the next visit about any new pet or any change in a pet's behavior. Contractor does not clean up animal waste unless listed as Included in Exhibit A.

- Fields: pets_list
- Resumo em português: O cliente informa os animais que ficam em casa. A equipe pode pedir que prendam o animal e pode parar o serviço se for inseguro. Mudança de animais ou de comportamento deve ser avisada antes.

### CL04-C  Escaped-pet allocation
- Templates: T1, T2, T3
- For the owner: Add-on. Says the company uses care when opening doors but is not responsible for a pet that gets out because the customer did not secure it. It does not limit liability for the company's own misconduct.
- Clause text:

> **4. Pets, Doors and Gates.** Contractor's staff will use reasonable care when entering and leaving, and when opening and closing doors and gates. Contractor is not responsible for a pet that leaves the Property because the pet was not secured as Section {sec_CL04} requires. This does not limit Contractor's responsibility for harm caused by the willful misconduct of its staff or for any liability that cannot lawfully be limited.

- Fields: none
- Resumo em português: Opcional. A empresa tem cuidado com portas e portões, mas não responde por animal que fugiu porque não estava preso como o contrato exige. Não vale para má-fé da equipe nem para responsabilidade que a lei não deixa limitar.

### CL04-D  Hazards and unsafe conditions (default for all)
- Templates: all
- For the owner: Lists what the crew will not clean (biohazards, needles, extensive mold, hazardous chemicals) and lets the crew stop or decline unsafe work.
- Clause text:

> **4. Hazards and Unsafe Conditions.** The service does not include cleaning of blood or other bodily fluids, human or animal waste, needles or other medical waste, hazardous chemicals, asbestos, or mold or mildew growth that covers a large area. Contractor may stop or decline work, and will tell Customer why, if staff encounter an aggressive person or animal, an active infestation, dangerous clutter, exposed sharp objects, unlawful activity, an unsafe temperature, a structural hazard, or an unknown hazardous material. If work is stopped for these reasons, Customer pays for the part of the visit that was done, based on {partial_visit_basis}, and Contractor is not charged a fee for stopping.

- Fields: partial_visit_basis (default: "time worked at the hourly rate used in the quote")
- Resumo em português: Não inclui sangue, fezes, agulhas, produtos perigosos, amianto ou mofo extenso. A equipe pode parar ou recusar trabalho inseguro e o cliente paga só o que foi feito. Ligado à regra de licença: remediação de mofo acima de 10 pés quadrados é regulada pela Flórida (ver pergunta 12 para o advogado).

### CL04-E  Height and lifting limits (add-on)
- Templates: all
- For the owner: Sets a stool height limit and a weight limit for moving objects.
- Clause text:

> **4. Height and Lifting.** Contractor's staff will not climb above a {stool_steps}-step stool, stand on furniture, or move any object heavier than {lift_limit_lbs} pounds. Surfaces beyond that reach are cleaned from the floor with an extension tool when practical, and are otherwise not cleaned.

- Fields: stool_steps, lift_limit_lbs
- Resumo em português: Opcional. Limite de altura do banquinho e de peso para mover objetos. Superfícies acima do limite são limpas com extensor ou ficam de fora.

---

### CL05  Supplies and equipment

**When this block appears:** always, one option per contract by template.

### CL05-A  Contractor supplies products and equipment
- Templates: T1, T2
- For the owner: The company brings its own products and equipment. Specialty products and consumables are included only if listed.
- Clause text:

> **5. Supplies and Equipment.** Contractor will bring the ordinary cleaning products and equipment needed for the Included tasks. Specialty products, paper goods, soap refills and other consumables are included only if listed in Exhibit A. Customer will give Contractor access to water and electricity at the Property. If Customer asks Contractor to avoid a product (for example for an allergy), Customer will tell Contractor in writing before the first visit, and some tasks may then be excluded or take longer.

- Fields: none
- Resumo em português: A empresa traz produtos e equipamentos comuns. Produtos especiais e descartáveis só se listados. O cliente dá água e energia e avisa por escrito sobre alergia ou produto a evitar.

### CL05-B  Customer-supplied products or equipment on request
- Templates: T1, T2
- For the owner: At the customer's written request, the crew uses the customer's products or vacuum. The customer is responsible for unsuitable products; the company is responsible for misusing them.
- Clause text:

> **5. Supplies and Equipment.** At Customer's written request, Contractor will use these products or equipment supplied by Customer: {customer_supplies_list}. Customer is responsible for telling Contractor how to use them and for any damage that results from a product or machine that is defective or unsuitable for the surface, except to the extent Contractor's staff misused it. Contractor may refuse to use any product it believes is unsafe, and will say so. Everything else needed for the Included tasks is supplied by Contractor.

- Fields: customer_supplies_list
- Resumo em português: Por pedido escrito, a equipe usa produtos ou aspirador do cliente. O cliente responde por produto defeituoso ou inadequado; a empresa responde se usar errado. A empresa pode recusar produto inseguro.

### CL05-C  Commercial: Customer provides consumables and storage
- Templates: T4
- For the owner: The office provides paper goods, dispensers, trash bags and a locked storage closet. The company brings the rest.
- Clause text:

> **5. Supplies and Equipment.** Customer will provide, at its cost: {customer_provided_items}, including a secure place to store Contractor's equipment and supplies. Contractor will provide the remaining products and equipment listed in Exhibit A. Contractor will refill dispensers only with products Customer provides. Contractor's equipment remains Contractor's property, and Customer is responsible for loss of Contractor's stored equipment only if caused by Customer's negligence or by a break-in to a space Customer controls.

- Fields: customer_provided_items
- Resumo em português: O escritório fornece papel, dispensers, sacos e um local trancado para guardar equipamento. A empresa traz o resto. O equipamento continua sendo da empresa.

### CL05-D  STR: linens, laundry and restocking
- Templates: T3
- For the owner: Sets who supplies linens and restock items and how laundry is handled. Restock items are billed at cost plus the percentage the owner sets, or left to the host.
- Clause text:

> **5. Linens, Laundry and Restocking.** Linens and towels are supplied by {linen_supplier}. Laundry is done {laundry_location}. Restock items (such as {restock_list}) are supplied by {restock_supplier}. If Contractor buys restock items for Owner, Contractor will charge {restock_charge_basis}, shown on the invoice with receipts available on request. Contractor will tell Owner by {restock_alert_method} when stock runs below {restock_minimum}. Damaged, stained or missing linens will be reported with a photo in the completion report; Contractor is not responsible for normal wear.

- Fields: linen_supplier, laundry_location, restock_list, restock_supplier, restock_charge_basis, restock_alert_method, restock_minimum
- Resumo em português: Define quem fornece roupa de cama e toalhas, onde se lava, quem repõe os itens e como cobrar (a custo mais percentual, com recibos). Linhas manchadas ou faltando são reportadas com foto.

---

### CL06  Pricing, frequency, schedule and price changes

**When this block appears:** always. One pricing option and one schedule option per contract. The price on the contract is copied from the accepted quote and is never re-entered; if the owner edits the quote, the builder requires a new quote version first.

### CL06-A  Recurring day with arrival window
- Templates: T1, T4
- For the owner: Service is on a regular day inside an arrival window. The exact day or window is not guaranteed and may move for routing, staffing, traffic, holidays or weather.
- Clause text:

> **6. Schedule.** Service will be {frequency} on {service_day}, within an arrival window of {arrival_window}. Contractor will tell Customer at least {schedule_change_notice_hours} hours ahead if the day or window must change. Visits that fall on {holiday_list} will be moved to the nearest available day, and Contractor will tell Customer the new day in advance. If Contractor cannot perform a visit because of an unsafe storm, an evacuation order, unsafe travel or parking, or a similar cause outside its control, Contractor will move the visit to the next available day and will not charge a fee for that postponement.

- Fields: frequency, service_day, arrival_window, schedule_change_notice_hours, holiday_list
- Resumo em português: Visitas em dia fixo dentro de uma janela de chegada. A empresa avisa com antecedência se mudar; feriados movem a visita; tempestade ou evacuação adia sem cobrança.

### CL06-B  Exact appointment time with lateness tolerance
- Templates: T2, T3, T4
- For the owner: A specific start time, with a stated allowance for lateness. The company tells the customer about a material delay.
- Clause text:

> **6. Schedule.** Contractor will begin at {start_time} on {service_date}. A delay of up to {late_tolerance_minutes} minutes is not a failure to perform. Contractor will tell Customer by call or text as soon as it knows of a delay longer than that. {turnover_deadline_sentence}

- Fields: start_time, service_date, late_tolerance_minutes, turnover_deadline_sentence (T3 only, for example "The Property will be ready by {ready_by_time} on check-in days unless Contractor has told Owner of a delay.")
- Resumo em português: Hora de início definida, com tolerância de atraso. A empresa avisa se atrasar mais. Para turnover, define a hora em que o imóvel deve estar pronto.

### CL06-C  Price per visit with 30-day notice of rate changes
- Templates: T1, T3, T4
- For the owner: A set price per visit. The company can change recurring rates only with written notice, and only for visits after the notice period.
- Clause text:

> **6. Price.** The price is {visit_price} per visit{tax_note_short}, for the services in Exhibit A, {frequency}. The price is based on {pricing_basis_description} (for example the size of the Property, the number of people living there, pets, the condition and the frequency chosen). Contractor may change the recurring price by giving Customer at least 30 days' written notice, and the new price applies only to visits after the notice period. Customer may end this Agreement under Section {sec_CL09} before the new price takes effect.

- Fields: visit_price, tax_note_short (empty for T1, T3; for T4 " plus sales tax as described in Section {sec_CL07}"), frequency, pricing_basis_description
- Resumo em português: Preço fixo por visita. Mudança de preço recorrente só com 30 dias de aviso por escrito e só vale para visitas depois do aviso. O cliente pode encerrar antes do novo preço.

### CL06-D  Price per visit, annual cap on increases
- Templates: T1, T4
- For the owner: As CL06-C, plus a limit: one increase per 12 months and no more than a percentage the owner sets, except when the scope or conditions materially change.
- Clause text:

> **6. Price.** The price is {visit_price} per visit{tax_note_short}, for the services in Exhibit A, {frequency}. Except when the scope or condition of the Property materially changes (see below), Contractor will increase the recurring price no more than once in any 12-month period and by no more than {annual_increase_cap_percent} percent, on at least 30 days' written notice. If the size, number of occupants, condition, pets, parking or access, the checklist, or the visit frequency materially changes, Contractor may re-quote in writing, and the new price applies only after Customer agrees in writing or the next visit following 30 days' notice, whichever Customer chooses.

- Fields: visit_price, tax_note_short, frequency, annual_increase_cap_percent
- Resumo em português: Igual ao C06-C, mas com limite: um aumento a cada 12 meses e até um percentual definido, exceto se o tamanho, a condição ou o escopo mudarem. Mudança de escopo permite re-orçar por escrito.

### CL06-E  Frequency re-pricing after a skipped visit
- Templates: T1
- For the owner: Pricing depends on how often the home is cleaned. If a visit is skipped instead of rescheduled, the next visit is priced for the longer interval.
- Clause text:

> **6. Frequency and Pricing.** The price is based on service {frequency}. If a visit is skipped rather than rescheduled within {reschedule_window_days} days, Contractor may price the next visit at the rate for the actual time since the last completed cleaning, which is {reprice_table}. Contractor will tell Customer the price before the visit.

- Fields: frequency, reschedule_window_days, reprice_table
- Resumo em português: O preço depende da frequência. Se a visita for pulada e não reagendada, a próxima pode ser cobrada pelo intervalo real desde a última limpeza, com preço informado antes.

### CL06-F  Flat price for a one-time clean
- Templates: T2
- For the owner: One fixed price for the described job. The price changes only by a written re-quote.
- Clause text:

> **6. Price.** The price for this cleaning is {one_time_price}, fixed for the scope in Exhibit A on the date and in the condition described in Section {sec_CL02}. The price changes only by a written re-quote that Customer approves before the extra work starts.

- Fields: one_time_price
- Resumo em português: Preço único fixo para o escopo descrito. Só muda com re-orçamento por escrito aprovado antes do trabalho extra.

### CL06-G  STR per-turnover price table
- Templates: T3
- For the owner: The price depends on the size of the rental (bedrooms and baths) and any add-ons. The table is attached.
- Clause text:

> **6. Price.** The price for each turnover is shown in this table: {turnover_price_table}. Add-ons are charged only when listed or approved in writing by Owner or Manager before the work is done. Same-day, rush, and holiday turnovers are charged {rush_charge_description}. Contractor may change the table by giving at least 30 days' written notice, and the new table applies only to turnovers after the notice period.

- Fields: turnover_price_table, rush_charge_description
- Resumo em português: Tabela de preços por turnover conforme tamanho do imóvel e extras. Extras só com aprovação escrita. Mudança de tabela com 30 dias de aviso.

### CL06-H  Commercial monthly price with scope-based adjustment
- Templates: T4
- For the owner: A fixed monthly price for the Exhibit A scope, billed on the first of the month. Adjusted by signed amendment.
- Clause text:

> **6. Price.** The monthly price for the services in Exhibit A is {monthly_price}{tax_note_short}, for {visits_per_month} scheduled visits. The monthly price stays the same if the number of working days in the month changes. If Customer asks for more or fewer visits or changes Exhibit A, the price changes by a written amendment signed or approved by email by {approver_name} before the change begins. Contractor may adjust the monthly price once every {price_review_months} months by written notice of at least {price_notice_days} days.

- Fields: monthly_price, tax_note_short, visits_per_month, approver_name, price_review_months, price_notice_days
- Resumo em português: Preço mensal fixo para o escopo do Anexo A. Mudança de escopo ou de número de visitas por aditivo escrito. Revisão de preço com aviso em prazo definido.

---

### CL07  Payment, receipts and late payment

**When this block appears:** always, one payment option per contract, then one late-payment option. Payments are recorded manually (Zelle, check, cash, card link). Rafa's collections rule applies: the late-payment wording is quoted only at step three of the app's reminders, never in the due-date reminder.

Builder rule for every CL07 option: the app issues a numbered written receipt for every payment, records who received a cash payment, keeps Zelle confirmation identifiers, and never marks an invoice paid merely because a payment link was sent.

### CL07-A  Per visit, due on completion
- Templates: T1, T2
- For the owner: The customer pays at the end of each visit by an accepted method. No tax line (residential).
- Clause text:

> **7. Payment.** The price for each visit is due when the visit is complete. Payments are accepted only by: {payment_methods_list}, made out or sent to {business_legal_name}{payment_account_hint}. Do not pay cash to any person who has not given you a numbered receipt, and do not send payment to any person or account not listed here, even if asked. If you receive payment instructions that differ from this list, call Contractor at {business_phone} before paying. Contractor will give a written receipt for every payment, showing the amount, date, method and balance. A payment counts as received when it actually arrives and is matched to the invoice. No sales tax is charged on residential cleaning.

- Fields: payment_methods_list, payment_account_hint, business_phone
- Resumo em português: Pagamento no fim de cada visita, só pelos meios listados e em nome da empresa. Recibo numerado de todo pagamento, aviso de nunca pagar para conta diferente (responde ao ponto 5 da auditoria: Zelle sem proteção). Residencial não paga imposto.

### CL07-B  Monthly invoice
- Templates: T1, T3, T4
- For the owner: The company invoices completed visits once a month. The invoice lists each visit, extras, payments and credits.
- Clause text:

> **7. Payment.** Contractor will invoice the completed visits once a month, on or about {invoice_day}. Each invoice will show each visit date, any approved extra, {tax_line_sentence}each payment and credit, and the balance. Each invoice is due within {payment_terms_days} days after the invoice date. Payments are accepted only by: {payment_methods_list}, made out or sent to {business_legal_name}{payment_account_hint}. Contractor will give a written receipt for every payment. If you receive payment instructions that differ from this list, call Contractor at {business_phone} before paying.

- Fields: invoice_day, tax_line_sentence (empty for T1 and T3; for T4 "the Florida sales tax and county surtax on its own line, "), payment_terms_days, payment_methods_list, payment_account_hint, business_phone
- Resumo em português: Fatura mensal das visitas feitas, com data de cada visita, extras, imposto (só comercial), pagamentos e saldo, com prazo definido. Mesmos avisos contra pagamento para conta diferente.

### CL07-C  STR: invoice after each turnover
- Templates: T3
- For the owner: Each turnover is invoiced within a short time after the completion report, due within a few days. The invoice shows the cleaner's charge to the owner, separate from any guest cleaning fee.
- Clause text:

> **7. Payment.** Contractor will send an invoice within {invoice_after_hours} hours after each completion report. The invoice is due within {payment_terms_days} days. It shows the turnover price, approved add-ons, restock items with receipts, and any payments or credits. The invoice is Contractor's charge to {customer_label} for cleaning. It is separate from any cleaning fee {customer_label} charges guests. Payments are accepted only by: {payment_methods_list}, made out or sent to {business_legal_name}{payment_account_hint}. Contractor will give a written receipt for every payment.

- Fields: invoice_after_hours, payment_terms_days, payment_methods_list, payment_account_hint
- Resumo em português: Fatura em poucas horas depois do relatório de conclusão de cada turnover. Mostra o preço, os extras, as reposições com recibo. Separa a cobrança da empresa da taxa de limpeza que o anfitrião cobra do hóspede.

### CL07-D  Card link or saved card (separate authorization)
- Templates: all (add-on to any of A to C)
- For the owner: Only allowed with a separate written payment authorization. Saving a card does not authorize more than the authorization says.
- Clause text:

> **7. Card Payments.** If Customer pays by card, Customer authorizes only the charges described in the separate payment authorization signed or accepted on {authorization_date}. Saving a card does not authorize any other or recurring charge unless the authorization states the amount or how it is calculated, how often it is charged, and how Customer cancels it. Customer can cancel a recurring card authorization by {card_cancel_method}. Contractor will send a receipt for each charge.

- Fields: authorization_date, card_cancel_method
- Resumo em português: Cartão só com autorização separada. Cartão salvo não autoriza cobrança nova ou recorrente a menos que a autorização diga valor, frequência e como cancelar. (Cobrança recorrente online por cartão pode cair em lei federal ROSCA; ver pergunta 14.)

### CL07-E  Late payment: suspension only
- Templates: all
- For the owner: No fee or interest. If a bill is not paid, the company may suspend future visits after written notice.
- Clause text:

> **7. Late Payment.** If an invoice is not paid by its due date, Contractor will send a reminder. If an undisputed balance is still unpaid {suspension_days} days after the due date and Contractor has given written notice, Contractor may suspend future visits until the balance is paid. Suspension does not cancel what Customer owes for visits already completed.

- Fields: suspension_days
- Resumo em português: Sem juros nem taxa. Se um saldo sem disputa continuar em aberto depois do prazo e do aviso por escrito, a empresa pode suspender as próximas visitas. A dívida das visitas feitas continua.

### CL07-F  Late payment: simple interest after a grace period
- Templates: all
- For the owner: As CL07-E, plus simple interest at a rate the owner sets after a grace period. The rate cannot be set above 18 percent per year.
- Clause text:

> **7. Late Payment.** An invoice not paid within {grace_period_days} days after its due date is late. A late balance bears simple interest at {late_interest_rate} percent per year from the end of the grace period until paid. Contractor may also suspend future visits as described in this Section when an undisputed balance remains unpaid after written notice. Suspension does not cancel what Customer owes for visits already completed.

- Fields: grace_period_days, late_interest_rate (builder validation: number from 0 to 18; default 12; note: the cap comes from §687.03 as read in the construction library, which this session did not re-read; see Verification table)
- Resumo em português: Igual ao CL07-E, mais juros simples após carência. A taxa nunca passa de 18% ao ano. Aqui os juros contam a partir do fim da carência (mais conservador que o da construção). Os juros só entram na terceira etapa da cobrança.

Notes for CL07: the research for cleaning does not identify a statute for a flat late fee, and none was verified, so no option offers one (attorney question 15). §687.03 was loaded and the 18 percent usury line text was seen in this session, but the question whether interest on an unpaid service invoice falls under it, and the separate "delinquency charge" the research mentions, are left to the attorney.

---

### CL08  Cancellation, rescheduling and no-access fees

**When this block appears:** always, one option per contract. This is the owners' number one complaint (last-minute cancellations and lockouts with no written fee) and customers' number one complaint (fees they say they were never shown), so the fee is printed in this clause in plain words and also shown on the quote.

**Limits applied to every option (draft guardrails):**
1. **Reasonable estimate, not a penalty.** The research records that Florida courts will not enforce a liquidated-damages clause that operates as a penalty (Lefemine v. Baron, Fla. 1991: secondary source only; see the Verification table). The research summarizes the test as: damages not readily ascertainable at the time of contracting and the amount a reasonable estimate of the probable loss, and records that a clause giving the seller a choice between keeping the liquidated amount and suing for actual damages was treated as a sign of a penalty. The options therefore say the fee is a reasonable estimate of the company's reserved labor, travel and lost scheduling time, and that it is the only charge for that cancellation (no "or actual damages" choice). Attorney question 16 asks for confirmation.
2. **No fee when the company cancels or moves the visit.** Every option waives the fee for a Provider-initiated postponement.
3. **No fee beyond the 3-business-day cancellation right (LC1, LC2, LC3).** A customer who cancels the whole contract inside the 3-business-day window under LC1 owes nothing, and for a home solicitation sale under §501.045 the seller "is entitled to no compensation" for services performed before cancellation. The builder therefore sets the first service date after the cancellation deadline by default for T1 and any contract with LC2 or LC3, and shows the owner a warning if the owner overrides this. (This follows from the text read; whether a start inside the window is ever permitted is attorney question 10.)
4. **Fee cap guardrail** per section 1.

### CL08-A  Free cancellation with notice; fixed fee for late cancellation or no access
- Templates: T1, T2, T3, T4
- For the owner: The customer may cancel or move a visit free with enough notice. After that, one fixed fee applies. The same fee applies when the crew cannot get in.
- Clause text:

> **8. Cancelling or Moving a Visit.** Customer may cancel or reschedule a visit at no charge by telling Contractor at least {free_cancel_notice_hours} hours before the start of the arrival window, by {cancel_contact_methods}. If Customer cancels or reschedules later than that, or if Contractor cannot enter the Property after the waiting period in Section {sec_CL03} (a "no-access visit"), Customer will pay a fee of {late_cancel_fee}. Customer agrees that this fee is a reasonable estimate of the labor, travel and scheduling time Contractor reserves for each visit and cannot use for other customers, that those losses are hard to measure in advance, and that the fee is Contractor's only charge for that cancellation or no-access visit. There is no fee if Contractor cancels or moves a visit, or if the visit cannot happen because of an unsafe storm, an evacuation order, or another cause outside Customer's control that Customer tells Contractor about within {excuse_notice_hours} hours.

- Fields: free_cancel_notice_hours, cancel_contact_methods, late_cancel_fee (builder validation per section 1), excuse_notice_hours
- Resumo em português: Cancelamento ou reagendamento grátis com aviso mínimo; depois disso, uma taxa fixa, igual para visita sem acesso. A taxa é descrita como estimativa razoável do custo reservado e é a única cobrança. Sem taxa se a empresa cancelar ou houver tempestade ou evacuação.

### CL08-B  Tiered percentage of the visit price
- Templates: T1, T2, T3, T4
- For the owner: Two or three tiers by how late the cancellation is, as a share of the scheduled visit price.
- Clause text:

> **8. Cancelling or Moving a Visit.** Customer may cancel or reschedule a visit at no charge by telling Contractor at least {free_cancel_notice_hours} hours before the start of the arrival window, by {cancel_contact_methods}. If Customer cancels or reschedules between {tier2_hours_high} and {tier2_hours_low} hours before the start, Customer will pay {tier2_percent} percent of the scheduled visit price. If Customer cancels or reschedules less than {tier2_hours_low} hours before the start, on the same day, or if Contractor cannot enter the Property after the waiting period in Section {sec_CL03} (a "no-access visit"), Customer will pay {tier3_percent} percent of the scheduled visit price. Customer agrees that these amounts are a reasonable estimate of the labor, travel and scheduling time Contractor reserves for each visit and cannot use for other customers, that those losses are hard to measure in advance, and that they are Contractor's only charge for that cancellation or no-access visit. There is no charge if Contractor cancels or moves a visit, or if the visit cannot happen because of an unsafe storm, an evacuation order, or another cause outside Customer's control that Customer tells Contractor about within {excuse_notice_hours} hours.

- Fields: free_cancel_notice_hours, cancel_contact_methods, tier2_hours_high, tier2_hours_low, tier2_percent, tier3_percent (validation: tier3 at most 100; tier2 less than tier3), excuse_notice_hours
- Resumo em português: Duas faixas de aviso: cobra uma porcentagem do preço da visita em cada faixa, e a maior vale para o mesmo dia e para visita sem acesso. Mesma frase de estimativa razoável, única cobrança e isenção quando a empresa cancela ou há tempestade.

### CL08-C  No fee with notice; next visit re-priced
- Templates: T1
- For the owner: No cancellation fee at all with notice. A skipped visit means the next one is priced for the longer interval (see CL06-E). A no-access visit is still a charge.
- Clause text:

> **8. Cancelling or Moving a Visit.** Customer may cancel or reschedule a visit at no charge by telling Contractor at least {free_cancel_notice_hours} hours before the start of the arrival window, by {cancel_contact_methods}. If a visit is cancelled and not rescheduled within {reschedule_window_days} days, Section {sec_CL06} on frequency pricing applies to the next visit. If Contractor cannot enter the Property after the waiting period in Section {sec_CL03} (a "no-access visit"), Customer will pay {no_access_fee}, which Customer agrees is a reasonable estimate of the labor and travel Contractor reserved and is Contractor's only charge for that no-access visit. There is no charge if Contractor cancels or moves a visit.

- Fields: free_cancel_notice_hours, cancel_contact_methods, reschedule_window_days, no_access_fee
- Resumo em português: Sem taxa de cancelamento com aviso. Visita pulada sem reagendar muda o preço da próxima visita (CL06-E). Só a visita sem acesso gera cobrança. Boa para quem prefere evitar queixa de taxa escondida.

### CL08-D  STR turnover: short notice, same-day changes, guest cancellations
- Templates: T3
- For the owner: A booking changes often. This clause sets a short free-change window, a fee for a late change, and what happens when a guest cancels the booking after the turnover was scheduled.
- Clause text:

> **8. Changes and Cancellations.** {customer_label} may cancel or move a scheduled turnover at no charge by telling Contractor at least {free_cancel_notice_hours} hours before the scheduled start, by {cancel_contact_methods}. If {customer_label} cancels or moves a turnover later than that, or if Contractor cannot enter the Property at the scheduled time because of a lockbox, code or access problem not caused by Contractor (a "no-access visit"), {customer_label} will pay {late_cancel_fee}. If a guest cancels or leaves early after Contractor has been scheduled, the turnover can be moved to the new check-out time at no charge if {customer_label} tells Contractor by {guest_change_deadline}; after that the fee above applies. {customer_label} agrees that the fee is a reasonable estimate of the labor, travel and scheduling time Contractor reserves for each turnover and cannot use for other customers, that those losses are hard to measure in advance, and that the fee is Contractor's only charge for that cancellation. There is no charge if Contractor cancels or moves a turnover or if an unsafe storm or evacuation order prevents the visit.

- Fields: free_cancel_notice_hours, cancel_contact_methods, late_cancel_fee, guest_change_deadline
- Resumo em português: Para temporada: janela curta sem taxa, taxa para mudança em cima da hora, e o que fazer quando o hóspede cancela depois de agendado o turnover. Mesma frase de estimativa razoável e única cobrança; sem taxa em tempestade ou se a empresa cancelar.

### CL08-E  Commercial: cancellation of a single visit
- Templates: T4
- For the owner: A single office visit may be skipped or moved with notice; a late skip is charged. Holidays are agreed in advance.
- Clause text:

> **8. Skipping or Moving a Visit.** Customer may skip or move a scheduled visit at no charge by telling Contractor at least {free_cancel_notice_hours} hours before the start by {cancel_contact_methods}. If Customer skips or moves a visit later than that, or if Contractor cannot enter the Premises (a "no-access visit"), Customer will pay {late_cancel_fee}, which Customer agrees is a reasonable estimate of the labor, travel and scheduling time Contractor reserves and is Contractor's only charge for that visit. Visits on the holidays in {holiday_list} are skipped, and the monthly price in Section {sec_CL06} is {holiday_price_effect}. There is no charge if Contractor skips or moves a visit.

- Fields: free_cancel_notice_hours, cancel_contact_methods, late_cancel_fee, holiday_list, holiday_price_effect
- Resumo em português: Uma visita do escritório pode ser pulada ou movida com aviso; pulo em cima da hora tem taxa; feriados combinados valem. A taxa é a única cobrança, descrita como estimativa razoável.

---

### CL09  Term, renewal and termination

**When this block appears:** always for T1, T3 and T4; for T2 only the one-time sentence (CL09-D). Exactly one option per contract. Choosing CL09-B switches on LC4. The owner is shown the plain difference: month to month and visit-by-visit contracts do not renew by themselves and are the least exposed; a fixed term that renews by itself is exposed to the §501.165 rules.

### CL09-A  Month to month, no automatic renewal
- Templates: T1, T3, T4
- For the owner: No fixed end date. Either side may end future service with written notice. Completed visits stay payable.
- Clause text:

> **9. Term and Ending This Agreement.** This Agreement starts on {contract_date} and continues until either of us ends it. Either of us may end it for future visits by giving written notice at least {termination_notice_hours} hours before the next scheduled visit, by {termination_methods}. Customer will pay for visits already done and any fee owed under Section {sec_CL08} for a visit within the notice period. This Agreement does not renew automatically for a fixed period.

- Fields: contract_date, termination_notice_hours, termination_methods
- Resumo em português: Sem prazo fixo e sem renovação automática. Qualquer parte encerra as próximas visitas com aviso escrito antes da próxima visita. Visitas feitas continuam devidas. Nesta opção não se liga o bloco de renovação automática.

### CL09-B  Fixed term with automatic renewal
- Templates: T1, T3, T4
- For the owner: A fixed initial term that renews by itself for a set period unless the customer cancels by a stated deadline. Turns on the statutory renewal panel and reminders (LC4). Penalty: if the statute is not followed the renewal is void.
- Clause text:

> **9. Term, Renewal and Ending This Agreement.** This Agreement starts on {contract_date} and lasts for {initial_term}. **It renews automatically for {renewal_term} at the end of the initial term and of each renewal term, unless Customer cancels by {cancel_deadline_rule}.** Customer may cancel in the same way Customer accepted this Agreement ({acceptance_method}), or by {termination_methods}. {renewal_reminder_sentence} Either of us may also end this Agreement for future visits for any reason with at least {termination_notice_days} days' written notice, and Customer will pay for visits already done and any fee owed under Section {sec_CL08} for a visit within the notice period. {early_termination_sentence}

- Fields: contract_date, initial_term, renewal_term (default: "one month"; the builder warns that a renewal term longer than one month matters under the renewal law), cancel_deadline_rule, acceptance_method, termination_methods, renewal_reminder_sentence ("Contractor will send Customer a written or electronic reminder between 30 and 60 days before the cancellation deadline." when the initial term is 12 months or more, else empty), termination_notice_days, early_termination_sentence (empty, or a fee statement chosen from CL09-E)
- Resumo em português: Prazo inicial fixo que renova sozinho, a menos que o cliente cancele até o prazo, pelo mesmo meio em que aceitou. Liga o aviso destacado e o lembrete de 30 a 60 dias para contratos de 12 meses ou mais (§501.165). Se a lei não for seguida, a renovação é nula.

### CL09-C  Fixed term, ends on its own
- Templates: T1, T3, T4
- For the owner: A set number of months or visits. It ends on the end date. Renewing needs a new signed agreement.
- Clause text:

> **9. Term.** This Agreement starts on {contract_date} and ends on {end_date}, or after {visit_count} visits if sooner. It does not renew automatically. If Customer wants service to continue, Contractor will send a new agreement before the end date. Either of us may end this Agreement earlier for future visits with at least {termination_notice_days} days' written notice, and Customer will pay for visits already done and any fee owed under Section {sec_CL08} for a visit within the notice period. {early_termination_sentence}

- Fields: contract_date, end_date, visit_count, termination_notice_days, early_termination_sentence
- Resumo em português: Prazo fixo que termina sozinho, sem renovação automática. Para continuar, é preciso novo contrato assinado. Qualquer parte pode encerrar antes com aviso por escrito.

### CL09-D  One-time job: no continuing commitment
- Templates: T2
- For the owner: A single clean with no future obligation. The customer may ask for a repeat service later at a new agreement.
- Clause text:

> **9. One-Time Service.** This Agreement is for the single service described in Section {sec_CL02}. It does not obligate either of us to any later service. If Customer wants a repeat service, Contractor will send a new quote and agreement.

- Fields: none
- Resumo em português: Serviço único, sem compromisso futuro. Se o cliente quiser repetir, recebe novo orçamento e novo contrato. Isso mantém o contrato fora da regra de serviços contínuos, salvo decisão do advogado.

### CL09-E  Cause termination (add-on to A, B or C)
- Templates: all
- For the owner: Either side may end immediately for serious reasons: unsafe conditions, unlawful conduct, harassment, repeated non-payment, or a materially false statement.
- Clause text:

> **9. Ending for Cause.** Either of us may end this Agreement immediately by written notice for a material breach, unsafe working conditions, unlawful conduct, harassment of staff or Customer, repeated non-payment after written notice, or a materially false statement that matters to the services or the price. If the reason is a breach that can be fixed, the other side gets {cure_days} days' notice to fix it first. Customer pays for visits already done. Ending for cause does not waive any other right a party has.

- Fields: cure_days
- Resumo em português: Qualquer parte pode encerrar na hora por violação séria, condição insegura, conduta ilegal, assédio, inadimplência repetida ou declaração falsa relevante, com prazo para corrigir quando for possível. Visitas feitas continuam devidas.

### CL09-F  Early termination of a fixed term: no fee or stated fee
- Templates: T1, T3, T4 (only with B or C)
- For the owner: Choose whether leaving a fixed term early costs anything. The fee, if any, is a stated amount tied to the unrecovered cost, not a penalty or a percentage of the remaining months.
- Clause text (two sub-options, builder shows both and requires one):

> **No-fee version.** Early termination under this Section has no fee.
>
> **Fee version.** If Customer ends this Agreement for convenience before {end_date}, Customer will pay {early_termination_fee}, which Customer agrees is a reasonable estimate of the labor and scheduling time Contractor has reserved for the remaining term and cannot reassign, and which is Contractor's only charge for ending early. {fee_exclusions_sentence}

- Fields: end_date, early_termination_fee (validation: at most {early_fee_cap_percent} percent of the remaining contract price, default 25; product guardrail, attorney to confirm), fee_exclusions_sentence (for example "No fee applies if Contractor materially breaches this Agreement or if Customer cancels within the three business days described in the cancellation notice.")
- Resumo em português: Define se sair antes do prazo custa algo. A versão com taxa descreve um valor fixo como estimativa razoável e única cobrança, nunca um percentual do resto do contrato, e nunca vale durante o direito de cancelamento de 3 dias úteis.

---

### CL10  Damage, breakage and limits on liability

**When this block appears:** always. One option from the "damage" group (A, B or C) per contract, plus CL10-D (claim window) and CL10-E (liability limit) where offered. Never describe a cap as enforceable without attorney approval; the cap amounts are selectable only in the attorney-managed library (Admin), not typed by the client (research flag). CL10 pairs with CL12 (the before-service condition record) and CL13 (insurance).

### CL10-A  Repair or replace to current value
- Templates: all
- For the owner: If staff damage something by not using reasonable care, the company repairs or replaces it; if that is not practical, it pays the item's documented current value.
- Clause text:

> **10. Damage.** If Contractor's staff damage Customer's property because they did not use reasonable care, Contractor will repair or replace the damaged item. If repair or replacement is not practical, Contractor will pay Customer the item's current value, which Customer will document with a receipt, an appraisal, a similar listing or another reasonable record. {insurance_claim_sentence} Contractor is not responsible for harm to property that was already damaged, broken or worn before the visit, as shown by the condition record in Section {sec_CL12}.

- Fields: insurance_claim_sentence (for example "Contractor will give Customer its insurer's claim contact if Customer asks." only when LC6 allows; otherwise empty)
- Resumo em português: Se a equipe danificar por falta de cuidado razoável, a empresa conserta, troca ou paga o valor atual documentado. Não responde por dano que já existia, conforme o registro de condição da cláusula 12.

### CL10-B  Per-visit cap on property damage (attorney-managed amounts)
- Templates: T1, T2, T3
- For the owner: As CL10-A with a cap per visit. The amount is set from an attorney-approved list, not typed by the owner.
- Clause text:

> **10. Damage.** If Contractor's staff damage Customer's property because they did not use reasonable care, Contractor will repair or replace the damaged item or, if that is not practical, pay its documented current value, up to {damage_cap_per_visit} in total for any one visit. This cap does not limit Contractor's responsibility for harm caused by willful misconduct or by gross negligence, for injury to a person, or for any liability that cannot lawfully be limited. Contractor is not responsible for harm to property that was already damaged, broken or worn before the visit, as shown by the condition record in Section {sec_CL12}.

- Fields: damage_cap_per_visit (select from Admin list, for example "the greater of $X or N times the visit price"; no free typing)
- Resumo em português: Igual ao CL10-A com teto por visita, escolhido de uma lista aprovada pelo advogado. O teto não vale para má-fé, negligência grave, lesão a pessoas ou o que a lei não permite limitar. Aplicabilidade do teto é pergunta ao advogado.

### CL10-C  Exclusions: pre-existing damage, fragile and valuable items
- Templates: all (add-on to A or B)
- For the owner: Lists what the company is not responsible for: damage that was already there, normal wear, hidden defects, and fragile or valuable items not secured by the customer.
- Clause text:

> **10. What Is Not Covered.** Contractor is not responsible for damage that existed before the visit; normal wear and tear; deterioration or poor installation; hidden defects (for example a loose tile, a failing finish or a leaking fixture); or the loss of or damage to a fragile, antique or unusually valuable item ({valuables_threshold}) that Customer did not tell Contractor about and put away or point out before the first visit. Customer will put away cash, jewelry, medication, firearms, personal papers and similar items before each visit.

- Fields: valuables_threshold (for example "worth more than $250 or irreplaceable")
- Resumo em português: Lista o que a empresa não cobre: dano que já existia, desgaste normal, defeito oculto, e itens frágeis ou valiosos que o cliente não avisou ou guardou. O cliente guarda dinheiro, joias, remédios, armas e papéis pessoais.

### CL10-D  Claim window and inspection
- Templates: all
- For the owner: Customer reports visible damage within 24 or 48 hours with photos. Latent damage must be reported promptly after it is found. The company may inspect before deciding.
- Clause text:

> **10. Reporting a Problem.** Customer will report any visible damage or missing item to Contractor in writing within {claim_window_hours} hours after the visit ends, with the photos and information Customer reasonably has. Damage that is not visible on the day of the visit must be reported promptly after Customer finds it. Contractor may inspect the item and ask for photos, receipts or repair estimates before choosing a remedy. This Section does not take away any right Customer has by law that cannot be waived.

- Fields: claim_window_hours (24 or 48)
- Resumo em português: Reportar dano visível por escrito em 24 ou 48 horas com fotos; dano oculto deve ser avisado logo que descoberto. A empresa pode inspecionar e pedir fotos e orçamentos. Não retira direitos que a lei não permite renunciar.

### CL10-E  No liability for indirect loss; total limit
- Templates: T3, T4
- For the owner: Limits the company's total liability to a stated amount for commercial and STR work and rules out indirect loss such as lost bookings.
- Clause text:

> **10. Limit on Liability.** To the extent allowed by law, Contractor is not liable for lost profits, lost bookings, guest refunds, or other indirect or consequential loss, and Contractor's total liability for any claim from one visit is limited to {liability_limit}. This Section does not limit liability for injury to a person, for willful misconduct, or for anything the law does not allow to be limited.

- Fields: liability_limit (Admin-selected)
- Resumo em português: Para temporada e escritório: a empresa não responde por lucros cessantes, reservas perdidas, reembolso a hóspede ou outras perdas indiretas, e o limite total é um valor definido. Não vale para lesão a pessoas nem má-fé. Validade em consumidor é pergunta ao advogado (STR com proprietário pessoa física).

---

### CL11  Service-quality remedy: re-clean guarantee and walk-through

**When this block appears:** always, one option per contract. Never describes a refund tied to results (Rafa's rule). The remedy is re-clean first.

### CL11-A  Re-clean within 24 hours
- Templates: T1, T2, T3, T4
- For the owner: If a listed task was missed and the customer reports it within 24 hours, the company returns once to fix it at no charge. That is the remedy for a quality complaint.
- Clause text:

> **11. Re-Clean.** If Customer tells Contractor in writing within {reclean_window_hours} hours after a visit that a task marked "Included" was missed or not done to the standard in Exhibit A, with photos where possible, Contractor will return within {reclean_return_days} business days to fix that task at no charge. A re-clean is Customer's remedy for a quality complaint, except where the law gives Customer another remedy that cannot be waived. A re-clean does not cover tasks marked "Excluded" or conditions that were not in the original scope.

- Fields: reclean_window_hours, reclean_return_days
- Resumo em português: Tarefa incluída que foi esquecida e reportada em até 24 horas: a empresa volta uma vez, sem cobrar, em prazo definido. É o remédio para reclamação de qualidade, sem promessa de reembolso por resultado.

### CL11-B  Re-clean, then a credit if the re-clean is late
- Templates: T1, T2, T3
- For the owner: Re-clean first; if the company cannot return within the stated days, a reasonable credit for the affected part.
- Clause text:

> **11. Re-Clean and Credit.** If Customer tells Contractor in writing within {reclean_window_hours} hours after a visit that a task marked "Included" was missed, Contractor will first offer to return and fix it within {reclean_return_days} business days at no charge. If Contractor cannot return within that time, Contractor will give Customer a reasonable credit for the affected part of the service, as {credit_basis}. A re-clean or credit is Customer's remedy for a quality complaint, except where the law gives Customer another remedy that cannot be waived.

- Fields: reclean_window_hours, reclean_return_days, credit_basis (default: "the time that part of the visit would have taken, at the visit's hourly rate")
- Resumo em português: Primeiro volta e corrige; se não conseguir no prazo, dá um crédito razoável pela parte afetada. Nunca reembolso total por resultado.

### CL11-C  Completion walk-through (customer present)
- Templates: T1, T2, T4
- For the owner: When the customer or office contact is present at the end of the visit, they walk through with the crew lead, sign off, or list items to fix before the team leaves. Uses the CL12 checklist.
- Clause text:

> **11. Walk-Through.** If Customer or Customer's contact is present at the end of the visit, the crew lead will offer a walk-through using the checklist in Exhibit A. Customer should point out readily visible concerns at that time so they can be fixed before the crew leaves. Customer may sign or approve the completion record, or list what remains. A signed completion record is evidence that the listed items were done on that date. It does not waive Customer's right to report hidden damage under Section {sec_CL10}, or to report other service concerns within the window in Section {sec_CL11}.

- Fields: none
- Resumo em português: Se o cliente estiver presente no fim, faz-se um passeio com a lista de verificação para corrigir tudo antes de a equipe sair. O registro assinado prova o que foi feito naquela data, mas não retira o direito de reclamar de dano oculto ou de qualidade na janela definida.

---

### CL12  Pre-service condition acknowledgment, photos and walk-through checklist

This is the cleaning equivalent of the before-work condition photos in the construction library (spec C16, C17). It is the best single defense against damage and "it was already like that" disputes (owners' complaint list: breakage, re-clean demands).

**When this block appears:** always for T1, T2, T3 and T4. One option per contract. The builder creates a **Condition Record** at or before the first visit, stored with the contract, time-stamped, hashed like the contract, and shown on both sides' portals. The record has three parts: (1) a room-by-room list of existing conditions (chips, scratches, stains, cracks, loose items, existing damage), (2) photos with date and time, (3) the acknowledgment line. The builder will not release the first visit's invoice until a Condition Record exists, or the owner records why not.

### CL12-A  Before-service condition photos acknowledged by Customer (first visit)
- Templates: T1, T2, T4
- For the owner: On or before the first visit, the crew or the owner photographs existing conditions and the customer acknowledges them in the app with an e-signature.
- Clause text:

> **12. Condition Record.** Before the first visit, Contractor will record the condition of the areas to be cleaned in a Condition Record with dated photos of existing damage, wear and valuable or fragile items (the "Condition Record"). Customer may be present for this. Contractor will send Customer the Condition Record. Customer will check it and acknowledge it, or list corrections, by {condition_ack_deadline}. By acknowledging it, Customer confirms that the conditions shown existed before the first visit. If Customer does not acknowledge or correct the Condition Record by that date, Contractor may treat the photos as the starting condition, and Customer may still tell Contractor about anything Customer reasonably believes the photos left out.

- Fields: condition_ack_deadline, condition_record_id, condition_photos (Computed, hashed)
- Resumo em português: Antes da primeira visita a empresa registra o estado dos ambientes com fotos datadas e o cliente reconhece com assinatura eletrônica no app. Sem resposta até a data, as fotos valem como estado inicial, e o cliente ainda pode apontar o que faltou.

### CL12-B  Move-out or move-in: room-by-room checklist with photos before and after
- Templates: T2
- For the owner: For move-in and move-out cleans, the condition record is room by room, with photos before and after, and the checklist is signed by whoever is present.
- Clause text:

> **12. Condition Record and Checklist.** Before the cleaning, Contractor will record the condition of each room in a Condition Record with dated photos. After the cleaning, Contractor will record each task on the Exhibit A checklist as done, not done or not applicable, with dated photos of each room. Customer, or the property manager or landlord who is present, may sign the completion record. If no one is present, Contractor will send the completion record and photos to {record_recipients}. A person who is not present may report a concern about the cleaning within {claim_window_hours} hours, as Section {sec_CL10} provides. The records are stored with this Agreement.

- Fields: record_recipients, claim_window_hours
- Resumo em português: Registro por cômodo antes e depois com fotos datadas, e lista de tarefas marcada como feita, não feita ou não se aplica. Se ninguém estiver presente, a empresa envia o registro e as fotos ao responsável. Serve para a devolução do depósito ou a entrega ao proprietário.

### CL12-C  STR turnover: standing condition record, then photos after each turnover
- Templates: T3
- For the owner: A one-time baseline of the rental, then a photo set after every turnover and a note of anything new.
- Clause text:

> **12. Condition Record and Turnover Photos.** Before the first turnover, Contractor will record the condition of the Property in a baseline Condition Record with dated photos. After every turnover, Contractor will send the completion photos listed in Exhibit A and a short note of any damage, stain, missing item or safety concern the crew sees, by {report_method}. Owner will check the baseline within {condition_ack_days} days and correct anything the photos missed. Contractor's note describes what the crew saw; it is not a judgment about who caused it, and it is not a damage claim against any guest.

- Fields: report_method, condition_ack_days, condition_record_id
- Resumo em português: Registro-base do imóvel antes do primeiro turnover, e depois fotos de conclusão e relatório de danos, manchas e itens faltando a cada turnover. É um relato do que a equipe viu, não acusação contra hóspede.

### CL12-D  Walk-through checklist: acceptance record at each visit (T1 recurring)
- Templates: T1, T4
- For the owner: When someone is present, a short completion checklist is signed. When nobody is present, photos and the checklist are sent.
- Clause text:

> **12. Completion Record.** At each visit Contractor will mark the Exhibit A checklist and, where Customer is not present, send {completion_report_description} by {report_method} within {report_hours} hours after the visit. If Customer or Customer's contact is present, they may sign the checklist at the end. The completion record is evidence of what was done on that date. It does not waive Customer's rights under Sections {sec_CL10} and {sec_CL11}.

- Fields: completion_report_description (for example "a short checklist and photos of the main rooms"), report_method, report_hours
- Resumo em português: A cada visita, a equipe marca a lista; se o cliente não estiver, envia checklist e fotos. Se estiver, pode assinar no fim. O registro prova o que foi feito naquela data e não retira os direitos do cliente.

---

### CL13  Insurance and bonding

**When this block appears:** always one option per contract. Governed by LC6. The builder prints nothing about insurance or bonding unless the document is on file.

### CL13-A  Insurance as stated in the proposal
- Templates: T1, T2, T3
- For the owner: States that the company has the insurance it listed in the proposal and will show proof on request. Appears only when a current certificate is on file.
- Clause text:

> **13. Insurance.** Contractor carries the insurance listed in the proposal: {insurance_summary}. Contractor will give Customer proof of current coverage on reasonable request. Contractor has not promised any coverage that is not listed.

- Fields: insurance_summary (built from the document on file: type, insurer, expiry; limits only if shown)
- Resumo em português: A empresa tem o seguro informado na proposta e mostra comprovante se pedido. Só aparece se houver certificado válido no arquivo; não promete cobertura além do que está listado.

### CL13-B  Certificate of insurance on request, additional insured only if the policy allows
- Templates: T3, T4
- For the owner: For property managers and offices that ask for a certificate. States that a certificate does not change the policy.
- Clause text:

> **13. Insurance Certificate.** On request, Contractor will give Customer a certificate of insurance showing its commercial general liability coverage and its workers' compensation coverage or exemption, as on file: {insurance_summary}. A certificate does not change or add to the policy. Contractor will add Customer or its landlord as an additional insured only if Contractor's policy allows it and Customer asks in writing, and Contractor may charge the insurer's fee for that.

- Fields: insurance_summary
- Resumo em português: Certificado de seguro sob pedido, mostrando responsabilidade civil e compensação de trabalhadores (ou isenção). O certificado não altera a apólice. Segurado adicional só se a apólice permitir e o cliente pedir por escrito.

### CL13-C  No unverified promise (default)
- Templates: all
- For the owner: The contract says nothing about insurance, bonding or a coverage limit, because no document is on file. The company cannot claim "insured" or "bonded".
- Clause text:

> **13. Insurance.** Contractor will not be described in this Agreement as insured, bonded or carrying any particular coverage. If Customer wants proof of insurance, Customer should ask Contractor, which will give the document if it has one.

- Fields: none
- Resumo em português: Padrão quando não há documento no arquivo: o contrato não diz que a empresa é segurada nem afiançada. Evita afirmar o que não se comprova. O cliente pode pedir o comprovante.

---

### CL14  Staff disclosure and background screening

**When this block appears:** always one option per contract. T1, T2 and T3 (customer's home or rental) default to CL14-B. The builder prints "background-screened" only if the screening record in Settings allows it (LC6). Note: for a background report from a third party, the research says the federal Fair Credit Reporting Act (FCRA) requires a standalone disclosure and written permission from the worker, and pre-adverse and adverse action steps. That is an employer duty to the worker, not a customer clause, and it was not re-read in this session (secondary only; see attorney question 17).

### CL14-A  Screened personnel represented (only if the record exists)
- Templates: T1, T2, T3, T4
- For the owner: States that people assigned to the customer's home have completed the company's identity and background screening. Appears only if the screening type is recorded.
- Clause text:

> **14. Staff.** Personnel Contractor assigns to the Property have completed Contractor's {screening_description}. Screening reduces risk but does not guarantee that a person has no history or will never act improperly. Contractor will tell Customer the first name of each person assigned and will tell Customer before replacing a regular team member whenever it can.

- Fields: screening_description (from Settings; for example "identity check and criminal background check")
- Resumo em português: Diz que as pessoas enviadas passaram pela triagem descrita (só aparece se a empresa registrou qual) e que triagem diminui risco mas não garante nada. Informa o primeiro nome de cada pessoa e avisa de trocas.

### CL14-B  Employees and contractors disclosed
- Templates: all
- For the owner: States whether the people who come are employees or independent contractors and whether they follow the same screening. Does not say whether anyone is screened unless CL14-A is chosen.
- Clause text:

> **14. Staff.** The people Contractor sends to the Property are {staff_status_description}. Contractor is responsible for the services and for its staff's conduct at the Property. Contractor will give Customer the first name of each person assigned and will tell Customer before replacing a regular team member whenever it can. Customer does not direct the staff's work except by the instructions in this Agreement and Exhibit A.

- Fields: staff_status_description (for example "Contractor's employees" or "independent contractors engaged by Contractor, who are held to the same standards as employees")
- Resumo em português: Diz se quem vai é funcionário ou autônomo contratado pela empresa, que a empresa responde pelo serviço e pela conduta, e informa os nomes. Não afirma triagem. A classificação correta de funcionário e autônomo é pergunta ao advogado.

### CL14-C  No guarantee statement (add-on)
- Templates: all
- For the owner: Short sentence for any template that says screening is not a guarantee.
- Clause text:

> **14. No Guarantee.** No screening or training process guarantees that a person will never act improperly. Contractor will act promptly on any report of misconduct and will cooperate with any police report Customer makes.

- Fields: none
- Resumo em português: Frase curta: nenhuma triagem garante que ninguém jamais agirá mal. A empresa age rápido diante de relato e coopera com boletim de ocorrência.

---

### CL15  Non-solicitation of staff

**When this block appears:** optional; the owner picks one option or none (default none).

### CL15-A  Limited non-solicitation
- Templates: T1, T3, T4
- For the owner: During service and for 12 months after, the customer will not knowingly hire away a person Contractor introduced, for direct cleaning work.
- Clause text:

> **15. Direct Hiring.** During this Agreement and for {nonsolicit_months} months after it ends, Customer will not knowingly hire or pay a person Contractor introduced to Customer through the services to do cleaning work for Customer directly, without Contractor's written consent. This does not limit any person's right to answer a public job advertisement.

- Fields: nonsolicit_months (default 12)
- Resumo em português: Durante o contrato e por 12 meses o cliente não contrata diretamente quem a empresa apresentou, sem consentimento por escrito. Não limita quem responde a um anúncio público. Validade é pergunta ao advogado.

### CL15-B  Conversion fee instead of a ban
- Templates: T1, T3, T4
- For the owner: The customer may hire a cleaner directly only with consent and a stated conversion fee that reflects the company's documented recruiting and training cost.
- Clause text:

> **15. Direct Hiring.** If Customer wants to hire a person Contractor introduced, Customer will first ask Contractor in writing. Contractor may agree on the condition that Customer pays a conversion fee of {conversion_fee}, which Customer agrees is a reasonable estimate of Contractor's recruiting and training cost for that person. The fee is Contractor's only charge for that hire.

- Fields: conversion_fee (Admin cap; no typing above the cap)
- Resumo em português: O cliente pode contratar diretamente só com autorização e pagando uma taxa que reflete o custo de recrutar e treinar. A taxa é a única cobrança. Valores altos em práticas do mercado não provam que são válidos; validade é pergunta ao advogado.

### CL15-C  No restriction, with confidentiality of staff information
- Templates: all
- For the owner: The customer may hire anyone, but may not misuse the company's staff information or interfere with scheduled work.
- Clause text:

> **15. Staff Information.** Customer may deal directly with any person. Customer will not use Contractor's confidential information about its staff (such as schedules or personal details) for any other purpose, and will not interfere with Contractor's scheduled work.

- Fields: none
- Resumo em português: Sem restrição de contratar, mas o cliente não usa informações confidenciais da equipe nem atrapalha o trabalho agendado.

---

### CL16  Short-term-rental turnover specifics

**When this block appears:** T3 only. CL16-A and CL16-B are both included by default; CL16-C and CL16-D are optional add-ons.

### CL16-A  Same-day turnover, completion photos and late-guest handling
- Templates: T3
- For the owner: Sets the check-out and check-in window, what photos are taken, and what happens when the guest has not left or the next guest is early.
- Clause text:

> **16. Turnover Timing and Photos.** Contractor will clean between check-out at {checkout_time} and check-in at {checkin_time}, on days {customer_label} tells Contractor in the booking calendar or by {booking_notice_method} at least {booking_notice_hours} hours ahead. If the previous guest has not left when Contractor arrives, Contractor will wait up to {guest_wait_minutes} minutes and then call {customer_label} or the manager. If the guest still has not left, the visit is a no-access visit under Section {sec_CL08}. When finished, Contractor will send the completion photos listed in Exhibit A: {photo_list}.

- Fields: checkout_time, checkin_time, booking_notice_method, booking_notice_hours, guest_wait_minutes, photo_list
- Resumo em português: Define a janela entre check-out e check-in, o aviso de reservas e o que acontece se o hóspede ainda não saiu (espera, liga, depois conta como visita sem acesso). No fim envia as fotos de conclusão listadas.

### CL16-B  Damage and condition observations are reports, not claims
- Templates: T3
- For the owner: The crew's note about damage, stains, missing items or a safety concern is a report. The owner decides what to do and whether to tell the platform.
- Clause text:

> **16. Observations and Reports.** If the crew sees damage, a stain, a missing item, a safety concern, evidence of a party or smoking, or a pet that was not allowed, Contractor will photograph it and tell {customer_label} within {observation_report_hours} hours. These reports describe what the crew saw. Contractor does not decide who caused it, does not contact guests or booking platforms, and does not make claims on {customer_label}'s behalf. If {customer_label} has a claim with a guest or a booking platform, Contractor will give its photos and a short written statement if asked.

- Fields: observation_report_hours
- Resumo em português: Qualquer dano, mancha, item faltando, sinal de festa ou fumo é fotografado e comunicado em prazo definido. É um relato do que se viu; a empresa não decide quem causou nem aciona hóspede ou plataforma. Entrega fotos e declaração se pedida.

### CL16-C  Lockbox, code rotation and key log
- Templates: T3
- For the owner: Access by lockbox or smart lock, with a log and a rule about changing codes when a team member leaves.
- Clause text:

> **16. Lockbox and Codes.** Contractor will enter by {entry_method}. Contractor will keep a log of who entered and when. If a team member leaves Contractor, Contractor will tell {customer_label} within {team_change_notice_hours} hours so that {customer_label} can change the code. Contractor will not share codes with anyone not assigned to the Property.

- Fields: entry_method, team_change_notice_hours
- Resumo em português: Entrada por lockbox ou fechadura inteligente com registro de quem entrou e quando. Se alguém sai da equipe, a empresa avisa em prazo definido para o proprietário trocar o código. Não compartilha códigos.

### CL16-D  Guest fee separation statement
- Templates: T3
- For the owner: Makes clear the cleaner's invoice is separate from the host's guest cleaning fee, which the Department of Revenue treats differently for tax.
- Clause text:

> **16. Guest Cleaning Fee.** Contractor's invoice is for cleaning services provided to {customer_label}. Any cleaning fee {customer_label} charges guests is {customer_label}'s own charge. Contractor has no part in setting, collecting or reporting that fee or any tax on it.

- Fields: none
- Resumo em português: A fatura da empresa é pelo serviço de limpeza ao proprietário; a taxa de limpeza cobrada do hóspede é do proprietário, e o imposto sobre ela também. A empresa não participa disso.

---

### CL17  Commercial office specifics

**When this block appears:** T4 only. CL17-A and CL17-B are both included by default; CL17-C is optional.

### CL17-A  Confidentiality, restricted areas, and no handling of documents
- Templates: T4
- For the owner: The crew keeps what they see at the office confidential and does not touch restricted areas or confidential papers.
- Clause text:

> **17. Confidentiality and Restricted Areas.** Contractor's staff will not read, copy, move or remove papers, files or devices at the Premises, will not enter areas Customer marks as restricted in Exhibit A, and will keep confidential what they see at the Premises. Customer is responsible for securing confidential material before each visit.

- Fields: none
- Resumo em português: A equipe não lê, copia, move ou leva papéis, arquivos ou aparelhos; não entra em áreas restritas; e mantém sigilo. O cliente guarda material confidencial antes de cada visita.

### CL17-B  Trash, recycling, hazardous waste and shared building rules
- Templates: T4
- For the owner: Sets where trash goes and what the crew will not handle. The customer or landlord gives building rules.
- Clause text:

> **17. Waste and Building Rules.** Contractor will collect trash and recycling from the bins listed in Exhibit A and take it to {waste_location}. Contractor does not handle hazardous, medical, or electronic waste, broken glass above {glass_limit}, or sharps. Customer will give Contractor any building rule about loading dock use, elevators, parking, insurance certificates or sign-in, in writing, before the first visit, and Contractor will follow them. Contractor will keep the cleaning closet neat and secure.

- Fields: waste_location, glass_limit
- Resumo em português: Define onde vai o lixo e a reciclagem e o que a equipe não manuseia (resíduo perigoso, médico, eletrônico, vidro grande, agulhas). O cliente informa por escrito as regras do prédio (doca, elevador, estacionamento, certificado, registro de entrada).

### CL17-C  Subcontractors and certificate requirements from the landlord
- Templates: T4
- For the owner: If the company may use a subcontractor and the landlord requires an insurance certificate, this says so. Appears only when the document exists.
- Clause text:

> **17. Subcontractors and Landlord Requirements.** Contractor may use a subcontractor for part of the services only with Customer's written consent, and remains responsible for that work. If the landlord or building manager requires Contractor to give a certificate of insurance or other document before entry, Customer will tell Contractor what is required and by when, in writing, and Contractor will provide the document if it has it. Customer will not hold Contractor responsible for delays caused by a requirement Customer did not tell Contractor about.

- Fields: none
- Resumo em português: A empresa só usa subcontratado com consentimento por escrito e continua responsável. Se o prédio exige certificado de seguro, o cliente avisa por escrito e a empresa entrega o documento se o tiver. Sem culpa por atraso por exigência não informada.

---

### CL18  Dispute resolution

**When this block appears:** always, one option per contract. Written for attorney review: the attorney writes or approves each version. No option opts out of any statute that protects the customer. Venue is the county of the Property.

### CL18-A  Talk first, then mediation, then court in the Property's county
- Templates: all
- For the owner: The two sides first talk and try mediation, then use court. Either may use small claims court for small amounts.
- Clause text:

> **18. Disputes.** If a disagreement arises about this Agreement, we will first try to settle it by talking, in writing, within {negotiation_days} days after one of us gives written notice of the problem. If that does not settle it, we will try mediation with a mediator we both agree on, and we will share the mediator's fee equally. If it is not settled after mediation, either of us may bring a case in the courts of {property_county} County, Florida. Either of us may start a small claims case in {property_county} County without first going to mediation. Nothing here stops a party from asking a court for urgent relief.

- Fields: negotiation_days, property_county
- Resumo em português: Primeiro conversa por escrito, depois mediação (custo dividido), e só então o tribunal do condado do imóvel. Qualquer parte pode ir ao tribunal de pequenas causas sem mediação. Não impede pedido de medida urgente.

### CL18-B  Binding arbitration after mediation (attorney-managed; commercial only by default)
- Templates: T4 (T3 if attorney allows)
- For the owner: As CL18-A, with binding arbitration in place of court. Offered by default only for commercial customers, because mandatory arbitration with a consumer needs attorney approval.
- Clause text:

> **18. Disputes.** If a disagreement arises about this Agreement, we will first try to settle it by talking, in writing, within {negotiation_days} days after one of us gives written notice of the problem, and then by mediation. If it is not settled, either of us may require arbitration under {arbitration_rules} in {property_county} County, Florida. The arbitrator's decision is final and a court may enter judgment on it. {arbitration_fee_allocation} Either of us may start a small claims case in {property_county} County for an amount within the small claims limit without arbitration. Nothing here stops a party from asking a court for urgent relief.

- Fields: negotiation_days, property_county, arbitration_rules (Admin, attorney-set), arbitration_fee_allocation (Admin, attorney-set)
- Resumo em português: Igual ao CL18-A, com arbitragem vinculante no lugar do tribunal, regras e divisão de custos definidas pelo advogado. Só por padrão para clientes comerciais; com consumidor precisa aprovação do advogado.

### CL18-C  Prevailing-party fees and jury waiver (commercial only by default)
- Templates: T4
- For the owner: As CL18-A, plus fees for the winning side, and a waiver of jury trial. Offered by default only for commercial customers.
- Clause text:

> **18. Disputes.** (First two sentences as CL18-A.) In a case or arbitration about this Agreement, the party that wins will recover its reasonable attorney fees and costs from the other. Each of us waives the right to a jury trial in any case about this Agreement. Either of us may start a small claims case in {property_county} County without first going to mediation. Nothing here stops a party from asking a court for urgent relief.

- Fields: property_county, negotiation_days
- Resumo em português: Igual ao CL18-A, mais honorários para quem vencer e renúncia a júri. Só por padrão para clientes comerciais. Validade e reciprocidade em contrato com consumidor são perguntas ao advogado.

---

### CL19  Entire agreement, notices, electronic signatures, severability, governing law

**When this block appears:** always. Pairs with the contract builder's audit record: final rendered agreement, clause version IDs, timestamp, signer identity, consent event, and proof the customer could download and keep a copy.

### CL19-A  Standard general terms
- Templates: all
- For the owner: Entire agreement, written changes, notices by email or text, electronic signatures, severability and Florida law.
- Clause text:

> **19. General Terms.** **Entire agreement.** This Agreement, with Exhibit A and any Condition Record and written change, is the whole agreement. It replaces earlier talks and quotes. **Changes.** A change to price, schedule or scope is effective only if it is in writing and approved by Customer and Contractor (a text or email approval is enough). **Notices.** Notices go to the email or phone number in Section {sec_CL01}, and to {notice_address_alt} if given. A notice by email or text is received when sent unless the sender gets an error message. **Electronic signatures and records.** We agree to sign this Agreement electronically and to receive records electronically. Each electronic signature is as valid as an ink signature, and Customer may download and keep a copy. **Severability.** If a part is found unenforceable, the rest stays in effect. **Governing law.** Florida law governs this Agreement. **No assignment.** Customer will not assign this Agreement without Contractor's written consent.

- Fields: notice_address_alt
- Resumo em português: Acordo completo (substitui conversas e orçamentos anteriores), mudanças só por escrito (texto ou email serve), avisos por email ou telefone, assinatura eletrônica válida com cópia para o cliente, validade parcial e lei da Flórida. A lei da Flórida sobre assinatura eletrônica (§668.50) foi lida; o texto da lei federal ESIGN não foi relido.

### CL19-B  Standard terms plus courtesy Portuguese translation (LOCKED pending the attorney)
- Templates: all
- For the owner: As CL19-A, plus a statement that a Portuguese translation is provided as a courtesy and the English controls. LOCKED, not available until the attorney answers whether this is acceptable when the sales presentation is in Portuguese (LC2 requires the contract in the language principally used in the oral presentation).
- Clause text:

> (All of CL19-A.) **Translation.** A Portuguese translation of this Agreement is provided for Customer's convenience. If the English and Portuguese differ, the English controls. {translation_notice_sentence}

- Fields: translation_notice_sentence
- Resumo em português: Igual ao CL19-A, mais a nota de que a tradução em português é cortesia e o inglês prevalece. Bloqueado até o advogado responder (a regra federal exige o contrato na língua da apresentação oral).

---

## 5. Placeholder fields

Sources: **Lead** (lead record), **Quote** (the accepted quote version), **Settings** (client settings, set once by the business), **Admin** (Apex admin-managed compliance data, never edited by clients), **Builder** (asked in the contract builder for this contract), **Computed** (calculated by the app), **Signing** (captured during e-signature), **Condition Record** (the CL12 record).

| Field | Meaning | Source |
|---|---|---|
| access_change_notice_hours | Hours' notice of a change to access info | Settings |
| access_instructions | Key, lockbox or door code details (never printed in plain text) | Builder, encrypted |
| access_wait_minutes | Minutes the crew waits before a no-access visit | Settings |
| acceptance_method | How the customer accepted (for example e-signature in the portal) | Signing |
| alarm_gate_instructions | Alarm, gate, smart lock, parking instructions (encrypted) | Builder |
| annual_increase_cap_percent | Cap on a yearly price increase | Settings |
| approver_name | Person at the customer who approves changes | Builder |
| arbitration_fee_allocation, arbitration_rules | Attorney-set | Admin |
| arrival_window | Window in which the crew arrives | Quote |
| business_address, business_legal_name, business_phone | Company data | Settings |
| cancel_contact_methods | How the customer cancels or reschedules | Settings |
| cancel_deadline_date, cancel_deadline_rule | Date or rule for cancelling a renewal | Computed |
| claim_window_hours | 24 or 48 | Settings |
| clean_type | Type of one-time clean | Quote |
| condition_ack_deadline, condition_ack_days | Deadline to acknowledge the Condition Record | Settings |
| condition_record_id, condition_photos | The record and its hashed photos | Condition Record |
| contract_date | Date the contract is signed | Signing |
| county_surtax_rate, service_county | County surtax and service location | Admin (table with effective dates) |
| credit_basis | How a credit is computed | Settings |
| customer_address, customer_email, customer_entity_name, customer_entity_type, customer_full_name, customer_phone | Customer data | Lead |
| customer_label | "Customer", "Owner" or "Manager" | Builder |
| customer_provided_items, customer_supplies_list | What the customer supplies | Builder |
| customer_signature, customer_signature_date | Customer signature and date | Signing |
| damage_cap_per_visit, liability_limit | Attorney-approved amounts | Admin |
| early_termination_fee, early_fee_cap_percent | Early termination fee and its cap | Settings, Admin |
| end_date, initial_term, renewal_term, visit_count | Term fields | Quote |
| free_cancel_notice_hours, late_cancel_fee, no_access_fee | Cancellation notice and fees | Settings (validated per section 1) |
| frequency, service_day | Recurrence | Quote |
| grace_period_days, late_interest_rate | Late payment | Settings (rate validated 0 to 18) |
| holiday_list | Holidays observed | Settings |
| hours_per_visit, crew_size | Purchased time | Quote |
| insurance_summary | Insurance as on file | Settings, document-backed (LC6) |
| invoice_day, payment_terms_days | Billing rhythm | Quote |
| landlord_consent_sentence | Optional sentence | Builder |
| late_tolerance_minutes, start_time | Appointment fields | Quote |
| monthly_price, one_time_price, visit_price, turnover_price_table | Price | Quote |
| nonsolicit_months, conversion_fee | Non-solicitation | Settings, Admin cap |
| payment_account_hint, payment_methods_list | Payment methods | Settings |
| pets_list | Disclosed pets | Builder |
| property_county, service_address | Location | Lead |
| reclean_return_days, reclean_window_hours | Re-clean timing | Settings |
| renewal_date, renewal_notice_sentence, renewal_reminder_sentence | Renewal reminders | Computed |
| scope_checklist (Exhibit A) | Included and excluded tasks | Quote |
| screening_description, staff_status_description | Staff facts | Settings |
| suspension_days | Days before suspension | Settings |
| termination_methods, termination_notice_days, termination_notice_hours | Ending the contract | Settings |
| transaction_date | Date of the sale (for notice forms) | Signing |

(Only fields not self-explanatory in a clause are listed; the builder derives the rest from the clause text and refuses to save a clause with an unfilled placeholder.)

---

## 6. Attorney review list (questions for a Florida attorney)

These are the points this draft deliberately did NOT resolve. Numbering is for this library only.

**Locked blocks**
1. **LC1 scope.** Rule 2-18.002 reaches "any contract which includes a provision for consumer services to be rendered in the future on a continuing basis". Does a recurring residential cleaning contract fit? Does it matter whether the contract has a fixed term, is month to month, or is booked visit by visit with no commitment?
2. **LC1 and business customers.** The rule text read does not define "consumer" or exclude business customers. Should the notice be inserted for STR owners (individuals renting out their home) and for small-office tenants, or only for individuals buying for personal, family or household use? Is it harmless to include it anyway?
3. **LC1 "business day".** The rule does not define it. Should the builder use §501.021(2) (any calendar day except Sunday or a federal holiday)?
4. **LC1-B assignee warning wording.** The copy read prints "This contract or note is the future consumer services and puts all assignees on notice of the consumer's right to cancel under Chapter 2-18, F.A.C." Please supply the exact official wording. Must it print on a contract that is never assigned?
5. **LC2 and cleaning (the key open point).** The FTC definition excludes a transaction where the buyer initiated contact and requested a visit "for the purpose of repairing or performing maintenance upon the buyer's personal property." Is customer-requested house or office cleaning within that exclusion, given the text names personal property and a home is real property? When a cleaner visits for a free in-home quote and the customer signs on the spot, is LC2 required? Is the answer the same for T2 (one visit) and for T3 and T4?
6. **LC2 language.** The rule requires the contract and forms in the language principally used in the oral presentation. Many sales will be presented in Portuguese. What must the builder do? May it provide the English contract plus a Portuguese version of the forms, and which version controls (CL19-B is locked pending your answer)?
7. **LC2-B form.** May the goods-return paragraphs of the NOTICE OF CANCELLATION be omitted for a pure services contract, or must the form be printed whole?
8. **LC3.** Does a quote the homeowner requested ("a request for specific goods or services by the purchaser") take ordinary cleaning sales outside the Home Solicitation Sales Act? Is a §501.022 home solicitation permit ever needed by a cleaning company or its salesperson (the express-invitation exclusion appears in §501.022(1)(b)2)? Is it acceptable to print both LC2 and LC3 whenever the sale was made at the home?
9. **LC4 and month-to-month.** Is an open-ended month-to-month contract a "service contract" with an "automatic renewal provision" under §501.165? The definition uses a fixed period or specified duration. Does a one-month renewal term ever count? Is the 45-day reminder timing acceptable given the statute's wording ("no less than 30 days or no more than 60 days")?
10. **Start before the cancellation deadline.** Under §501.045 the seller "is entitled to no compensation" for services performed before cancellation of a home solicitation sale. Does the first cleaning have to wait until the 3-business-day cancellation deadline passes? What if the customer asks for same-week service in writing?
11. **LC5 tax.** Please have a tax professional confirm: (a) mixed-use buildings; (b) whether a lodging establishment or an STR run as a business is "nonresidential" for the cleaner's invoice; (c) carpet cleaning in a commercial office (the brochure lists carpet cleaning as nontaxable); (d) a bundled price (cleaning, supplies, restocking); (e) Rule 12A-1.061 on mandatory guest cleaning fees (not read); (f) the wording of LC5-A and LC5-B.
12. **Licensing.** No Florida occupational license for ordinary house or office cleaning was found, and absence of a license could not be verified from a source. Please confirm that none is needed for the services in Exhibit A, especially: mold remediation above 10 square feet (the mold assessor and remediator sections of chapter 468, ss. 468.8411 and 468.8419, as read), biohazard or crime-scene cleanup, pest control, pressure washing, and work done on an active construction project. Which county and city business tax receipts does a cleaner need (§205.042 lets municipalities levy a business tax; county rules were not read)? Does an STR host need DBPR vacation rental licensing that affects the cleaner's contract (not read)?
13. **LC7 construction notices.** Please confirm that the construction lien notice, the Recovery Fund notice and the §558 notice do not apply to ordinary cleaning, and tell us whether post-construction "final clean" work for a builder changes that.

**Clause options**
14. **CL07-D and ROSCA.** For online recurring card charges, does the federal ROSCA (15 U.S.C. 8403, not re-read in this session) apply to a cleaner's payment link or saved card? What must the separate authorization say? (The FTC "click to cancel" rule was reported vacated in July 2025 in the research; that was not re-verified.)
15. **CL07-F and late fees.** Does the §687.03 usury limit apply to contract interest on an unpaid cleaning invoice? The research mentions a delinquency-charge rule in Chapter 687 and a statute rate that applies when the contract is silent; neither was verified. Should residential and commercial late-fee clauses differ? Is simple interest from the end of the grace period acceptable? May the library offer a flat fee?
16. **CL08 fees.** Do the cancellation and no-access fees satisfy Florida's liquidated-damages test (Lefemine v. Baron, Fla. 1991, read only through secondary summaries)? Is the "only charge" and "reasonable estimate" wording enough? Should the library cap a fee at a percent of the visit price? Is it acceptable for residential customers? Do the "no fee on storm or evacuation" and "customer's report within X hours" conditions create any problem?
17. **CL09.** Is an early-termination fee acceptable in a consumer service contract (CL09-F)? Is the asymmetric cause termination (CL09-E) enforceable? Must the contract state a final-service obligation (a competitor's 30-day notice plus a final cleaning was a customer complaint)?
18. **CL10 caps.** Are the per-visit damage cap (CL10-B) and the total liability limit (CL10-E) enforceable in a Florida consumer contract? Are the carve-outs enough (willful misconduct, gross negligence, personal injury, non-waivable rights)? Should the library disclaim implied warranties for cleaning services (this draft does not)?
19. **CL12.** Is the signed Condition Record, with photos, enough to shift the burden on "it was already like that"? Is deemed acknowledgment (if the customer does not respond by the deadline) acceptable?
20. **CL13.** Should "insured" language ever appear without a certificate? Is the workers' compensation language correct for a cleaner who uses independent contractors? (Chapter 440 was not read.)
21. **CL14.** Does the statement "employees or independent contractors" create misclassification exposure for the cleaning company? FCRA (not re-read): which disclosures to workers are required if the company runs a third-party background report, and do any customer-facing statements about screening create liability?
22. **CL15.** Are the non-solicitation (CL15-A) and conversion fee (CL15-B) clauses enforceable against a consumer or a small business under Florida law, including section 542.335 (not read)? The research found published policies with very large fees; that does not show enforceability.
23. **CL16.** For STR, does the cleaner's "observation report" create duties or liability toward the host or guests? Is there anything about guest privacy (photos of an occupied rental) to add?
24. **CL18.** Please write or approve each package: arbitration rules and fee split; whether mandatory arbitration, a jury waiver and a prevailing-party fee clause are enforceable against a consumer; whether a one-sided fee clause becomes reciprocal under Florida law; small claims language.
25. **CL19.** Is the Florida UETA language (§668.50 was read) and the federal ESIGN (not read) enough? Is "text or email approval" enough for a change to price or scope? Is a courtesy Portuguese translation (CL19-B) acceptable?
26. **Auto-renewal reminders.** Please confirm the wording of LC4-A and LC4-B (both drafted by this library; the statute prescribes no words).
27. **Overall.** Are any of these four templates unsuitable to sell as written, and are there cleaning-specific Florida rules this draft missed (for example Chapter 501 Part II, the Florida Deceptive and Unfair Trade Practices Act, as applied to cancellation fees and recurring services)?

---

## 7. Verification summary table

Verification date for every row marked "2026-10-04": read in this session. "Primary" means the text of the official source itself, or an official-agency publication, was read. "Near-official" means a faithful published copy of the official code (Cornell LII for the Florida Administrative Code) was read and the official page could not be. "Secondary" means a summary or search result was read, not the official text. "Not verified" means this library relied only on the research file.

| # | Legal claim | Source URL | Verified | Primary or secondary |
|---|---|---|---|---|
| 1 | Rule 2-18.002(1) to (5), F.A.C.: definition of contract for future consumer services; 10-point bold notice beside signature; the three statements; 20-day refund rule | https://www.law.cornell.edu/regulations/florida/Fla-Admin-Code-Ann-R-2-18-002 (official page, metadata only: https://www.flrules.org/gateway/ruleNo.asp?id=2-18.002) | 2026-10-04 | Near-official (Cornell copy of the code). Official flrules.org page text was not readable. |
| 2 | Rule 2-18.002(3) assignee warning wording | same | 2026-10-04 | Near-official; the printed sentence appears incomplete, so it is NOT used (LC1-B off) |
| 3 | Rule 2-18.002 does not define "business day" or "consumer"; rulemaking authority §501.205, law implemented §501.204; last amended 6-19-96 | same | 2026-10-04 | Near-official |
| 4 | §501.021 definitions: home solicitation sale ($25, personal solicitation away from fixed location, excludes sales resulting from a request by the purchaser for specific goods or services); business day; future delivery | http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0500-0599/0501/Sections/0501.021.html | 2026-10-04 | Primary |
| 5 | §501.022 permit requirement and exclusions (including express invitation of an inhabitant; business visits for the customer's business) | same path, 0501.022.html | 2026-10-04 | Primary (permit application details not needed; first part read) |
| 6 | §501.025 right to cancel until midnight of the third business day; notice by person, telegram or mail; mail effective on postmarking | same path, 0501.025.html | 2026-10-04 | Primary |
| 7 | §501.031 "BUYER'S RIGHT TO CANCEL" statement and conspicuous caption | same path, 0501.031.html | 2026-10-04 | Primary (verbatim in LC3-A) |
| 8 | §501.041 refund within 10 days; §501.045 no compensation for services performed before cancellation; §501.055 penalties | same path, 0501.041.html, 0501.045.html, 0501.055.html | 2026-10-04 | Primary |
| 9 | 16 CFR 429.1(a) to (i): seller duties, statement wording, NOTICE OF CANCELLATION wording, oral notice, 10-business-day refund | https://www.ecfr.gov/current/title-16/chapter-I/subchapter-D/part-429/section-429.1 (via renderer API) | 2026-10-04 | Primary (verbatim in LC2-A, LC2-B) |
| 10 | 16 CFR 429.0 definitions: door-to-door sale ($25 at the residence, $130 elsewhere), exclusions including (5) requested repair or maintenance of personal property, consumer goods or services, business day | https://www.ecfr.gov/current/title-16/chapter-I/subchapter-D/part-429/section-429.0 | 2026-10-04 | Primary |
| 11 | Whether customer-requested cleaning is excluded "maintenance" | none | Not resolved | Attorney question 5 |
| 12 | §501.165 automatic renewal: definitions, conspicuous disclosure, 12-month notice with the 30 to 60 day window as printed, same-manner cancellation, exemptions, void if violated | http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0500-0599/0501/Sections/0501.165.html | 2026-10-04 | Primary |
| 13 | Month-to-month contract outside or inside §501.165 | none | Not resolved | Attorney question 9 |
| 14 | §212.05(1)(i)1.b: 6 percent on nonresidential cleaning (NAICS 561710 and 561720) | http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0200-0299/0212/Sections/0212.05.html | 2026-10-04 | Primary |
| 15 | DOR GT-800015 (R.09/22): nonresidential cleaning taxable (state 6 percent plus county surtax; registration; DR-14 exemption); residential not taxable; carpet cleaning and exterior pressure washing nontaxable; mandatory guest cleaning fee is part of taxable rent; cleaner pays tax on supplies | https://floridarevenue.com/Forms_library/current/brochure/gt800015.pdf | 2026-10-04 | Primary (official agency publication; "general information") |
| 16 | Rule 12A-1.061 (guest cleaning fee as rental) | cited inside GT-800015 only | Not read | Not verified |
| 17 | §468.8411 mold remediation means greater than 10 square feet; §468.8419 prohibitions on performing remediation without complying with that part of chapter 468 | http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0400-0499/0468/Sections/0468.8411.html and 0468.8419.html | 2026-10-04 | Primary |
| 18 | §205.042 municipalities may levy a local business tax (county authority and exemptions not read) | http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0200-0299/0205/Sections/0205.042.html | 2026-10-04 | Primary (partial: municipal levy only) |
| 19 | No state license needed for ordinary house or office cleaning | none | Could NOT be verified; absence cannot be shown from a source | Attorney question 12 |
| 20 | Florida Uniform Electronic Transaction Act §668.50(7): electronic records, signatures and contracts not denied effect solely because electronic | http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0600-0699/0668/Sections/0668.50.html | 2026-10-04 | Primary (section 7 heading and structure seen; sub-paragraph wording was not quoted in this draft) |
| 21 | §687.03 usury 18 percent simple interest | http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0600-0699/0687/Sections/0687.03.html | 2026-10-04 (page fetched; the usury sentence was seen; threshold above $500,000 not re-read here); cleaning-invoice application not resolved | Primary for the limit, open for application (question 15) |
| 22 | Lefemine v. Baron, 573 So. 2d 326 (Fla. 1991): liquidated damages unenforceable as a penalty; the option to retain or sue for actual damages signals a penalty | https://law.justia.com/cases/florida/supreme-court/1991/75806-0.html and a search summary on 2026-10-04 | Opinion text could not be fetched (page returned no text) | Secondary (search summary only) |
| 23 | Construction lien, Recovery Fund and defect notices do not apply to cleaning | none | Not resolved | Attorney question 13 |
| 24 | ROSCA 15 U.S.C. 8403 online recurring charges; FTC click-to-cancel rule vacated July 2025 | from the spec and research | Not re-read | Not verified (research only; attorney question 14) |
| 25 | FCRA disclosure and consent duties for employer background reports; EEOC and FTC guidance | from the research | Not read | Not verified (attorney question 21) |
| 26 | Liability caps, non-solicit fees, arbitration and jury waivers in consumer cleaning contracts | none | Not resolved | Attorney questions 18, 22, 24 |
| 27 | Competitor and industry clause patterns (24 to 48 hour claim windows, re-clean guarantees, lockout fees, price-increase caps) | research file R3-A (company policy pages, not re-fetched) | Not re-checked | Secondary (patterns, not law; no endorsement by any industry association was found) |
| 28 | Owner and customer complaint patterns | research file R3-B (Grok; links unverified; Reddit blocked) | Not re-checked | Secondary |

### Things this library could not do

- Read the official flrules.org text of Rule 2-18.002 (it shows only the metadata and a viewer link); the Cornell LII copy was used and labeled near-official. The assignee warning in subsection (3) printed incompletely and is not enabled.
- Fetch the text of Lefemine v. Baron (two sites returned nothing readable); the case point is secondary only.
- Verify that no state license is needed for cleaning, county business tax requirements, the FCRA, ROSCA, Chapter 440 workers' compensation, Rule 12A-1.061, or §542.335. They are listed as attorney or tax questions.
- Resolve whether the FTC "maintenance" exclusion reaches cleaning, whether Rule 2-18.002 reaches business customers, or whether month-to-month is outside §501.165.
- Locate any Portuguese-language statutory text. Portuguese lines are for Rafa's review only and are not printed on contracts.
