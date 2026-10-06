// Writes data/contract-state-checklist-v1.json: the sorting of every "Before
// you send" line into ACTION (A), HANDLED (H) or BACKGROUND (B), with the
// short action sentence in English and Portuguese.
//
// The sorting is a judgment made by reading data/contract-state-riders-v1.json.
// It is kept here as a table (one short row per line) because that is easier
// to read and correct than the JSON it produces. After changing a row, run:
//   node scripts/make-state-checklist-data.mjs
//   node scripts/make-state-checklist-review.mjs
//   node scripts/test-state-checklist.mjs
// No network. Writes one file: data/contract-state-checklist-v1.json.
//
// Row shapes:
//   A(en, pt, opts)  an action line. opts.ref = the law reference to show (when
//                    left out, the line's own cite from the rider data is used);
//                    opts.flag = why the sorting is unsure (review file only).
//                    opts.sys  = the system does or sees this line itself (see SYS
//                                below); sys_en / sys_pt = the line's label then.
//                    opts.fact = the one fact the line depends on (see FACTS). The
//                                line leaves the card when the answer is "no".
//                    opts.style = how the statute says the notice must look when
//                                the system prints it ({ bold, min_pt }).
//                    opts.docs = for sys "deliver": the notice ids handed over.
//                    opts.needs = why a line whose wording is on file is still
//                                left to a person (summary file only).
//   H(why, flag)     the builder already does it.
//   B(why, flag)     context only.
// {state} in a sentence becomes the state's name.
//                    RES-36 (see FINISH below): parts, only_yes, biz_key, ask, also,
//                    official = how the system finishes a line whose wording is on file.
import { writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";

function A(en, pt, o) { o = o || {}; var x = { c: "A", en: en, pt: pt }; ["ref", "ref_pt", "ref_from", "flag", "unless", "sys", "sys_en", "sys_pt", "fact", "style", "docs", "needs", "outside", "held"].forEach(function (k) { if (o[k]) { x[k] = o[k]; } }); return x; }
function H(why, flag) { var x = { c: "H", why: why }; if (flag) { x.flag = flag; } return x; }
function B(why, flag) { var x = { c: "B", why: why }; if (flag) { x.flag = flag; } return x; }

// What the system can do or see by itself. kind "does": the builder does it.
// kind "sees": a person does it inside Apex and the builder notices.
// Anything without sys is PERSON ONLY (a hand tick).
var SYS = {
  print: "does",          // prints the notice in the contract (official wording on file)
  deliver: "does",        // hands the customer a document with the contract, before they sign
  signed_copy: "does",    // the customer's link becomes the complete signed copy
  language: "does",       // the contract is in the language of the sale (English only)
  second_signer: "sees",  // a second customer signer has signed
  photos: "sees",         // a signed condition acknowledgment with photos exists for the job
  signed: "sees",         // the company and the customer have both signed
  sent: "sees",           // the company has signed and the contract was sent
  license: "sees",        // the license number is on file
  deposit: "sees",        // the first payment is within the state's limit
  parts: "does",          // RES-36: prints the notice where and how the law says, with its
                          // blanks filled, and collects the signature or initials it needs
                          // inside the customer's own signing visit
  list: "does",           // builds the subcontractor and supplier list from the project and
                          // gives it to the customer with the contract
  email: "does",          // puts the required sentence beside the message that sends the contract
  official: "does"        // hands over the agency's own document (loaded by Apex staff) with
                          // the contract, and collects the signed acknowledgment when required
};
// The one-question facts. Asked in "This contract", Yes / No / Not sure, and
// only in a state that has a line depending on the fact. "Not sure" and no
// answer both take the safe side (the line stays, the notice prints).
// known: the builder already knows the answer and never asks.
var FACTS = {
  homestead: { en: "Is this the customer's homestead (the home they own and live in)?", pt: "Este im\u00f3vel \u00e9 o homestead do cliente (a casa pr\u00f3pria onde ele mora)?" },
  married: { en: "Is the customer married?", pt: "O cliente \u00e9 casado?" },
  subs: { en: "Will subcontractors or suppliers work on this job?", pt: "Subempreiteiros ou fornecedores v\u00e3o participar deste servi\u00e7o?", known: "The project already has a subcontractor assigned." },
  big_build: { en: "Is this a new home, or a remodel that costs more than half of the home's assessed value?", pt: "\u00c9 uma casa nova, ou uma reforma que custa mais da metade do valor avaliado da casa?" },
  sale_english: { en: "Was the sale made in English?", pt: "A venda foi feita em ingl\u00eas?" },
  credit: { en: "Is the customer paying on credit (in installments or with a finance charge)?", pt: "O cliente vai pagar a cr\u00e9dito (parcelado ou com juros)?" },
  age65: { en: "Is the customer 65 or older?", pt: "O cliente tem 65 anos ou mais?" },
  age62: { en: "Is the customer 62 or older?", pt: "O cliente tem 62 anos ou mais?" },
  insurance_paid: { en: "Is an insurance claim paying for this job?", pt: "Um seguro vai pagar este servi\u00e7o?" },
  note: { en: "Is the customer signing a promissory note?", pt: "O cliente vai assinar uma nota promiss\u00f3ria?" },
  secured: { en: "Is payment secured by the customer's home (a lien or mortgage)?", pt: "O pagamento \u00e9 garantido pela casa do cliente (gravame ou hipoteca)?" },
  new_home: { en: "Is this the sale or construction of a newly built home?", pt: "\u00c9 a venda ou a constru\u00e7\u00e3o de uma casa nova?" },
  disaster: { en: "Is this a repair of damage from a disaster with a declared state of emergency?", pt: "\u00c9 um reparo de dano causado por desastre com estado de emerg\u00eancia declarado?" },
  small_repair: { en: "Is this a service and repair job of $750.00 or less that the customer called you about?", pt: "\u00c9 um servi\u00e7o de reparo de at\u00e9 $750.00 que o cliente pediu?" },
  installments: { en: "Will the customer pay in more than four installments, or with a service charge?", pt: "O cliente vai pagar em mais de quatro parcelas, ou com taxa de servi\u00e7o?" },
  roof_insurance: { en: "Is this roofing work paid by an insurance claim?", pt: "\u00c9 um servi\u00e7o de telhado pago por seguro?" },
  lien_consent: { en: "Do you want your subcontractors and suppliers to keep lien rights on this job?", pt: "Voc\u00ea quer que seus subempreiteiros e fornecedores mantenham o direito de gravame neste servi\u00e7o?" },
  waterproof: { en: "Is this basement waterproofing sold with no guarantee?", pt: "\u00c9 impermeabiliza\u00e7\u00e3o de por\u00e3o vendida sem garantia?" },
  deposit: { known: "Read from this contract's payment schedule." },
  progress: { known: "Read from this contract's payment schedule." },
  arbitration: { known: "Read from the dispute clause chosen in this contract." },
  arb_or_jury: { known: "Read from the dispute clause chosen in this contract." }
};
var BOLD10 = { bold: true, min_pt: 10 };
var BOLD = { bold: true };

// Sentences used in more than one state.
var DUP = "Says the same thing as another line on this list.";
var PRINTS = "The notice it names prints in the contract.";
var LICLINE = "The contract prints the license or registration line.";
var CLAUSE = "Advice about which clauses to pick. A flagged clause gets its own line when it is chosen.";
var OPTIONAL = "Optional: only when you choose to use it.";
var NOTYOURS = "Sent by someone else, not by you.";
var FTC = "The federal cancellation notice and form print in the contract, and the research says this state accepts them instead.";
var UNSURE_CONTENTS = "The research names a list of things this state wants in the contract. Nobody has checked the builder against that list item by item.";
function contents(ref) { return A("Check that the contract has every item this state requires", "Confira se o contrato tem todos os itens que este estado exige", { ref: ref, flag: UNSURE_CONTENTS }); }
function credit(flag) {
  return A("If the customer pays on credit, attach the state's credit-sale cancellation notice before they sign",
    "Se o cliente pagar a crédito, anexe o aviso de cancelamento de venda a crédito do estado antes de ele assinar", { fact: "credit", flag: flag || "Applies only to a sale on credit. The builder asks whether the customer pays on credit." });
}
function note() {
  return A("If the customer signs a promissory note, put the required statement on the face of the note",
    "Se o cliente assinar uma nota promissória, coloque a declaração exigida na frente da nota", { fact: "note", outside: OUT_NOTE_TEXT, flag: "Applies only when a note is taken." });
}
var OUT_NOTE_TEXT = "The statement goes on the promissory note. Apex does not make promissory notes, so only a person can put it there.";
function filing(en, pt) { return A(en, pt, { flag: "The research calls this a process, not contract text. It does not say who must file or when, so it is worded as a check." }); }
var PAY_AHEAD = A("Check that no payment is due before the work it pays for is done", "Confira se nenhum pagamento vence antes de o serviço correspondente estar feito",
  { flag: "The builder prints the payment schedule you set; it does not compare it with the work." });

var generic = {
  "license": A("Make sure your license or registration covers this job in {state}", "Confira se a sua licença ou registro vale para este serviço em {state}",
    { ref_from: "license_ref", unless: "license_local", flag: "Worded as a check: the builder cannot tell which license this job needs." }),
  "license_local": A("Check whether the city or county requires a local license for this job", "Confira se a cidade ou o condado exige licença local para este serviço",
    { flag: "The research found no state-level license and did not look at cities and counties." }),
  "license_word": H("The contract's license line already uses the word this state uses."),
  "license_number": H("Your number on file prints in the contract."),
  "license_number#missing": A("Add your license or registration number in the document settings", "Cadastre o número da sua licença ou registro nas configurações dos documentos", { ref_from: "license_ref", unless: "license_local", sys: "license",
    sys_en: "Your license or registration number printed in the contract", sys_pt: "O n\u00famero da sua licen\u00e7a ou registro impresso no contrato" }),
  "written_contract": H("This builder is the written contract."),
  "cancellation": H("The contract states the right to cancel and counts the deadline."),
  "cancellation_days": B("How the state counts the days. The builder does the counting."),
  "cancellation_deadline": H("The builder computes the deadline and prints the federal notice and form."),
  "cancellation_oral": A("Tell the customer out loud that they can cancel", "Diga ao cliente em voz alta que ele pode cancelar", { ref_from: "cancel_ref" }),
  "cancellation_language": A("Give the contract and the cancellation notice in the language you used to make the sale", "Entregue o contrato e o aviso de cancelamento no idioma usado na venda", { ref_from: "cancel_ref", sys: "language",
    sys_en: "Contract and cancellation notice in the language of the sale", sys_pt: "Contrato e aviso de cancelamento no idioma da venda",
    flag: "The builder writes contracts in English only. The system does this line only when the sale was made in English; otherwise a person must give a translation." }),
  "cancellation_window": A("Wait until the cancellation period ends before you start work or take payment", "Espere o prazo de cancelamento acabar antes de começar o serviço ou receber pagamento", { ref_from: "cancel_ref" }),
  "deposit": B("What the research found about deposit limits. When the limit is a clean number the builder compares your first payment with it."),
  "deposit_over": A("Lower the first payment to {cap} or less: it is over this state's deposit limit", "Reduza o primeiro pagamento para {cap} ou menos: ele passa do limite de sinal deste estado", { ref_from: "deposit_ref", sys: "deposit",
    sys_en: "First payment within this state's deposit limit ({cap})", sys_pt: "Primeiro pagamento dentro do limite de sinal deste estado ({cap})" }),
  "notice": A("Attach this notice before the customer signs: {title}", "Anexe este aviso antes de o cliente assinar: {title}",
    { flag: "No sentence was written for this notice yet; this is the fallback wording." }),
  "notice#prints": H("This notice prints in the contract."),
  "defect": B("How this state handles construction defect claims. Where the research gives a cite, the warranty and dispute clauses already point to it."),
  "pool": A("Check the pool safety rules in {state} for this job", "Confira as regras de segurança de piscina em {state} para este serviço",
    { flag: "The research lists a pool rule by name only. Worded as a check." }),
  "risky": A("Look again at clause {option}: the research flags it in {state}", "Reveja a cláusula {option}: a pesquisa aponta um risco em {state}"),
  "item": B("A summary line from the research."),
  "extra": B("A note from the research."),
  "status": B("How far the research for this state got."),
  "cleaning_blocks": H("The builder leaves the Florida cleaning notices out and prints the federal ones when they apply."),
  "cleaning_auto_renewal": B("The state's automatic renewal rule, for when a plan renews by itself."),
  "cleaning_auto_renewal#renews": A("This plan renews by itself: follow the state's automatic renewal rule", "Este plano renova sozinho: siga a regra de renovação automática do estado"),
  "cleaning_auto_renewal#renews_no_rule": A("This plan renews by itself: check whether {state} has an automatic renewal rule", "Este plano renova sozinho: confira se {state} tem regra de renovação automática",
    { flag: "The research found no rule, which is not proof that none exists." }),
  "cleaning_license": B("What the research found about a cleaning license."),
  "cleaning_license#check": A("Check whether the city or county requires a license for cleaning", "Confira se a cidade ou o condado exige licença para limpeza",
    { flag: "The research has no note on a cleaning license for this state." }),
  "cleaning_home_solicitation": B("Whether the state's door-to-door rule reaches cleaning."),
  "cleaning_tax": B("The builder prints no sales tax sentence outside Florida."),
  "cleaning_tax#applies": A("Ask your tax professional whether to charge sales tax on this job", "Pergunte ao seu contador se deve cobrar imposto sobre vendas neste serviço",
    { flag: "The clause library holds Florida's tax rules only." })
};
// The three reminders every state gets (keyed whole: "fixed:1").
var FIXED = {
  "fixed:1": A("Take dated photos before work starts and get the condition acknowledgment signed", "Tire fotos com data antes de começar e pegue a assinatura no termo de condição do imóvel", { ref: "good practice", ref_pt: "boa pr\u00e1tica", sys: "photos",
    sys_en: "Dated photos and the signed condition acknowledgment", sys_pt: "Fotos com data e o termo de condi\u00e7\u00e3o do im\u00f3vel assinado" }),
  "fixed:2": A("Send the customer the complete signed copy as soon as both of you have signed", "Envie ao cliente a cópia completa e assinada assim que os dois tiverem assinado", { ref: "good practice", ref_pt: "boa pr\u00e1tica", sys: "signed_copy",
    sys_en: "Complete signed copy for the customer", sys_pt: "C\u00f3pia completa e assinada para o cliente" }),
  "fixed:3": H("The builder lists every field that is still empty before you send.", "A statutory form prints its own blanks (a date line, a signature line) exactly as the law prints them; those are filled by hand.")
};

var S = {};

S.AL = { cancel_ref: "Ala. Code 5-19-12", lines: {
  "notice:AL-insurance": A("Give the customer the written liability insurance disclosure and get it signed before work starts", "Entregue ao cliente a declaração de seguro de responsabilidade por escrito e pegue a assinatura antes de começar o serviço"),
  "notice:AL-cancel-credit": H(FTC),
  "item:1": H(LICLINE), "item:2": B(DUP), "item:3": H("The contract is signed by both sides in the app.")
} };
S.AK = { cancel_ref: "AS 45.02.350", license_ref: "AS 08.18", lines: {
  "notice:AK-cancel": H("The contract's cancellation notice already counts five business days for Alaska.", "The statute gives no wording of its own. Marked handled because the builder prints the notice with the five-day count; a lawyer should confirm that is enough."),
  "notice:AK-defect-notice": A("For a home build or a large remodel, attach the page \"Notice of Potential Claims Must Be Provided within One Year\" and get it signed", "Para construção ou reforma grande de casa, anexe a página \"Notice of Potential Claims Must Be Provided within One Year\" e pegue a assinatura", { fact: "big_build", needs: "A separate page that the buyer must sign. The builder has no separate signed page for a state notice yet." }),
  "item:1": H(LICLINE), "item:2": B(DUP), "item:3": B(DUP)
} };
S.AZ = { cancel_ref: "A.R.S. 44-5004", license_ref: "A.R.S. 32-1121", lines: {
  "notice:AZ-registrar": A("Attach the Registrar of Contractors complaint statement (10 point bold, with phone and website)", "Anexe a declaração de reclamação do Registrar of Contractors (negrito, corpo 10, com telefone e site)"),
  "notice:AZ-pool-notice": A("Hand the customer the state pool safety notice", "Entregue ao cliente o aviso estadual de segurança de piscina"),
  "notice:AZ-note-statement": note(),
  "notice:AZ-new-dwelling": A("If you are selling a newly built home, add the Registrar complaint provision and get the buyer's initials", "Se estiver vendendo uma casa recém-construída, inclua a cláusula de reclamação do Registrar e pegue as iniciais do comprador", { flag: "Applies only to the sale of a new home." }),
  "notice:AZ-prelim-20day": B(NOTYOURS + " Subcontractors and suppliers send it."),
  "item:1": contents("A.R.S. 32-1158"), "item:2": B(DUP),
  "item:3": A("Give a receipt for any cash and a copy of every signed document", "Dê recibo de qualquer pagamento em dinheiro e cópia de todos os documentos assinados", { flag: "The research gives no law number for this line." })
} };
S.AR = { cancel_ref: "ACA 4-89-107", lines: {
  "notice:AR-lien": A("Attach the IMPORTANT NOTICE TO OWNER (lien notice) and get the owner's signature before work starts", "Anexe o IMPORTANT NOTICE TO OWNER (aviso de gravame) e pegue a assinatura do proprietário antes de começar o serviço"),
  "notice:AR-cancel": A("Attach the state cancellation statement and two copies of the NOTICE OF CANCELLATION form", "Anexe a declaração de cancelamento do estado e duas vias do formulário NOTICE OF CANCELLATION"),
  "item:1": B(DUP),
  "item:2": A("Put up a sign with your license number at the job site", "Coloque uma placa com o número da sua licença no local do serviço", { flag: "The research gives no law number for the job-site sign." }),
  "item:3": B(DUP)
} };
S.CA = { cancel_ref: "B&P 7159", license_ref: "B&P 7048", deposit_ref: "B&P 7159", lines: {
  "cancellation_days": A("If the customer is a senior citizen, allow five business days to cancel, not three", "Se o cliente for idoso, dê cinco dias úteis para cancelar, não três", { fact: "age65", ref: "B&P 7159", flag: "The builder counts three business days. It does not know the customer's age." }),
  "notice:CA-insurance": B("Points to the insurance statements listed below."),
  "notice:CA-7159.1": A("If the contract is secured by a lien on the home, give the WARNING TO BUYER on a separate signed page", "Se o contrato for garantido por gravame sobre a casa, entregue o WARNING TO BUYER em página separada e assinada", { fact: "secured", needs: "18 point type on a separate page that the buyer signs and dates. The builder has no separate signed page for a state notice yet.", flag: "Applies only when the home secures the contract." }),
  "notice:CA-7191": A("If the contract has an arbitration clause, title it ARBITRATION OF DISPUTES and add the NOTICE by the initials line", "Se o contrato tiver cláusula de arbitragem, use o título ARBITRATION OF DISPUTES e inclua o NOTICE junto à linha de iniciais", { fact: "arbitration", needs: "The notice must sit right by the initials line of the arbitration clause, which the builder does not lay out.", flag: "Applies only with an arbitration clause." }),
  "notice:CA-1689.7": B("For sales that are not home improvement. The home improvement notice prints instead."),
  "notice:CA-1689.7-form": B("For sales that are not home improvement. The home improvement form prints instead."),
  "notice:CA-7159.10": A("For a service and repair job of $750 or less, use the service and repair notices instead", "Para um serviço de reparo de até $750.00, use os avisos de service and repair", { flag: "Applies only to a small service and repair job the customer asked for." }),
  "notice:CA-7159.10-copy": B(DUP), "notice:CA-7159.10-cancel": B(DUP),
  "notice:CA-115924": A("Give the customer the notice of the pool safety requirements", "Entregue ao cliente o aviso dos requisitos de segurança de piscina"),
  "notice:CA-downpayment": A("If you charge a down payment, add the down payment statement under the heading \"Downpayment\"", "Se cobrar sinal, inclua a declaração de sinal sob o título \"Downpayment\""),
  "notice:CA-progress-payments": A("If there are progress payments, add the progress payment statement", "Se houver pagamentos por etapa, inclua a declaração de pagamentos por etapa"),
  "notice:CA-subs-disclaimer": A("If you will use a subcontractor, add the subcontractor statement to the contract and to each change order", "Se for usar subempreiteiro, inclua a declaração de subempreiteiro no contrato e em cada aditivo", { fact: "subs", needs: "The statute wants a Yes/No box in the contract and the same words on every change order. Not built." }),
  "notice:CA-cgl-none": A("Add the liability insurance (CGL) statement that is true for your business", "Inclua a declaração de seguro de responsabilidade (CGL) que vale para a sua empresa"),
  "notice:CA-cgl-insured": B("One of four versions of the same statement. See the CGL line."), "notice:CA-cgl-self": B("One of four versions of the same statement. See the CGL line."), "notice:CA-cgl-llc": B("One of four versions of the same statement. See the CGL line."),
  "notice:CA-wc-exempt": A("Add the workers' compensation statement that is true for your business", "Inclua a declaração de workers' compensation que vale para a sua empresa"),
  "notice:CA-wc-carries": B("One of two versions of the same statement. See the workers' compensation line."),
  "notice:CA-7day-notice": A("For disaster repair after a declared emergency, use the Seven-Day Right to Cancel notice and form", "Para reparo de desastre após emergência declarada, use o aviso e o formulário Seven-Day Right to Cancel", { flag: "Applies only to disaster repair." }),
  "notice:CA-7day-form": B(DUP),
  "notice:CA-7164-lien": A("For a new single-family home, add the Mechanics Lien Warning for new homes", "Para casa unifamiliar nova, inclua o Mechanics Lien Warning de casas novas", { flag: "Applies only to building a new home." }),
  "pool": A("Make sure the pool will have two of the seven required safety features", "Garanta que a piscina terá dois dos sete itens de segurança exigidos", { ref: "Health & Saf. Code 115922" }),
  "item:1": contents("B&P 7159, 7159.5"), "item:2": PAY_AHEAD, "item:3": B(DUP),
  "extra:1": B("Why the pool lines matter: the research says a pool contract missing them is void to the contractor.")
} };
S.CO = { cancel_ref: "C.R.S. 5-3-401", lines: {
  "notice:CO-cancel-credit": H(FTC),
  "notice:CO-lien-notice": B(NOTYOURS + " The building permit office mails it."),
  "item:1": H("The warranty and dispute clauses already point to the state's defect process."), "item:2": B(CLAUSE), "item:3": B(DUP)
} };
S.CT = { cancel_ref: "C.G.S. 42-135a", lines: {
  "notice:CT-email-sentence": A("If you send the contract by email, add the required sentence beside the message", "Se enviar o contrato por e-mail, inclua a frase exigida junto à mensagem", { flag: "The app sends a link to the contract. Nobody has checked whether that message needs this sentence." }),
  "notice:CT-note-statement": note(),
  "item:1": contents("C.G.S. 20-429"), "item:2": B(PRINTS), "item:3": B("Change orders are written and signed in the app; the signed copy has its own line.")
} };
S.DE = { cancel_ref: "6 Del. C. ch. 44", lines: {
  "cancellation_days": H("The builder leaves Saturday out when it counts the Delaware deadline."),
  "notice:DE-ag-summary": A("Attach the Attorney General's \"Summary of Your Rights\" and hand it over before the customer signs", "Anexe o \"Summary of Your Rights\" do Attorney General e entregue antes de o cliente assinar"),
  "item:1": B(DUP),
  "item:2": A("Check the contract has a completion date, and get initials on any warranty disclaimer", "Confira se o contrato tem data de conclusão e pegue as iniciais em qualquer exclusão de garantia", { ref: "6 Del. Admin. Code 106", flag: "Read from a short summary line in the research." }),
  "item:3": B(CLAUSE)
} };
S.DC = { cancel_ref: "D.C. Code 28-3811", license_ref: "D.C. Code 47-2883.01", lines: {
  "written_contract": A("Sign the contract in three copies with every blank filled in before you take any payment", "Assine o contrato em três vias, com todos os campos preenchidos, antes de receber qualquer pagamento", { ref: "16 DCMR 808", flag: "The rule speaks of three paper copies. Nobody has checked how an online signature meets it." }),
  "notice:DC-waiver": B(OPTIONAL + " For an emergency only."),
  "notice:DC-808-15": A("Add the notice about not signing in blank and getting a copy (10 point bold)", "Inclua o aviso sobre não assinar em branco e receber uma cópia (negrito, corpo 10)"),
  "item:1": A("Put on the contract the name and license number of each salesperson who took part", "Coloque no contrato o nome e o número de licença de cada vendedor que participou", { ref: "16 DCMR 808.4, 808.9" }),
  "item:2": B("About unlicensed persons."), "item:3": B(CLAUSE),
  "extra:1": A("Before you use this contract in D.C., have your attorney confirm it", "Antes de usar este contrato em D.C., peça ao seu advogado para confirmar", { ref: "16 DCMR 811" })
} };
S.GA = { cancel_ref: "O.C.G.A. 10-1-6", lines: {
  "notice:GA-8-2-41": A("Add the notice of the contractor's right to resolve construction defects", "Inclua o aviso do direito do empreiteiro de resolver defeitos de construção"),
  "notice:GA-43-41-7": A("For a single-family home job over $2,500, offer a written warranty and attach it before signing", "Para serviço em casa unifamiliar acima de $2,500.00, ofereça garantia por escrito e anexe antes da assinatura", { flag: "The rule is about building a single-family home; the research does not say whether a remodel counts." }),
  "notice:GA-553-7-01": B(DUP),
  "notice:GA-553-8-01": A("If you work under the repair exemption without a license, tell the owner in writing that you are not licensed", "Se trabalhar pela isenção de reparos sem licença, avise o proprietário por escrito que você não é licenciado"),
  "item:1": B(DUP), "item:2": B("About lien waiver forms, which are separate documents."), "item:3": B(DUP),
  "extra:1": filing("Check whether a notice of commencement must be filed for this job", "Confira se é preciso registrar um notice of commencement para este serviço")
} };
S.HI = { cancel_ref: "HRS 481C-2", lines: {
  "written_contract": A("Get the contract signed before any work starts", "Pegue o contrato assinado antes de começar qualquer serviço", { ref: "HRS 444-25.5", sys: "signed", sys_en: "Contract signed by the company and the customer", sys_pt: "Contrato assinado pela empresa e pelo cliente", flag: "The system sees the two signatures and their times. It does not see when the work started or when a payment was taken." }),
  "notice:HI-lien-bond": A("Explain lien rights and the bonding option to the customer out loud, and add the written provision", "Explique ao cliente em voz alta os direitos de gravame e a opção de fiança, e inclua a cláusula por escrito"),
  "notice:HI-risk-of-loss": A("Add the risk of loss statement in capital letters next to the owner's signature line", "Inclua a declaração de risco de perda em letras maiúsculas ao lado da assinatura do proprietário"),
  "item:1": A("List the percent of the work you will subcontract, with each subcontractor's name and license number", "Informe a porcentagem do serviço que será subempreitada, com o nome e o número de licença de cada subempreiteiro", { ref: "HAR 16-77-80" }),
  "item:2": B(DUP), "item:3": B(PRINTS)
} };
S.ID = { cancel_ref: "IDAPA 04.02.01.170", license_ref: "54-5214", lines: {
  "notice:ID-disclosure": A("Give the homeowner disclosure statement and get a signed acknowledgment", "Entregue a declaração ao proprietário e pegue o recibo assinado"),
  "notice:ID-cancel-credit": credit(),
  "item:1": H(LICLINE),
  "item:2": A("Give the list of subcontractors and suppliers before the final payment", "Entregue a lista de subempreiteiros e fornecedores antes do pagamento final", { ref: "45-525", fact: "subs", needs: "Apex has no supplier records and no address or telephone for a subcontractor, so the system cannot build the list yet (it needs a database change)." }),
  "item:3": B("The research says no notice is required in the contract.")
} };
S.IL = { cancel_ref: "815 ILCS 505/2B", lines: {
  "written_contract": A("Give the customer the contract to sign before work starts", "Entregue o contrato para o cliente assinar antes de começar o serviço", { ref: "815 ILCS 513/15", sys: "signed", sys_en: "Contract signed by the company and the customer", sys_pt: "Contrato assinado pela empresa e pelo cliente", flag: "The system sees the two signatures and their times. It does not see when the work started or when a payment was taken." }),
  "cancellation_days": A("If the customer is 65 or older and you came uninvited, allow 15 business days to cancel", "Se o cliente tiver 65 anos ou mais e você veio sem ser chamado, dê 15 dias úteis para cancelar", { fact: "age65", ref: "815 ILCS 513/22", flag: "The builder counts three business days. It does not know the customer's age." }),
  "notice:IL-pamphlet": A("Hand the customer the \"Home Repair: Know Your Consumer Rights\" pamphlet", "Entregue ao cliente o folheto \"Home Repair: Know Your Consumer Rights\""),
  "notice:IL-ack-form": A("Get the Consumer Rights Acknowledgment Form signed by you and the customer", "Pegue o Consumer Rights Acknowledgment Form assinado por você e pelo cliente"),
  "notice:IL-lien": A("Give the owner the lien notice and a sworn statement before the first payment", "Entregue ao proprietário o aviso de gravame e a declaração juramentada antes do primeiro pagamento"),
  "notice:IL-arbitration-margin": A("If the contract has an arbitration or jury waiver clause, have the customer sign and write \"accept\" or \"reject\" beside it", "Se o contrato tiver cláusula de arbitragem ou de renúncia a júri, peça ao cliente para assinar e escrever \"accept\" ou \"reject\" ao lado", { fact: "arb_or_jury", flag: "Applies only with one of those clauses." }),
  "notice:IL-insurance-cancel": A("If insurance money pays for the job, add the insurance cancellation statement and form", "Se o seguro pagar o serviço, inclua a declaração e o formulário de cancelamento de seguro", { fact: "insurance_paid", needs: "A statement plus a duplicate cancellation form with blanks to fill. Not built.", flag: "Applies only to a job paid from an insurance claim." }),
  "notice:IL-insurance-cancel-form": B(DUP),
  "item:1": B(DUP), "item:2": B(DUP),
  "item:3": A("Check that you carry the insurance this state requires for home repair", "Confira se você tem o seguro que este estado exige para reparos residenciais", { flag: "The research names insurance minimums without the amounts or a law number." })
} };
S.IN = { cancel_ref: "IC 24-5-11-10.6", lines: {
  "notice:IN-cancel": A("If you approached the customer without being asked, attach the state cancellation notice in two copies", "Se você procurou o cliente sem ser chamado, anexe o aviso de cancelamento do estado em duas vias", { flag: "Applies only to a sale the customer did not ask for." }),
  "notice:IN-cancel-10-6": A("Give the customer the statement of the right to cancel before they sign, with the NOTICE OF CANCELLATION form in two copies", "Entregue ao cliente a declaração do direito de cancelar antes de ele assinar, com o formulário NOTICE OF CANCELLATION em duas vias"),
  "notice:IN-cancel-10-6-form": B(DUP),
  "notice:IN-cure": A("For a home build or a large remodel, add the notice of the contractor's right to offer to cure defects", "Para construção ou reforma grande de casa, inclua o aviso do direito do empreiteiro de propor o reparo de defeitos", { flag: "A remodel counts only when it costs more than half the home's assessed value.", fact: "big_build", sys: "print", style: BOLD, sys_en: "Notice of the contractor's right to offer to cure defects printed in the contract", sys_pt: "Aviso do direito do empreiteiro de propor o reparo de defeitos impresso no contrato" }),
  "item:1": contents("IC 24-5-11-10"),
  "item:2": A("Sign the contract yourself before the customer does, and give them the fully signed copy right away", "Assine o contrato antes do cliente e entregue a cópia totalmente assinada na hora", { ref: "IC 24-5-11", sys: "signed", sys_en: "Contract signed by the company and the customer", sys_pt: "Contrato assinado pela empresa e pelo cliente", flag: "The system sees the two signatures and their times. It does not see when the work started or when a payment was taken." }),
  "item:3": B(DUP)
} };
S.IA = { cancel_ref: "Iowa Code 555A.2, 555A.3", license_ref: "Iowa Code ch. 91C", lines: {
  "notice:IA-lien": A("If you use a subcontractor, add the mechanics lien owner notice and post the job on the state registry within 10 days", "Se usar subempreiteiro, inclua o aviso de gravame ao proprietário e registre o serviço no cadastro do estado em até 10 dias", { fact: "subs", needs: "The copy on file carries one sentence that is an instruction, not part of the notice, and the job must also be posted on the state registry, which only a person can do.", flag: "Applies only when a subcontractor is used." }),
  "item:1": B(PRINTS), "item:2": B(DUP), "item:3": B(CLAUSE)
} };
S.KS = { cancel_ref: "K.S.A. 50-640", lines: {
  "notice:KS-60-4706": A("For building or remodeling a home, add the notice of the contractor's right to offer to repair construction defects", "Para construção ou reforma de casa, inclua o aviso do direito do empreiteiro de propor o reparo de defeitos de construção", { sys: "print", style: BOLD, sys_en: "Notice of the contractor's right to offer to repair construction defects printed in the contract", sys_pt: "Aviso do direito do empreiteiro de propor o reparo de defeitos impresso no contrato", flag: "Printed on every residential job. The research is not sure the Kansas act reaches a business that only remodels; printing the notice where it is not required does no harm." }),
  "item:1": B(PRINTS), "item:2": B(DUP), "item:3": B(CLAUSE)
} };
S.KY = { cancel_ref: "KRS 367.450(3)", lines: {
  "notice:KY-cure": A("If you are building a home, add the builder's right to cure notice", "Se estiver construindo uma casa, inclua o aviso do direito do construtor de reparar defeitos", { flag: "The research does not say whether a remodel, a pool or a tile job counts, so the system prints the notice on every residential job (the safe side).", sys: "print", style: BOLD, sys_en: "Builder's right to cure notice printed in the contract", sys_pt: "Aviso do direito do construtor de reparar defeitos impresso no contrato" }),
  "item:1": B(PRINTS), "item:2": B(DUP), "item:3": B(DUP)
} };
S.LA = { cancel_ref: "R.S. 9:3538", lines: {
  "written_contract": A("Get the contract signed before any work starts", "Pegue o contrato assinado antes de começar qualquer serviço", { ref: "R.S. 37:2159", sys: "signed", sys_en: "Contract signed by the company and the customer", sys_pt: "Contrato assinado pela empresa e pelo cliente", flag: "The system sees the two signatures and their times. It does not see when the work started or when a payment was taken." }),
  "item:1": A("Attach your insurance certificates to the contract", "Anexe os seus certificados de seguro ao contrato", { ref: "R.S. 37:2159", flag: "Read from a contents list in the research; the rest of that list is in the contract." }),
  "item:2": B(PRINTS), "item:3": B(CLAUSE),
  "extra:1": filing("Check whether a notice of contract and a bond must be filed for this job", "Confira se é preciso registrar um notice of contract e uma fiança para este serviço"),
  "extra:2": B("Why the license matters: the research says an unlicensed contractor cannot collect here.")
} };
S.ME = { cancel_ref: "32 M.R.S. 4661 to 4668", deposit_ref: "10 M.R.S. 1487", lines: {
  "cancellation_window": A("Do not attach materials to the home until the cancellation period ends", "Não fixe materiais na casa antes de o prazo de cancelamento acabar", { ref: "32 M.R.S. 4661 to 4668" }),
  "notice:ME-ag": A("Attach the Attorney General's consumer information addendum", "Anexe o adendo de informações ao consumidor do Attorney General"),
  "notice:ME-cancel": H("The federal cancellation notice prints, and the research says the state accepts it when it gives at least equal information.", "Credit sales only. A lawyer should confirm the federal notice gives equal information."),
  "notice:ME-cancel-caption": B(DUP),
  "item:1": contents("10 M.R.S. 1487"), "item:2": B("The builder compares your first payment with the one-third limit."),
  "item:3": A("Have the customer pick one of the three dispute options printed in the contract", "Peça ao cliente para escolher uma das três opções de disputa impressas no contrato", { ref: "10 M.R.S. 1487(8)", flag: "The statute prints three choices with an empty mark after each. Nobody has checked how the online page records the choice." })
} };
S.MD = { cancel_ref: "CL 14-302, 14-302.1", deposit_ref: "BR 8-617", lines: {
  "cancellation_days": A("If the customer is 65 or older, allow seven business days to cancel", "Se o cliente tiver 65 anos ou mais, dê sete dias úteis para cancelar", { fact: "age65", ref: "CL 14-302.1", flag: "The builder counts five business days. It does not know the customer's age." }),
  "notice:MD-mhic": A("Add the MHIC notice (mediation, Guaranty Fund, bond right) to the contract", "Inclua no contrato o aviso da MHIC (mediação, Guaranty Fund, direito a fiança)"),
  "notice:MD-cancel": A("Attach the state cancellation statement, and the Notice of Cancellation form on a separate sheet", "Anexe a declaração de cancelamento do estado e o formulário Notice of Cancellation em folha separada"),
  "notice:MD-security": A("If payment is secured by the home, add the security and rescission notice on the first page and get initials", "Se o pagamento for garantido pela casa, inclua o aviso de garantia e rescisão na primeira página e pegue as iniciais", { fact: "secured", needs: "Must be on the first page with the owner's initials beside it. The builder does not place a state notice on page one or collect initials for it.", flag: "Applies only when the home secures payment." }),
  "notice:MD-oral-ack": A("Get the customer's signature confirming you told them about the right to cancel", "Pegue a assinatura do cliente confirmando que você avisou sobre o direito de cancelar"),
  "item:1": contents("BR 8-501"), "item:2": B(DUP), "item:3": B(DUP),
  "extra:1": B("Why the license matters: the research says an unlicensed contractor cannot collect here.")
} };
S.MA = { cancel_ref: "M.G.L. c. 93 s. 48", license_ref: "c. 142A s. 14", lines: {
  "deposit": A("Check that the deposit is not more than one third of the price (or the cost of special-order materials, if that is more)", "Confira se o sinal não passa de um terço do preço (ou do custo dos materiais sob encomenda, se for maior)", { ref: "c. 142A s. 2", flag: "The limit is not one clean number, so the builder cannot compare it for you." }),
  "notice:MA-142A-notices": A("Add the notices of registration, cancellation, warranties and lien, and the permit paragraph", "Inclua os avisos de registro, cancelamento, garantias e gravame, e o parágrafo da licença de obra (permit)"),
  "notice:MA-adr-clause": B(OPTIONAL),
  "item:1": contents("c. 142A s. 2"), "item:2": B(DUP), "item:3": B(DUP),
  "extra:1": filing("Check whether a notice of contract must be filed for this job", "Confira se é preciso registrar um notice of contract para este serviço")
} };
S.MI = { cancel_ref: "MCL 445.113", license_ref: "339.2403(f)", lines: {
  "notice:MI-lien": A("Add the Construction Lien Act statement about your license to the contract", "Inclua no contrato a declaração do Construction Lien Act sobre a sua licença"),
  "item:1": H(LICLINE), "item:2": B(DUP), "item:3": B("About lien waiver forms, which are separate documents.")
} };
S.MN = { cancel_ref: "Minn. Stat. 325G.08", lines: {
  "written_contract": A("Give the customer the written performance guidelines before they sign", "Entregue ao cliente as diretrizes de desempenho por escrito antes de ele assinar", { ref: "326B.809" }),
  "notice:MN-lien": A("If you use subcontractors or suppliers, add the mechanics lien notice to the contract", "Se usar subempreiteiros ou fornecedores, inclua o aviso de gravame no contrato", { fact: "subs", sys: "print", style: BOLD10, sys_en: "Mechanics lien notice printed in the contract", sys_pt: "Aviso de gravame impresso no contrato" }),
  "notice:MN-roofing-cancel": A("For roofing paid by insurance, give the 72 hour cancellation statement and form before signing", "Para telhado pago por seguro, entregue a declaração e o formulário de cancelamento de 72 horas antes da assinatura", { fact: "insurance_paid", needs: "A statement plus a cancellation form, given before the contract. Not built.", flag: "Applies only to roofing paid from an insurance claim." }),
  "notice:MN-roofing-cancel-form": B(DUP),
  "item:1": B(DUP), "item:2": B(DUP), "item:3": B(DUP)
} };
S.MS = { cancel_ref: "75-66", lines: {
  "notice:MS-insurance": A("Add the liability insurance disclosure just above the customer's signature", "Inclua a declaração de seguro de responsabilidade logo acima da assinatura do cliente"),
  "notice:MS-cancel-credit": H(FTC),
  "item:1": H(LICLINE), "item:2": B(DUP), "item:3": B(DUP)
} };
S.MO = { cancel_ref: "407.710", lines: {
  "notice:MO-cancel-credit": credit(),
  "notice:MO-consent": A("If you want your subcontractors and suppliers to keep lien rights, get the CONSENT OF OWNER signed", "Se quiser que subempreiteiros e fornecedores mantenham o direito de gravame, pegue o CONSENT OF OWNER assinado pelo proprietário"),
  "notice:MO-cure": A("For a home build or a large remodel, add the notice of the contractor's right to offer to cure defects", "Para construção ou reforma grande de casa, inclua o aviso do direito do empreiteiro de propor o reparo de defeitos", { flag: "A remodel counts only when it costs more than half the home's assessed value.", fact: "big_build", sys: "print", style: BOLD, sys_en: "Notice of the contractor's right to offer to cure defects printed in the contract", sys_pt: "Aviso do direito do empreiteiro de propor o reparo de defeitos impresso no contrato" }),
  "item:1": B(PRINTS), "item:2": B(DUP), "item:3": B(CLAUSE)
} };
S.MT = { cancel_ref: "MCA 30-14-505", lines: {
  "notice:MT-defect": A("Give the homeowner written notice of the construction defect process", "Entregue ao proprietário o aviso por escrito do processo de defeitos de construção"),
  "item:1": H(LICLINE), "item:2": B(DUP), "item:3": B(PRINTS)
} };
S.NE = { cancel_ref: "69-1604", lines: {
  "item:1": B("The research found no rule that puts the number on the contract."), "item:2": B(PRINTS),
  "item:3": A("Say your own name and the business name at the start of the sales visit", "Diga o seu nome e o nome da empresa no começo da visita de venda", { flag: "The research gives no law number for this line." })
} };
S.NV = { cancel_ref: "NRS 598.280", lines: {
  "notice:NV-owner-notice": A("Add the four-point owner notice near the signatures and get the owner's initials", "Inclua o aviso de quatro pontos ao proprietário perto das assinaturas e pegue as iniciais do proprietário"),
  "notice:NV-sub-list": A("Give the owner the list of subcontractors and suppliers in writing", "Entregue ao proprietário, por escrito, a lista de subempreiteiros e fornecedores", { fact: "subs", needs: "Apex has no supplier records and no address or telephone for a subcontractor, so the system cannot build the list yet (it needs a database change)." }),
  "notice:NV-info-liens": A("Give the owner the two state information forms (liens and contractors)", "Entregue ao proprietário os dois formulários informativos do estado (gravames e empreiteiros)", { sys: "deliver", docs: ["NV-info-liens", "NV-info-contractors"], sys_en: "The two state information forms (liens and contractors) given to the owner", sys_pt: "Os dois formul\u00e1rios informativos do estado (gravames e empreiteiros) entregues ao propriet\u00e1rio", flag: "The rule is for a general building contractor and the owner of a single-family home. The system hands the two forms over on every residential job (the safe side)." }),
  "notice:NV-info-contractors": B(DUP),
  "notice:NV-pool-rights": A("Give the customer a written statement of their pool and spa rights", "Entregue ao cliente uma declaração por escrito dos direitos dele sobre piscina e spa"),
  "notice:NV-pool-notice": A("Add the pool and spa notice near the signatures", "Inclua o aviso de piscina e spa perto das assinaturas"),
  "pool": B("The two pool and spa lines on this list say what to do."),
  "item:1": contents("NRS 624.970"), "item:2": PAY_AHEAD, "item:3": B(DUP)
} };
S.NH = { cancel_ref: "RSA 361-B:2", lines: {
  "item:1": B(PRINTS), "item:2": H("The contract carries the seller's name, address and the date."), "item:3": B(CLAUSE)
} };
S.NJ = { cancel_ref: "N.J.S.A. 56:8-151", license_ref: "13:45A-17.12", lines: {
  "notice:NJ-division": A("Add the Division of Consumer Affairs statement with its toll-free number (capitals, 10 point bold)", "Inclua a declaração da Division of Consumer Affairs com o telefone gratuito (maiúsculas, negrito, corpo 10)"),
  "notice:NJ-cancel": A("Add the three day cancellation notice with your name, address and phone", "Inclua o aviso de cancelamento de três dias com o seu nome, endereço e telefone"),
  "item:1": B(DUP), "item:2": contents("13:45A-16.2"),
  "item:3": A("Give the customer a copy of your liability insurance certificate", "Entregue ao cliente uma cópia do seu certificado de seguro de responsabilidade", { ref: "13:45A-17.12", flag: "The research line says \"CGL certificate\" without saying who must receive it." }),
  "extra:1": B("Why the registration matters: the research says an unlicensed contractor cannot collect here.")
} };
S.NM = { cancel_ref: "NMSA 57-12-21", lines: {
  "notice:NM-default": A("Give the state's residential default disclosure form before work, signing or payment, and get it signed", "Entregue o formulário estadual de residential default disclosure antes do serviço, da assinatura ou do pagamento, e pegue a assinatura"),
  "item:1": B(DUP), "item:2": B("About bids and permit applications, not the contract."), "item:3": B(PRINTS)
} };
S.NY = { cancel_ref: "GBL 771", lines: {
  "written_contract": A("Give the customer a copy you have signed before work starts", "Entregue ao cliente uma cópia assinada por você antes de começar o serviço", { ref: "GBL 771", sys: "sent", sys_en: "Copy signed by the company sent to the customer", sys_pt: "C\u00f3pia assinada pela empresa enviada ao cliente", flag: "The system sees the company signature and the send. It does not see when the work started." }),
  "deposit": A("Put any payment you receive before the job is finished in an escrow account, or post a bond", "Deposite em conta de garantia (escrow) qualquer pagamento recebido antes do fim do serviço, ou apresente uma fiança", { ref: "Lien Law 71-a(4)" }),
  "notice:NY-cancel": A("Check that the contract states the three business day right to cancel", "Confira se o contrato informa o direito de cancelar em três dias úteis", { flag: "New York gives this right on every home improvement contract. The builder prints the cancellation notice only when the sale was made at the customer's home." }),
  "notice:NY-insurance": A("Add your insurance policy information, with the insurer's phone and address", "Inclua os dados da sua apólice de seguro, com telefone e endereço da seguradora"),
  "item:1": contents("GBL 771(1)"), "item:2": B(DUP), "item:3": B(DUP)
} };
S.NC = { cancel_ref: "G.S. 14-401.13", lines: {
  "notice:NC-cancel-credit": credit(), "notice:NC-cancel-credit-form": B(DUP),
  "item:1": B(CLAUSE), "item:2": B(CLAUSE), "item:3": B(PRINTS)
} };
S.ND = { cancel_ref: "N.D.C.C. 51-18-04", lines: {
  "deposit": A("Do not take any advance payment until you have the customer's signed contract", "Não receba nenhum adiantamento antes de ter o contrato assinado pelo cliente", { ref: "N.D.C.C. ch. 51-18" }),
  "cancellation_days": A("If the customer is 65 or older, check whether the 15 business day period applies", "Se o cliente tiver 65 anos ou mais, confira se vale o prazo de 15 dias úteis", { fact: "age65", ref: "N.D.C.C. 51-18-04", flag: "The statute says \"product\", not services, so the research is unsure it reaches a service job." }),
  "notice:ND-completion": A("When the job is finished, give the customer the written notice of the warranty procedure", "Ao terminar o serviço, entregue ao cliente o aviso por escrito do procedimento de garantia"),
  "item:1": A("Check that the contract has a start date and a completion date", "Confira se o contrato tem data de início e data de conclusão", { flag: "The research gives no law number for this line." }),
  "item:2": B(DUP), "item:3": B(PRINTS)
} };
S.OH = { cancel_ref: "R.C. 1345.23", deposit_ref: "R.C. 4722", lines: {
  "notice:OH-estimate-form": A("Give the customer the estimate form at the first meeting and get their initials", "Entregue ao cliente o formulário de estimativa no primeiro encontro e pegue as iniciais"),
  "item:1": B(PRINTS), "item:2": B(PRINTS), "item:3": B(DUP),
  "extra:1": B("The owner's duty, not yours.")
} };
S.OK = { cancel_ref: "14A 2-503", lines: {
  "notice:OK-cancel-credit": credit(),
  "item:1": H("The warranty and dispute clauses already point to the state's defect process."), "item:2": B(DUP), "item:3": B(CLAUSE)
} };
S.OR = { cancel_ref: "ORS 83.730", lines: {
  "notice:OR-lien": A("Give the owner the CCB \"Information Notice to Owner About Construction Lien Rights\" on or before the contract date", "Entregue ao proprietário o \"Information Notice to Owner About Construction Lien Rights\" do CCB até a data do contrato"),
  "notice:OR-cancel": B("The research says the statute sets no wording and does not require the contract to print this right."),
  "notice:OR-ccb": A("Give the owner the CCB Consumer Protection Notice and get it signed", "Entregue ao proprietário o Consumer Protection Notice do CCB e pegue a assinatura"),
  "item:1": B(DUP), "item:2": B(DUP), "item:3": B(DUP)
} };
S.PA = { cancel_ref: "73 P.S. 201-7", license_ref: "HICPA", lines: {
  "deposit": A("If the price is over $5,000, check that the deposit is not more than one third (plus special-order materials)", "Se o preço passar de $5,000.00, confira se o sinal não passa de um terço (mais materiais sob encomenda)", { ref: "HICPA", flag: "The limit depends on the price and on special-order materials, so the builder cannot compare it for you." }),
  "notice:PA-cancel": A("Check that the contract states the three business day right to cancel", "Confira se o contrato informa o direito de cancelar em três dias úteis", { flag: "Pennsylvania gives this right on every home improvement contract. The builder prints the cancellation notice only when the sale was made at the customer's home." }),
  "notice:PA-emergency-form": B(OPTIONAL + " For an emergency the customer called about."),
  "item:1": contents("HICPA section 7"), "item:2": B(DUP), "item:3": B(CLAUSE)
} };
S.RI = { cancel_ref: "6-28-4", lines: {
  "notice:RI-lien-statement": H("The lien notice that prints in the contract says this.", "No wording is prescribed. A lawyer should confirm the printed lien notice covers it."),
  "notice:RI-cancel-form": A("Attach the Notice of Cancellation, with a second copy for the customer", "Anexe o Notice of Cancellation, com uma segunda via para o cliente"),
  "notice:RI-62": A("If the customer is 62 or older, give the separate notice for buyers age 62 or older", "Se o cliente tiver 62 anos ou mais, entregue o aviso separado para compradores com 62 anos ou mais", { fact: "age62", needs: "A separate cancellation notice with a blank to fill. Not built.", flag: "The builder does not know the customer's age." }),
  "notice:RI-board": A("Attach the Board's consumer disclosures and the Summary of Registration Law", "Anexe as informações ao consumidor do Board e o Summary of Registration Law"),
  "item:1": H(LICLINE), "item:2": B(DUP), "item:3": B(DUP)
} };
S.SC = { cancel_ref: "37-2-503", lines: {
  "notice:SC-cancel": H(FTC),
  "item:1": B("The research found no rule that puts the number on the contract."), "item:2": B("The research says no contract clause is required."),
  "item:3": A("If the contract has an arbitration clause, put the arbitration notice on the first page in underlined capital letters", "Se o contrato tiver cláusula de arbitragem, coloque o aviso de arbitragem na primeira página em maiúsculas sublinhadas", { fact: "arbitration", flag: "Applies only with an arbitration clause. The research gives no law number." })
} };
S.SD = { cancel_ref: "SDCL 37-24-5.3", lines: {
  "item:1": B(PRINTS), "item:2": B(OPTIONAL), "item:3": B("Only if you use an excise tax license line; the research found no rule that requires it.")
} };
S.TN = { cancel_ref: "47-18-704", deposit_ref: "62-6-510", lines: {
  "notice:TN-owner": A("Add the NOTICE TO OWNER line directly above the owner's signature", "Inclua a linha NOTICE TO OWNER logo acima da assinatura do proprietário"),
  "notice:TN-board": A("Add the notice that home improvement contractors must be licensed by the board, with the board's phone", "Inclua o aviso de que empreiteiros de reforma precisam de licença do board, com o telefone do board"),
  "notice:TN-cancel": A("Add the BUYER'S RIGHT TO CANCEL statement on the front or just above the customer's signature", "Inclua a declaração BUYER'S RIGHT TO CANCEL na frente ou logo acima da assinatura do cliente"),
  "notice:TN-lien": A("Give the owner the lien NOTICE TO OWNER before the work or the contract", "Entregue ao proprietário o NOTICE TO OWNER de gravame antes do serviço ou do contrato"),
  "item:1": B(DUP), "item:2": B(DUP), "item:3": B(DUP)
} };
S.TX = { cancel_ref: "Tex. Bus. & Com. Code ch. 601", lines: {
  "written_contract": A("Get both spouses to sign before work starts, if the customer is married", "Pegue a assinatura dos dois cônjuges antes de começar o serviço, se o cliente for casado", { ref: "Tex. Prop. Code 53.254", fact: "married", sys: "second_signer", sys_en: "Both spouses sign the contract", sys_pt: "Os dois c\u00f4njuges assinam o contrato", flag: "The system sees the two customer signatures and their times. It does not see when the work started." }),
  "notice:TX-homestead": A("Add the homestead IMPORTANT NOTICE to the contract (10 point bold)", "Inclua no contrato o IMPORTANT NOTICE de homestead (negrito, corpo 10)", { ref: "Tex. Prop. Code 41.007", fact: "homestead", sys: "print", style: BOLD10, sys_en: "Homestead IMPORTANT NOTICE printed in the contract (10 point bold)", sys_pt: "IMPORTANT NOTICE de homestead impresso no contrato (negrito, corpo 10)" }),
  "notice:TX-defect": A("Add the construction defect notice to the contract (10 point bold)", "Inclua no contrato o aviso de defeitos de construção (negrito, corpo 10)", { ref: "Tex. Prop. Code 27.007", sys: "print", style: BOLD10, sys_en: "Construction defect notice (Chapter 27) printed in the contract (10 point bold)", sys_pt: "Aviso de defeitos de constru\u00e7\u00e3o (Chapter 27) impresso no contrato (negrito, corpo 10)", flag: "Printed on every residential job. The research does not narrow which jobs chapter 27 reaches; a lawyer should confirm." }),
  "notice:TX-disclosure": A("Hand the owner the disclosure statement before they sign", "Entregue ao proprietário a declaração de informações antes de ele assinar", { ref: "Tex. Prop. Code 53.255", sys: "deliver", sys_en: "Disclosure statement given to the owner before they sign", sys_pt: "Declara\u00e7\u00e3o de informa\u00e7\u00f5es entregue ao propriet\u00e1rio antes de ele assinar" }),
  "notice:TX-sublist": A("Give the owner the list of subcontractors and suppliers before work starts", "Entregue ao proprietário a lista de subempreiteiros e fornecedores antes de começar o serviço", { ref: "Tex. Prop. Code 53.256", fact: "subs", needs: "The list needs each subcontractor's and supplier's name, address and telephone number. Apex keeps a subcontractor's name, trade and license only, and has no supplier records, so the system cannot build the list yet (it needs a database change)." }),
  "notice:TX-sublist-waiver": B(OPTIONAL + " Only if the owner chooses to give up the list."),
  "item:1": B(DUP), "item:2": B(DUP), "item:3": B(DUP)
} };
S.UT = { cancel_ref: "Utah Code 13-11-4", lines: {
  "notice:UT-cancel": A("Put the cancellation statement on the first page in dark bold 12 point type", "Coloque a declaração de cancelamento na primeira página, em negrito escuro, corpo 12"),
  "notice:UT-auto-renew": A("If this is a service contract that renews for more than 12 months, put the renewal notice on the first page", "Se for contrato de serviço que renova por mais de 12 meses, coloque o aviso de renovação na primeira página", { flag: "Applies only to a recurring service contract." }),
  "item:1": B(PRINTS), "item:2": B(DUP), "item:3": B(DUP)
} };
S.VT = { cancel_ref: "9 V.S.A. 2454", lines: {
  "written_contract": A("If the job is over $10,000, get the contract signed before you take a deposit", "Se o serviço passar de $10,000.00, pegue o contrato assinado antes de receber o sinal", { ref: "26 V.S.A. 5509" }),
  "deposit": A("Check that the down payment is not more than half the labor or half the materials, whichever is more", "Confira se o sinal não passa de metade da mão de obra ou metade dos materiais, o que for maior", { ref: "26 V.S.A. 5509", flag: "The limit is not one clean number, so the builder cannot compare it for you. The law number is the one the research gives for the written contract rule." }),
  "cancellation_days": H("The builder leaves Saturday out when it counts the Vermont deadline."),
  "item:1": contents("26 V.S.A. 5509"), "item:2": B(DUP), "item:3": B(CLAUSE)
} };
S.VA = { cancel_ref: "59.1-21.4", lines: {
  "written_contract": A("Get the contract signed by both sides before any work or payment", "Pegue o contrato assinado pelas duas partes antes de qualquer serviço ou pagamento", { ref: "18VAC50-22-260", sys: "signed", sys_en: "Contract signed by the company and the customer", sys_pt: "Contrato assinado pela empresa e pelo cliente", flag: "The system sees the two signatures and their times. It does not see when the work started or when a payment was taken." }),
  "notice:VA-dpor": A("Give the customer the DPOR Statement of Consumer Protections and get a signed acknowledgment", "Entregue ao cliente o DPOR Statement of Consumer Protections e pegue o recibo assinado"),
  "notice:VA-recovery": A("Add a statement that the Contractor Transaction Recovery Fund exists and how to contact the board", "Inclua uma declaração de que o Contractor Transaction Recovery Fund existe e como falar com o board"),
  "item:1": contents("18VAC50-22-260 B 9"), "item:2": B(DUP), "item:3": B(PRINTS)
} };
S.WA = { cancel_ref: "RCW 63.14.154", lines: {
  "notice:WA-cancel": A("If the customer pays in more than four installments or with a service charge, add the NOTICE TO BUYER above their signature", "Se o cliente pagar em mais de quatro parcelas ou com taxa de serviço, inclua o NOTICE TO BUYER acima da assinatura", { flag: "Applies only to an installment sale." }),
  "notice:WA-defect": A("For a home build or a large remodel, add the notice of the construction defect process", "Para construção ou reforma grande de casa, inclua o aviso do processo de defeitos de construção", { flag: "A remodel counts only when it costs more than half the home's assessed value.", fact: "big_build", sys: "print", style: BOLD, sys_en: "Construction defect process notice printed in the contract", sys_pt: "Aviso do processo de defeitos de constru\u00e7\u00e3o impresso no contrato" }),
  "notice:WA-lien-info": A("Hand over L&I's construction lien information with the Notice to Customer", "Entregue as informações de gravame do L&I junto com o Notice to Customer"),
  "item:1": A("Keep the signed Notice to Customer for three years", "Guarde o Notice to Customer assinado por três anos", { ref: "RCW 18.27.114" }),
  "item:2": H(LICLINE), "item:3": B(DUP),
  "extra:1": B("Why the registration matters: the research says an unlicensed contractor cannot collect here.")
} };
S.WV = { cancel_ref: "W. Va. Code 46A-2-132", license_ref: "30-42-3", lines: {
  "notice:WV-cancel": credit(), "notice:WV-cancel-caption": B(DUP),
  "item:1": H(LICLINE), "item:2": contents("142 CSR 5"), "item:3": B(CLAUSE)
} };
S.WI = { cancel_ref: "Wis. Stat. 423.203", lines: {
  "notice:WI-lien-waiver": A("Give the Notice of Consumer's Right to Receive Lien Waivers as a separate page before signing, and keep proof", "Entregue o Notice of Consumer's Right to Receive Lien Waivers em página separada antes da assinatura e guarde a prova"),
  "notice:WI-lien": A("If you use subcontractors or suppliers, add the lien notice to the contract", "Se usar subempreiteiros ou fornecedores, inclua o aviso de gravame no contrato", { fact: "subs", sys: "print", style: { bold: true, min_pt: 8 }, sys_en: "Lien notice printed in the contract", sys_pt: "Aviso de gravame impresso no contrato" }),
  "notice:WI-defect": A("For building or remodeling a home, give the construction defect notice with the state brochure before signing", "Para construção ou reforma de casa, entregue o aviso de defeitos de construção com o folheto do estado antes da assinatura"),
  "notice:WI-brochure": B(DUP),
  "notice:WI-lien-claimant": B(NOTYOURS + " A subcontractor or supplier serves it."),
  "notice:WI-note-legend": A("If the customer signs a promissory note, put the required legend on the note", "Se o cliente assinar uma nota promissória, coloque a legenda exigida na nota", { fact: "note", needs: "The legend goes on the note, which is not a document the builder makes.", flag: "Applies only when a note is taken." }),
  "notice:WI-waterproof-noguarantee": A("For basement waterproofing with no guarantee, add the no-guarantee statement on the face of the contract", "Para impermeabilização de porão sem garantia, inclua a declaração de sem garantia na frente do contrato", { flag: "Applies only to basement waterproofing." }),
  "notice:WI-waterproof-dampness": B(OPTIONAL + " Basement waterproofing only."),
  "item:1": B(DUP), "item:2": B(DUP), "item:3": B(DUP)
} };
S.WY = { cancel_ref: "W.S. 40-14-253", lines: {
  "notice:WY-lien": A("Send the owner the NOTICE TO OWNER with a lien waiver form before you take any payment, including the deposit", "Envie ao proprietário o NOTICE TO OWNER com um formulário de lien waiver antes de receber qualquer pagamento, inclusive o sinal"),
  "notice:WY-lien-waiver": B(DUP),
  "notice:WY-cancel-form": H(FTC, "Credit sales only."),
  "item:1": B(DUP), "item:2": B(PRINTS),
  "item:3": A("For exterior storm repair, check the storm repair proposal and notice rules", "Para reparo externo de tempestade, confira as regras de proposta e aviso de reparo de tempestade", { flag: "Applies only to storm repair. The research names the rules without detail or a law number." })
} };

// ── RES-36: finish the lines whose wording is on file ─────────────────────
// A line is left for a person only when no system could do it. FIN gives the
// builder what each such line was missing. It is merged onto the rows above
// (FIN[state][line key]), so the sorting above stays readable.
//   sys "parts"   the line is done by printing its parts. A part is one
//                 notice from the rider data (n = its id; the wording is the
//                 notice's own text_on_file, copied by the loader, never typed
//                 here) plus how the law says it must be given:
//                   as: "page"       its own page (default: inside the contract)
//                   place            "first_page" | "above_signature" | "face" |
//                                    "after:C04" (right after that clause area)
//                   heading          the heading the law names (read by script
//                                    from the rider data: see heading())
//                   style            { bold, min_pt, caps, larger }
//                   sign             the customer signs and dates this part
//                   company_sign     the company's signature shows on it too
//                   initials         the customer initials beside it
//                   choose           the customer initials ONE of these blanks
//                   copies: 2        "in duplicate": printed twice in the PDF
//                   bare             the page carries the statement only
//                   date_above       the transaction date prints above it
//                   fill             [[find, value]] or [[pattern, value, "re"]]:
//                                    a blank and what the system puts there
//                   biz              [fact, answer]: this version is the true one
//   only_yes      the part states a fact or asks for a signature, so it is
//                 used only when the question was answered Yes (no answer or
//                 "Not sure" leaves the line with a person, never a guess).
//   biz_key       the business fact (document settings) that picks the part.
//   ask           per-contract values the blanks need and Apex does not keep.
//   also          the piece of the line no system can do: its own hand-tick line.
//   official      { slot, ack }: the agency's own file, loaded by Apex staff.
//   when_cancel   the line exists only when the contract carries a Notice of
//                 Cancellation (sold at the customer's home).
//   outside       why the line stays with a person for good (outside Apex).
//   official.file the agency's own PDF shipped with the site (state-docs/),
//                 copied unaltered from the third research pass; sha256 is
//                 its fingerprint. A slot without a file waits for Apex staff.
//   held          { cat, why }: why a notice still has no wording the system
//                 may print, after the third research pass. cat: "lawyer"
//                 (needs a lawyer's answer), "current" (needs a current
//                 official copy), "review" (the official copy needs review),
//                 "missing" (no official copy was obtained), "none" (the law
//                 prescribes no wording).
var RIDERS = JSON.parse(readFileSync(new URL("../data/contract-state-riders-v1.json", import.meta.url), "utf8"));
function notice(id) {
  var n = ((RIDERS.riders[id.slice(0, 2)] || {}).notices || []).filter(function (x) { return x.id === id; })[0];
  if (!n) { throw new Error("no such notice: " + id); }
  return n;
}
// A heading the law names is read from the rider data by pattern, never typed.
function heading(id, field, re) {
  var n = notice(id), src = field === "quote_note" ? ((n.range || {}).quote_note || "") : (field === "text" ? (n.text_on_file || "") : (n[field] || ""));
  var m = re.exec(src);
  if (!m) { throw new Error("heading not found for " + id + " in " + field); }
  return m[1];
}
var B12 = { bold: true, min_pt: 12 };
var SELLER = "{business_legal_name}", SELLER_ADDR = "{business_address}";
var ONLY_APEX_TEXT = "The system does this line once the customer has what the law asks for inside their own signing visit.";
var BIZ = {
  cgl: { key: "ins_cgl", en: "Does your business carry commercial general liability insurance?", pt: "A sua empresa tem seguro de responsabilidade civil geral (CGL)?",
    options: [{ v: "yes", en: "Yes", pt: "Sim" }, { v: "no", en: "No", pt: "Não" }, { v: "self", en: "Self-insured", pt: "Autossegurada" },
      { v: "llc", en: "LLC with liability insurance or other security required by law", pt: "LLC com seguro ou outra garantia exigida por lei" }],
    extra: [{ key: "ins_cgl_insurer", en: "Insurance company (name)", pt: "Seguradora (nome)", when: ["yes", "llc"] },
      { key: "ins_cgl_phone", en: "Insurance company's phone", pt: "Telefone da seguradora", when: ["yes", "llc"] },
      { key: "ins_cgl_policy", en: "Policy number", pt: "Número da apólice", when: ["yes"] }] },
  wc: { key: "ins_wc", en: "Does your business carry workers' compensation insurance?", pt: "A sua empresa tem seguro de acidentes de trabalho (workers' compensation)?",
    options: [{ v: "yes", en: "Yes, for all employees", pt: "Sim, para todos os funcionários" }, { v: "no", en: "No", pt: "Não" }, { v: "no_employees", en: "No employees", pt: "Sem funcionários" }], extra: [] }
};
var ASK = {
  service_charge_pct: { en: "Service charge rate, percent per year (for example 12)", pt: "Taxa de serviço, por cento ao ano (por exemplo 12)" },
  legal_description: { en: "Legal description of the property (from the deed or the county record)", pt: "Descrição legal do imóvel (da escritura ou do registro do condado)" },
  property_description: { en: "Short description of the property", pt: "Descrição curta do imóvel" },
  work_description: { en: "Materials provided or work performed", pt: "Materiais fornecidos ou serviço feito" }
};
function cancelForm(id, fill) { return { n: id, as: "page", copies: 2, style: BOLD10, fill: fill }; }
var NAME_ADDR = [["(name of contractor)", SELLER], ["(address of contractor's place of business)", SELLER_ADDR]];
var LIST_EN = "List of subcontractors and suppliers given to the owner with the contract", LIST_PT = "Lista de subempreiteiros e fornecedores entregue ao proprietário junto com o contrato";
var OUT_NOTE = "The statement goes on the promissory note. Apex does not make promissory notes, so only a person can put it there.";
var FIN = {
  AK: { "notice:AK-defect-notice": { sys: "parts", only_yes: true, parts: [{ n: "AK-defect-notice", as: "page", heading: heading("AK-defect-notice", "title", /^(.+?) \(/), style: { bold: true, caps: true }, sign: true }],
    sys_en: "\"Notice of Potential Claims Must Be Provided within One Year\" page, signed by the customer", sys_pt: "Página \"Notice of Potential Claims Must Be Provided within One Year\", assinada pelo cliente" } },
  AZ: { "notice:AZ-note-statement": { outside: OUT_NOTE },
    "notice:AZ-pool-notice": { held: { cat: "lawyer", why: "The Department of Health Services notice is on file, but the notice itself says reproducing it for a commercial purpose is governed by A.R.S. 39-121.03. Apex does not print or attach it until a lawyer says a contractor's software may." } },
    "notice:AZ-new-dwelling": { sys: "parts", fact: "new_home", only_yes: true, parts: [{ n: "AZ-new-dwelling", style: BOLD10, initials: true }],
      sys_en: "Registrar complaint provision printed in the contract (10 point bold), with the buyer's initials", sys_pt: "Cláusula de reclamação do Registrar impressa no contrato (negrito, corpo 10), com as iniciais do comprador" } },
  AR: { "notice:AR-lien": { sys: "parts", parts: [{ n: "AR-lien", as: "page", style: { bold: true, caps: true }, sign: true, company_sign: true,
      fill: [["SIGNED:______________________________", "SIGNED: {state_part_signature}"], ["ADDRESS OF PROPERTY: _______________", "ADDRESS OF PROPERTY: {property_address}"], ["DATE:_____________", "DATE: {state_part_date}"], ["__________________\nCONTRACTOR", "{state_part_company_signature}\nCONTRACTOR"]] }],
    sys_en: "IMPORTANT NOTICE TO OWNER (lien notice) signed by the owner", sys_pt: "IMPORTANT NOTICE TO OWNER (aviso de gravame) assinado pelo proprietário" } },
  CA: {
    "notice:CA-7159.1": { sys: "parts", only_yes: true, parts: [{ n: "CA-7159.1", as: "page", style: { bold: true, min_pt: 18 }, sign: true }],
      sys_en: "WARNING TO BUYER on its own page (18 point bold), signed and dated by the buyer", sys_pt: "WARNING TO BUYER em página própria (negrito, corpo 18), assinado e datado pelo comprador" },
    "notice:CA-7191": { sys: "parts", parts: [{ n: "CA-7191", place: "after:C14", heading: heading("CA-7191", "format", /titled ([A-Z ]+);/), style: { bold: true, min_pt: 10, caps: true }, initials: true }],
      sys_en: "ARBITRATION OF DISPUTES notice printed after the arbitration clause, with the buyer's initials", sys_pt: "Aviso ARBITRATION OF DISPUTES impresso depois da cláusula de arbitragem, com as iniciais do comprador",
      flag: "The statute puts the NOTICE right before the initials line and the WE HAVE READ sentence right after it. The copy on file holds both in one block, so both print together with the initials after them. A lawyer should confirm." },
    "notice:CA-7159.10": { sys: "parts", fact: "small_repair", only_yes: true, parts: [{ n: "CA-7159.10", style: B12, sign: true }, { n: "CA-7159.10-copy", style: B12 }, { n: "CA-7159.10-cancel", place: "above_signature", style: B12 }],
      sys_en: "Service and repair notices printed in the contract (12 point bold), signed and dated by the buyer", sys_pt: "Avisos de service and repair impressos no contrato (negrito, corpo 12), assinados e datados pelo comprador" },
    "notice:CA-downpayment": { sys: "parts", fact: "deposit", parts: [{ n: "CA-downpayment", place: "after:C04", heading: heading("CA-downpayment", "format", /heading '([^']+)'/), style: B12 }],
      sys_en: "Down payment statement printed under the heading \"Downpayment\" (12 point bold)", sys_pt: "Declaração de sinal impressa sob o título \"Downpayment\" (negrito, corpo 12)" },
    "notice:CA-progress-payments": { sys: "parts", fact: "progress", parts: [{ n: "CA-progress-payments", place: "after:C04", style: B12 }],
      sys_en: "Progress payment statement printed with the payment schedule (12 point bold)", sys_pt: "Declaração de pagamentos por etapa impressa junto à tabela de pagamentos (negrito, corpo 12)" },
    "notice:CA-subs-disclaimer": { sys: "parts", only_yes: true, parts: [{ n: "CA-subs-disclaimer" }], co_parts: ["CA-subs-disclaimer"],
      sys_en: "Subcontractor statement printed in the contract and on each change order", sys_pt: "Declaração de subempreiteiro impressa no contrato e em cada aditivo" },
    "notice:CA-cgl-none": { sys: "parts", biz_key: "cgl", parts: [
        { n: "CA-cgl-none", biz: ["cgl", "no"], heading: heading("CA-cgl-none", "format", /heading '([^']+)'/), fill: [[heading("CA-cgl-none", "text", /^(\([^)]*\))/), SELLER]] },
        { n: "CA-cgl-insured", biz: ["cgl", "yes"], heading: heading("CA-cgl-insured", "format", /heading '([^']+)'/), fill: [[heading("CA-cgl-insured", "text", /^(\([^)]*\))/), SELLER], ["(the insurance company)", "{biz_cgl_insurer}"], ["__________", "{biz_cgl_phone}"]] },
        { n: "CA-cgl-self", biz: ["cgl", "self"], heading: heading("CA-cgl-self", "format", /heading '([^']+)'/), fill: [[heading("CA-cgl-self", "text", /^(\([^)]*\))/), SELLER]] },
        { n: "CA-cgl-llc", biz: ["cgl", "llc"], heading: heading("CA-cgl-llc", "format", /heading '([^']+)'/), fill: [[heading("CA-cgl-llc", "text", /^(\([^)]*\))/), SELLER], ["(the insurance company or trust company or bank)", "{biz_cgl_insurer}"], ["____", "{biz_cgl_phone}"]] }],
      sys_en: "Liability insurance (CGL) statement that is true for your business, printed under its heading", sys_pt: "Declaração de seguro de responsabilidade (CGL) que vale para a sua empresa, impressa sob o título" },
    "notice:CA-wc-exempt": { sys: "parts", biz_key: "wc", parts: [
        { n: "CA-wc-exempt", biz: ["wc", "no_employees"], heading: heading("CA-wc-exempt", "format", /heading '([^']+)'/), fill: [[heading("CA-wc-exempt", "text", /^(\([^)]*\))/), SELLER]] },
        { n: "CA-wc-carries", biz: ["wc", "yes"], heading: heading("CA-wc-carries", "format", /heading '([^']+)'/), fill: [[heading("CA-wc-carries", "text", /^(\([^)]*\))/), SELLER]] }],
      sys_en: "Workers' compensation statement that is true for your business, printed under its heading", sys_pt: "Declaração de workers' compensation que vale para a sua empresa, impressa sob o título",
      flag: "The statute gives a statement for a business with no employees and for one that carries the insurance. A business with employees and no insurance has no statement to print; the line then stays with a person." },
    "notice:CA-7day-notice": { sys: "parts", fact: "disaster", only_yes: true, parts: [{ n: "CA-7day-notice", place: "above_signature", style: B12, sign: true },
        cancelForm("CA-7day-form", [["/enter date of transaction/", "{transaction_date}"], ["to ,", "to " + SELLER + ","], ["at\n\n/address", "at " + SELLER_ADDR + "\n\n/address"], ["not later than midnight of .", "not later than midnight of {state_deadline_7}."]])],
      sys_en: "Seven-Day Right to Cancel notice by the signature (12 point bold) and its form in two copies", sys_pt: "Aviso Seven-Day Right to Cancel junto à assinatura (negrito, corpo 12) e o formulário em duas vias" },
    "notice:CA-7164-lien": { sys: "parts", fact: "new_home", only_yes: true, parts: [{ n: "CA-7164-lien", heading: heading("CA-7164-lien", "format", /heading '([^']+)'/) }],
      sys_en: "Mechanics Lien Warning for new homes printed under its heading", sys_pt: "Mechanics Lien Warning de casas novas impresso sob o título" }
  },
  CT: { "notice:CT-note-statement": { outside: OUT_NOTE },
    "notice:CT-email-sentence": { sys: "email", when_cancel: true, parts: [{ n: "CT-email-sentence", as: "message" }], sys_en: "Required sentence placed beside the message that sends the contract", sys_pt: "Frase exigida colocada junto à mensagem que envia o contrato",
      flag: "The app builds the message and the person sends it (text, WhatsApp or email). The sentence is added to every such message. Its type size inside another app cannot be set from here." } },
  DE: { "notice:DE-ag-summary": { sys: "official", official: { slot: "DE-ag-summary", file: "state-docs/de-home-improvement-summary.pdf", version: "Revised 10/31/2023", sha256: "27769521e1638d43965b5bc963e5b6157465ef59fcf8772c0f5272714905e697" }, sys_en: "Attorney General's \"Summary of Your Rights\" given to the customer before they sign", sys_pt: "\"Summary of Your Rights\" do Attorney General entregue ao cliente antes de ele assinar" } },
  ID: { "item:2": { sys: "list", sys_en: LIST_EN, sys_pt: LIST_PT } },
  IL: {
    "notice:IL-pamphlet": { sys: "parts", parts: [{ n: "IL-pamphlet", as: "page", style: { min_pt: 12 } }], sys_en: "\"Home Repair: Know Your Consumer Rights\" pamphlet given to the customer as a separate document (12 point), before they sign", sys_pt: "Folheto \"Home Repair: Know Your Consumer Rights\" entregue ao cliente como documento separado (corpo 12), antes de ele assinar",
      flag: "The pamphlet's wording is fixed by 815 ILCS 513/20(c) and is printed from the statute. The Attorney General's one-page leaflet is a different document and is not used." },
    "notice:IL-ack-form": { sys: "parts", parts: [{ n: "IL-ack-form", as: "page", heading: heading("IL-ack-form", "format", /entitled ([A-Za-z ]+),/), sign: true, company_sign: true, copies: 2 }],
      sys_en: "Consumer Rights Acknowledgment Form signed by the customer and the company, in two copies", sys_pt: "Consumer Rights Acknowledgment Form assinado pelo cliente e pela empresa, em duas vias" },
    "notice:IL-lien": { sys: "parts", parts: [{ n: "IL-lien", style: BOLD10 }], sys_en: "Lien notice printed in the contract (10 point bold)", sys_pt: "Aviso de gravame impresso no contrato (negrito, corpo 10)",
      also: { en: "Give the owner your sworn statement of everyone furnishing labor or materials before the first payment", pt: "Entregue ao proprietário a sua declaração juramentada de todos que fornecem mão de obra ou materiais antes do primeiro pagamento", why: "A sworn statement is sworn by a person before a notary." },
      flag: "The notice is for an owner-occupied single-family home. The system prints it on every residential job (the safe side)." },
    "notice:IL-insurance-cancel": { sys: "parts", only_yes: true, parts: [{ n: "IL-insurance-cancel", style: BOLD10 }, cancelForm("IL-insurance-cancel-form", NAME_ADDR)],
      sys_en: "Insurance cancellation statement printed in the contract and its form in two copies", sys_pt: "Declaração de cancelamento de seguro impressa no contrato e o formulário em duas vias" }
  },
  IN: { "notice:IN-cancel-10-6": { sys: "parts", parts: [{ n: "IN-cancel-10-6", fill: [["\\(name\\s+of\\s+real\\s+property\\s+improvement\\s+supplier\\)", SELLER, "re"]] },
      cancelForm("IN-cancel-10-6-form", [["\\(name\\s+of\\s+real\\s+property\\s+improvement\\s+supplier\\)", SELLER, "re"], ["\\(address\\s+of\\s+real\\s+property\\s+improvement\\s+supplier's\\s+place\\s+of\\s+business\\)", SELLER_ADDR, "re"],
        ["\\(electronic\\s+mail\\s+address\\s+described\\s+in\\s+section\\s+10\\(a\\)\\(2\\)\\(A\\)\\s+or\\s+10\\(a\\)\\(2\\)\\(B\\)\\(iii\\)\\s+of\\s+this\\s+chapter\\)", "{business_email}", "re"]])],
    sys_en: "Statement of the right to cancel printed in the contract and the NOTICE OF CANCELLATION form in two copies", sys_pt: "Declaração do direito de cancelar impressa no contrato e o formulário NOTICE OF CANCELLATION em duas vias" } },
  IA: { "notice:IA-lien": { sys: "parts", parts: [{ n: "IA-lien", style: BOLD10 }], sys_en: "Mechanics lien owner notice printed in the contract (10 point bold)", sys_pt: "Aviso de gravame ao proprietário impresso no contrato (negrito, corpo 10)",
    also: { en: "Post the job on the state's mechanics lien registry within 10 days", pt: "Registre o serviço no cadastro de gravames do estado em até 10 dias", why: "The registry is the state's own website; only a person with the contractor's account can post there." },
    flag: "The copy on file ends with one sentence that is an instruction (it carries the registry address and number the notice must show). It prints as it is on file. A lawyer should confirm." } },
  MD: { "notice:MD-security": { sys: "parts", only_yes: true, parts: [{ n: "MD-security", place: "first_page", style: BOLD10, initials: true }],
    sys_en: "Security and rescission notice on the first page (10 point bold), with the owner's initials", sys_pt: "Aviso de garantia e rescisão na primeira página (negrito, corpo 10), com as iniciais do proprietário" } },
  ME: { "notice:ME-ag": { sys: "official", official: { slot: "ME-ag" }, sys_en: "Attorney General's consumer information addendum given to the customer with the contract", sys_pt: "Adendo de informa\u00e7\u00f5es ao consumidor do Attorney General entregue ao cliente junto com o contrato",
    flag: "The addendum changes (it lists contractors the State has sued). Apex staff must load the current copy each time the Attorney General updates it." } },
  NM: { "notice:NM-default": { held: { cat: "missing", why: "The statute (60-13-19(C)) gives the substance only; the disclosure must be on a form approved by the Construction Industries Division, and the third pass did not find that form." } } },
  OR: { "notice:OR-lien": { sys: "official", official: { slot: "OR-lien", file: "state-docs/or-information-notice-liens.pdf", version: "CCB form adopted 9-16", sha256: "111d94e5cea6575169bb140c84af2f111fae2094e772d6cce0c6d0ab6778f938" }, sys_en: "CCB \"Information Notice to Owner About Construction Lien Rights\" given to the owner with the contract", sys_pt: "\"Information Notice to Owner About Construction Lien Rights\" do CCB entregue ao propriet\u00e1rio junto com o contrato" },
    "notice:OR-ccb": { sys: "official", official: { slot: "OR-ccb", ack: true, file: "state-docs/or-consumer-protection-notice.pdf", version: "CCB form CPN 4-26-2011", sha256: "a89916480fb4a6408f1c9b93552b2694910a5e81f343ce65d08bc36274d159e3" }, sys_en: "CCB Consumer Protection Notice given to the owner, with their signed acknowledgment", sys_pt: "Consumer Protection Notice do CCB entregue ao propriet\u00e1rio, com o recibo assinado" } },
  MN: { "notice:MN-roofing-cancel": { sys: "parts", fact: "roof_insurance", only_yes: true, parts: [{ n: "MN-roofing-cancel", style: BOLD10 }, cancelForm("MN-roofing-cancel-form", NAME_ADDR)],
    sys_en: "72 hour cancellation statement printed in the contract and its form in two copies", sys_pt: "Declaração de cancelamento de 72 horas impressa no contrato e o formulário em duas vias" } },
  MS: { "notice:MS-insurance": { sys: "parts", biz_key: "cgl", parts: [{ n: "MS-insurance", biz: ["cgl", "yes"], place: "above_signature", style: { bold: true, larger: true },
      fill: [["The name of the insurer is __________________", "The name of the insurer is {biz_cgl_insurer}"], ["the policy number is _________________", "the policy number is {biz_cgl_policy}"]] }],
    sys_en: "Liability insurance disclosure printed just above the customer's signature (bold, larger type)", sys_pt: "Declaração de seguro de responsabilidade impressa logo acima da assinatura do cliente (negrito, letra maior)",
    flag: "The Board's wording exists only for a contractor who DOES carry general liability insurance. For any other answer there is nothing official to print and the line stays with a person." } },
  MO: { "notice:MO-cancel-credit": { sys: "parts", only_yes: true, parts: [{ n: "MO-cancel-credit", heading: heading("MO-cancel-credit", "format", /headed ([A-Z ]+) in/), date_above: true, style: BOLD10, fill: [["(______)", SELLER + ", " + SELLER_ADDR]] }],
      sys_en: "NOTICE OF CANCELLATION statement printed in the contract (10 point bold), with the transaction date and your name and address filled in", sys_pt: "Declara\u00e7\u00e3o NOTICE OF CANCELLATION impressa no contrato (negrito, corpo 10), com a data da transa\u00e7\u00e3o e o seu nome e endere\u00e7o preenchidos",
      flag: "The Revisor's page lays the notice out in a table; only the paragraph the buyer reads is cut, the caption is printed as its heading and the date above it. Compare with the rendered page; a lawyer should confirm." },
    "notice:MO-consent": { sys: "parts", fact: "lien_consent", only_yes: true, parts: [{ n: "MO-consent", style: BOLD10, sign: true }],
    sys_en: "CONSENT OF OWNER printed in the contract (10 point bold) and signed by the owner on its own", sys_pt: "CONSENT OF OWNER impresso no contrato (negrito, corpo 10) e assinado à parte pelo proprietário" } },
  NV: { "notice:NV-sub-list": { sys: "list", sys_en: LIST_EN, sys_pt: LIST_PT, flag: "NRS 624.600 also asks for a lien notice and prescribes no wording for it. The two state information forms (liens and contractors) already go to the owner with the contract." } },
  NC: { "notice:NC-cancel-credit": { sys: "parts", only_yes: true, parts: [{ n: "NC-cancel-credit", place: "above_signature", style: BOLD10 },
      cancelForm("NC-cancel-credit-form", [[" (enter date of transaction)", " {transaction_date}"], ["send a telegram to _________________", "send a telegram to " + SELLER], ["at______________________________,", "at " + SELLER_ADDR + ","], ["not later than midnight of __________________", "not later than midnight of {cancellation_deadline_date}"]])],
    sys_en: "Credit-sale cancellation statement by the signature and the Notice of Cancellation form in two copies", sys_pt: "Declaração de cancelamento de venda a crédito junto à assinatura e o formulário Notice of Cancellation em duas vias" } },
  OH: { "notice:OH-estimate-form": { sys: "parts", parts: [{ n: "OH-estimate-form", choose: ["_____ written estimate", "_____ oral estimate", "_____ no estimate"] }],
    sys_en: "Estimate form printed in the contract, with the customer's initials on their choice", sys_pt: "Formulário de estimativa impresso no contrato, com as iniciais do cliente na opção escolhida",
    flag: "The rule wants the form at the first face to face contact and also said out loud. The system gives it with the contract; saying it out loud stays with the person." } },
  RI: { "notice:RI-board": { sys: "official", official: { slot: "RI-board", file: "state-docs/ri-what-homeowners-should-know.pdf", version: "Approved by the Board March 8, 2023", sha256: "2982c903684c48817e32a85cbfd309f480e2ab1d62a463fdd8884c1420271066" },
      sys_en: "Board's summary \"What Homeowners Should Know\" given to the customer with the contract", sys_pt: "Resumo do Board \"What Homeowners Should Know\" entregue ao cliente junto com o contrato",
      also: { en: "Add the Board's consumer disclosures to the contract", pt: "Inclua no contrato as informa\u00e7\u00f5es ao consumidor exigidas pelo Board", needs_text: true, why: "5-65-3(o) points to disclosures set by the Board's regulations; the third pass read the Board's rules and found no such wording." } },
    "notice:RI-cancel-form": { sys: "parts", parts: [{ n: "RI-cancel-form", as: "page", copies: 2, heading: heading("RI-cancel-form", "format", /caption '([^']+)'/), date_above: true, style: BOLD,
        fill: [["(insert name and address of the seller)", SELLER + ", " + SELLER_ADDR]] }],
      sys_en: "Notice of Cancellation in two copies, with the transaction date and your name and address filled in", sys_pt: "Notice of Cancellation em duas vias, com a data da transa\u00e7\u00e3o e o seu nome e endere\u00e7o preenchidos" },
    "notice:RI-62": { sys: "parts", only_yes: true, parts: [{ n: "RI-62", as: "page", heading: heading("RI-62", "quote_note", /caption '([^']+)'/), date_above: true, style: BOLD,
      fill: [["(insert name and address of the seller)", SELLER + ", " + SELLER_ADDR]] }],
    sys_en: "Separate Notice of Cancellation for buyers age 62 or older, with your name and address filled in", sys_pt: "Notice of Cancellation separado para compradores com 62 anos ou mais, com o seu nome e endereço preenchidos" } },
  TX: { "notice:TX-sublist": { sys: "list", parts: [{ n: "TX-sublist", as: "list_notice", style: BOLD10 }], sys_en: LIST_EN, sys_pt: LIST_PT } },
  UT: { "notice:UT-cancel": { sys: "parts", parts: [{ n: "UT-cancel", place: "first_page", style: B12, fill: [[" (or time period reflecting the supplier's cancellation policy but not less than three business days)", ""]] }],
    sys_en: "Cancellation statement on the first page (dark bold, 12 point)", sys_pt: "Declaração de cancelamento na primeira página (negrito escuro, corpo 12)",
    flag: "The words in parentheses in the statute are an instruction to the seller (it may give a longer period), not words to print. The system leaves them out and keeps the three business days." } },
  VA: { "notice:VA-dpor": { sys: "official", official: { slot: "VA-dpor", ack: true, file: "state-docs/va-statement-of-consumer-protections.pdf", version: "Revised 4/29/2025 (effective 07/01/2025)", sha256: "243937bc89a3a03c18d68e36c83d146338a0689b0e1401e0817e65798e58fbc4" }, sys_en: "DPOR Statement of Consumer Protections given to the customer, with their signed acknowledgment", sys_pt: "DPOR Statement of Consumer Protections entregue ao cliente, com o recibo assinado" } },
  WA: { "notice:WA-lien-info": { held: { cat: "missing", why: "RCW 60.04.255 wants L&I's own master document handed over; the third pass did not find it on L&I's site." } },
    "item:1": { sys: "official", official: { slot: "WA-customer-form", ack: true, title: "L&I Contractor Registration Disclosure Statement, Notice to Customers (F625-030-000)", cite: "RCW 18.27.114", file: "state-docs/wa-notice-to-customer-f625-030-000.pdf", version: "F625-030-000, 12-2015", sha256: "70dc3e0ac9fe5ed53c748d61b62ef592e930f3ae1864faef281e2d60fdf6e37c" },
      sys_en: "L&I's own Notice to Customers form given to the customer, with their signed acknowledgment kept on the contract", sys_pt: "Formul\u00e1rio Notice to Customers do L&I entregue ao cliente, com o recibo assinado guardado no contrato",
      flag: "L&I's form is handed over unaltered, so its blanks (registration number, bond amount) are not filled in on the form itself; the contract's own Notice to Customer and license line carry the registration. The signed acknowledgment is kept with the contract for as long as the contract is kept; a lawyer should confirm that this meets the three-year rule." },
    "notice:WA-cancel": { sys: "parts", fact: "installments", only_yes: true, ask: ["service_charge_pct"], parts: [{ n: "WA-cancel", place: "above_signature", style: BOLD10, fill: [[". . . .% (must be filled in)", "{sv_service_charge_pct}%"]] }],
    sys_en: "NOTICE TO BUYER printed directly above the buyer's signature (10 point bold)", sys_pt: "NOTICE TO BUYER impresso logo acima da assinatura do comprador (negrito, corpo 10)" } },
  WV: { "notice:WV-cancel": { sys: "parts", only_yes: true, parts: [{ n: "WV-cancel", place: "above_signature", heading: heading("WV-cancel-caption", "text", /^([\s\S]+)$/), style: BOLD, fill: [["(Name and mailing address of seller)", SELLER + ", " + SELLER_ADDR]] }],
    sys_en: "BUYER'S RIGHT TO CANCEL statement printed by the signature, with your name and address filled in", sys_pt: "Declaração BUYER'S RIGHT TO CANCEL impressa junto à assinatura, com o seu nome e endereço preenchidos" } },
  WI: {
    "notice:WI-lien-waiver": { sys: "parts", parts: [{ n: "WI-lien-waiver", as: "page", bare: true, sign: true }],
      sys_en: "Notice of Consumer's Right to Receive Lien Waivers on its own page, with proof the customer received it", sys_pt: "Notice of Consumer's Right to Receive Lien Waivers em página própria, com prova de que o cliente recebeu" },
    "notice:WI-defect": { sys: "parts", parts: [{ n: "WI-defect", style: BOLD }, { n: "WI-brochure", as: "page" }],
      sys_en: "Construction defect notice printed in the contract and the state's Right to Cure brochure given with it as its own page", sys_pt: "Aviso de defeitos de constru\u00e7\u00e3o impresso no contrato e o folheto Right to Cure do estado entregue junto, em p\u00e1gina pr\u00f3pria",
      flag: "The notice is for building or remodeling a home (not repair or maintenance only). The system prints it on every residential job (the safe side)." },
    "notice:WI-note-legend": { outside: OUT_NOTE },
    "notice:WI-waterproof-noguarantee": { sys: "parts", fact: "waterproof", only_yes: true, parts: [{ n: "WI-waterproof-noguarantee", place: "face", style: BOLD }],
      sys_en: "No-guarantee statement on the face of the contract, apart from the other provisions (bold)", sys_pt: "Declaração de sem garantia na frente do contrato, separada das outras cláusulas (negrito)" }
  },
  WY: { "notice:WY-lien": { sys: "parts", ask: ["work_description", "property_description", "legal_description"], parts: [{ n: "WY-lien", as: "page", company_sign: true, fill: [
        ["(and contact person:\\n)_+\\n_+\\n_+", "$1" + SELLER + "\n" + SELLER_ADDR + "\n{business_phone}, {company_signer_name}", "re"],
        ["(MATERIALS PROVIDED OR WORK PERFORMED:\\n)_+\\n_+\\n_+", "$1{sv_work_description}", "re"],
        ["(PROPERTY DESCRIPTION:\\n)_+\\n_+\\n_+", "$1{sv_property_description}", "re"],
        ["(ADDRESS:\\n)_+\\n_+\\n_+", "$1{property_address}", "re"],
        ["(LEGAL DESCRIPTION:\\n)_+\\n_+\\n_+", "$1{sv_legal_description}", "re"],
        ["SIGNED: ________________", "SIGNED: {state_part_company_signature}"], ["DATE: __________________", "DATE: {state_part_company_date}"]] },
      { n: "WY-lien-waiver", as: "page" }],
    sys_en: "NOTICE TO OWNER, filled in and signed by the company, given to the owner with the lien waiver form", sys_pt: "NOTICE TO OWNER, preenchido e assinado pela empresa, entregue ao proprietário com o formulário de lien waiver",
    flag: "The owner gets the notice with the contract, so before any payment made after the contract is sent. A payment taken before the contract is sent is outside what the system sees." } }
};
// Why a notice still has no wording the system may print, after the third
// research pass (INDEX.md there). Merged like FIN.
var HELD = {
  AR: { "notice:AR-cancel": { cat: "missing", why: "No official copy of the NOTICE OF CANCELLATION form was obtained (4-89-107, 4-89-108); the only copy is a secondary (Justia) one." } },
  GA: { "notice:GA-8-2-41": { cat: "current", why: "The official copy is the 2006 enactment (SB 573), not checked for later amendments, and its PDF text needs review." },
    "notice:GA-43-41-7": { cat: "none", why: "No wording is prescribed: the rule (553-7-.01) requires the contractor's own written warranty to be offered and attached." } },
  ID: { "notice:ID-disclosure": { cat: "none", why: "Idaho Code 45-525 lists what the disclosure must say and prescribes no wording." },
    "notice:ID-cancel-credit": { cat: "review", why: "The complete official copy is a PDF whose words are broken at line ends; it may not be printed until someone reviews it against the official page." } },
  IN: { "notice:IN-cancel": { cat: "none", why: "IC 24-5-10-9 lists what the notice must contain and prescribes no sentence." } },
  MD: { "notice:MD-cancel": { cat: "none", why: "The official statement and form (CL 14-302) say three business days; a home improvement contract must allow five (seven at 65 or older) and nothing official prints that wording." },
    "notice:MD-oral-ack": { cat: "review", why: "The official page serves the acknowledgment's check box as a question mark; it may not be printed until someone reviews it against the statute." } },
  NJ: { "notice:NJ-division": { cat: "lawyer", why: "New Jersey is held: the rule prints 1-888-656-6225 and the Attorney General's pages give 800-242-5846. Which number is current is not settled." },
    "notice:NJ-cancel": { cat: "current", why: "New Jersey is held: the official copy is the 2004 enactment, not checked for later amendments." } },
  OK: { "notice:OK-cancel-credit": { cat: "lawyer", why: "The official wording (14A O.S. 2-503) is on record, but it lets the seller keep up to five percent of the down payment, which conflicts with the federal full-refund notice printed in the same contract." } },
  TN: { "notice:TN-owner": { cat: "missing", why: "No official copy of T.C.A. 62-6-508 was obtained; the only copy is a secondary mirror." },
    "notice:TN-cancel": { cat: "missing", why: "No official copy of T.C.A. 47-18-704 was obtained; the only copy is a secondary mirror." },
    "notice:TN-lien": { cat: "missing", why: "No official copy of T.C.A. 66-11-203 was obtained; the only copy is a secondary mirror." } }
};
// The official page or document behind a line that stays with a person, so
// the contractor opens it in one tap and never has to search (Nicole,
// 10/05/2026). Every address is copied from the third research pass
// (pass3/<ST>.md, INDEX.md); none was typed from memory. A line with no entry
// here falls back to its notice's own official address in the rider data.
//   links: [{ url, en, pt }]   en / pt say WHAT it opens.
//   link_note: { en, pt }      plain words when the state publishes nothing
//                              online, or what to look for on the page.
function L(url, en, pt) { return { url: url, en: en, pt: pt }; }
var TN_NOTE = function (cite) { return { en: "Tennessee publishes its code only through LexisNexis public access, which this link cannot open directly. Look up " + cite + " there.", pt: "O Tennessee publica o c\u00f3digo s\u00f3 pelo acesso p\u00fablico da LexisNexis, que este link n\u00e3o abre direto. Procure " + cite + " l\u00e1." }; };
var TN_LINK = L("https://www.capitol.tn.gov/", "Open the Tennessee General Assembly site", "Abrir o site da Assembleia Geral do Tennessee");
var LINKS = {
  AZ: { "notice:AZ-pool-notice": { links: [L("https://www.azdhs.gov/documents/preparedness/epidemiology-disease-control/environmental-health/residential-pool-safety-notice.pdf", "Open Arizona's pool safety notice (Department of Health Services, PDF)", "Abrir o aviso de seguran\u00e7a de piscina do Arizona (Department of Health Services, PDF)")],
    link_note: { en: "Open it, print it and hand it to the customer. Apex does not print or attach this notice.", pt: "Abra, imprima e entregue ao cliente. A Apex n\u00e3o imprime nem anexa este aviso." } } },
  AR: { "notice:AR-cancel": { links: [L("https://portal.arkansas.gov/service/arkansas-code-search-laws-and-statutes/", "Open Arkansas's official code search", "Abrir a busca oficial do c\u00f3digo do Arkansas")],
    link_note: { en: "Look up sections 4-89-107 and 4-89-108 there (the official code opens through LexisNexis).", pt: "Procure as se\u00e7\u00f5es 4-89-107 e 4-89-108 l\u00e1 (o c\u00f3digo oficial abre pela LexisNexis)." } } },
  GA: { "notice:GA-8-2-41": { links: [L("https://www.legis.ga.gov/api/legislation/document/20052006/64748", "Open Georgia's notice as passed in 2006 (O.C.G.A. 8-2-41, PDF)", "Abrir o aviso da Ge\u00f3rgia como aprovado em 2006 (O.C.G.A. 8-2-41, PDF)")],
      link_note: { en: "This is the text as first enacted; check that it was not amended since.", pt: "Este \u00e9 o texto como foi aprovado; confira se n\u00e3o mudou depois." } },
    "notice:GA-43-41-7": { links: [L("https://rules.sos.ga.gov/gac/553-7", "Open Georgia's written warranty rule (553-7-.01)", "Abrir a regra de garantia por escrito da Ge\u00f3rgia (553-7-.01)")] } },
  ID: { "notice:ID-disclosure": { links: [L("https://legislature.idaho.gov/statutesrules/idstat/title45/t45ch5/sect45-525/", "Open Idaho Code 45-525 (what the disclosure must say)", "Abrir o Idaho Code 45-525 (o que a declara\u00e7\u00e3o precisa dizer)")] },
    "notice:ID-cancel-credit": { links: [L("https://legislature.idaho.gov/wp-content/uploads/statutesrules/idstat/Title28/T28CH43.pdf", "Open Idaho's cancellation statement (Title 28 chapter 43, PDF; see 28-43-403)", "Abrir a declara\u00e7\u00e3o de cancelamento de Idaho (Title 28 chapter 43, PDF; veja 28-43-403)")] } },
  IN: { "notice:IN-cancel": { links: [L("https://iga.in.gov/ic/2026/Title_24.pdf", "Open Indiana Code Title 24 (PDF; see IC 24-5-10-9)", "Abrir o Indiana Code Title 24 (PDF; veja IC 24-5-10-9)")] } },
  MD: { "notice:MD-cancel": { links: [L("https://mgaleg.maryland.gov/mgawebsite/Laws/StatuteText?article=gcl&section=14-302", "Open Maryland's cancellation statement and form (Commercial Law 14-302)", "Abrir a declara\u00e7\u00e3o e o formul\u00e1rio de cancelamento de Maryland (Commercial Law 14-302)")],
      link_note: { en: "The form there says three business days; a home improvement contract must say five (seven at 65 or older).", pt: "O formul\u00e1rio l\u00e1 diz tr\u00eas dias \u00fateis; um contrato de reforma precisa dizer cinco (sete a partir dos 65 anos)." } },
    "notice:MD-oral-ack": { links: [L("https://mgaleg.maryland.gov/mgawebsite/Laws/StatuteText?article=gcl&section=14-302.1", "Open Maryland's acknowledgment wording (Commercial Law 14-302.1)", "Abrir o texto do recibo de Maryland (Commercial Law 14-302.1)")] } },
  ME: { "notice:ME-ag": { links: [L("https://www.maine.gov/ag/sites/maine.gov.ag/files/documents/Home%20Construction%20Contracts%20Addendum.docx", "Open the Attorney General's addendum (Word file)", "Abrir o adendo do Attorney General (arquivo Word)")] } },
  NJ: { "notice:NJ-division": { links: [L("https://www.njconsumeraffairs.gov/regulations/Chapter-45A-Administrative-Rules-of-the-Division-of-Consumer-Affairs.pdf", "Open New Jersey's rule with the statement (N.J.A.C. 13:45A-17.11, PDF)", "Abrir a regra de New Jersey com a declara\u00e7\u00e3o (N.J.A.C. 13:45A-17.11, PDF)")],
      link_note: { en: "The rule prints the number 1-888-656-6225. The Attorney General's pages give 800-242-5846; which one is current is not settled.", pt: "A regra imprime o n\u00famero 1-888-656-6225. As p\u00e1ginas do Attorney General d\u00e3o 800-242-5846; n\u00e3o est\u00e1 decidido qual vale hoje." } },
    "notice:NJ-cancel": { links: [L("https://pub.njleg.state.nj.us/Bills/2004/PL04/16_.HTM", "Open New Jersey's cancellation notice as passed in 2004 (N.J.S.A. 56:8-151)", "Abrir o aviso de cancelamento de New Jersey como aprovado em 2004 (N.J.S.A. 56:8-151)")],
      link_note: { en: "This is the text as first enacted; check that it was not amended since.", pt: "Este \u00e9 o texto como foi aprovado; confira se n\u00e3o mudou depois." } } },
  NM: { "notice:NM-default": { links: [L("https://www.rld.nm.gov/construction-industries/investigation-and-enforcement/", "Open the Construction Industries Division page", "Abrir a p\u00e1gina da Construction Industries Division"), L("https://www.rld.nm.gov/wp-content/uploads/2021/07/Article-13-CILA-7.1.21.pdf", "Open the law that requires the form (NMSA 60-13-19, PDF)", "Abrir a lei que exige o formul\u00e1rio (NMSA 60-13-19, PDF)")],
    link_note: { en: "The state does not publish this form online. Ask the Construction Industries Division.", pt: "O estado n\u00e3o publica este formul\u00e1rio na internet. Pe\u00e7a \u00e0 Construction Industries Division." } } },
  OK: { "notice:OK-cancel-credit": { links: [L("https://www.oklegislature.gov/OK_Statutes/CompleteTitles/os14A.pdf", "Open Oklahoma's cancellation statement (Title 14A, PDF; see section 2-503)", "Abrir a declara\u00e7\u00e3o de cancelamento de Oklahoma (Title 14A, PDF; veja a se\u00e7\u00e3o 2-503)")] } },
  RI: { "notice:RI-board": { also_links: [L("https://webserver.rilegislature.gov/Statutes/TITLE5/5-65/5-65-3.htm", "Open R.I. Gen. Laws 5-65-3 (what the contract must include)", "Abrir R.I. Gen. Laws 5-65-3 (o que o contrato precisa ter)")] } },
  TN: { "notice:TN-owner": { links: [TN_LINK], link_note: TN_NOTE("T.C.A. 62-6-508") }, "notice:TN-cancel": { links: [TN_LINK], link_note: TN_NOTE("T.C.A. 47-18-704") }, "notice:TN-lien": { links: [TN_LINK], link_note: TN_NOTE("T.C.A. 66-11-203") } },
  WA: { "notice:WA-lien-info": { links: [L("https://app.leg.wa.gov/RCW/default.aspx?cite=60.04.250", "Open RCW 60.04.250 (what the lien information must be)", "Abrir RCW 60.04.250 (o que a informa\u00e7\u00e3o de gravame precisa ser)")],
    link_note: { en: "The research did not find this document on the Department of Labor and Industries' site. Ask the Department of Labor and Industries for it.", pt: "A pesquisa n\u00e3o achou este documento no site do Department of Labor and Industries. Pe\u00e7a ao Department of Labor and Industries." } } }
};
Object.keys(LINKS).forEach(function (code) { FIN[code] = FIN[code] || {}; Object.keys(LINKS[code]).forEach(function (key) {
  var add = LINKS[code][key];
  (add.links || []).concat(add.also_links || []).forEach(function (k) { if (!/^https:\/\//.test(k.url) || !k.en || !k.pt) { throw new Error("LINKS: bad link on " + code + " " + key); } });
  FIN[code][key] = Object.assign(FIN[code][key] || {}, add);
}); });
Object.keys(HELD).forEach(function (code) { FIN[code] = FIN[code] || {}; Object.keys(HELD[code]).forEach(function (key) { FIN[code][key] = Object.assign(FIN[code][key] || {}, { held: HELD[code][key] }); }); });
Object.keys(FIN).forEach(function (code) {
  Object.keys(FIN[code]).forEach(function (key) {
    var row = S[code].lines[key], add = FIN[code][key];
    if (!row || row.c !== "A") { throw new Error("FIN: no action line " + code + " " + key); }
    delete row.needs;
    Object.keys(add).forEach(function (k) { row[k] = add[k]; });
    // Every blank named here must really be in the wording on file.
    (row.parts || []).forEach(function (p) {
      var n = notice(p.n), text = String(n.text_on_file || "");
      if (!text || n.source_status !== "VERBATIM-OFFICIAL" || n.hold_reason) { throw new Error("FIN: " + p.n + " is not an official verbatim copy on file"); }
      (p.fill || []).forEach(function (f) {
        var hit = f[2] === "re" ? new RegExp(f[0]).test(text) : text.indexOf(f[0]) !== -1;
        if (!hit) { throw new Error("FIN: blank not found in " + p.n + ": " + f[0]); }
      });
      (p.choose || []).forEach(function (c) { if (text.indexOf(c) === -1) { throw new Error("FIN: choice not found in " + p.n + ": " + c); } });
    });
    // An agency file shipped with the site must be there, byte for byte.
    if (row.official && row.official.file) {
      var bytes = readFileSync(new URL("../" + row.official.file, import.meta.url));
      if (createHash("sha256").update(bytes).digest("hex") !== row.official.sha256) { throw new Error("FIN: " + row.official.file + " is not the file that was fingerprinted"); }
    }
  });
});

Object.keys(FIXED).forEach(function (k) { generic[k] = FIXED[k]; });

var out = {
  version: 3,
  source: "Sorted by reading data/contract-state-riders-v1.json. Edit scripts/make-state-checklist-data.mjs, not this file.",
  note: "c: A = action (a line on the Before you send card), H = handled by the builder, B = background. A line with no entry is background. An action line with sys is done or seen by the system (sys_kinds says which); without sys it is ticked by a person. fact = the one-question fact the line depends on. No lawyer has reviewed this sorting.",
  sys_kinds: SYS,
  facts: FACTS,
  biz_facts: BIZ,
  ask: ASK,
  ref_fallback: { en: "details", pt: "detalhes" },
  generic: generic,
  states: S
};
writeFileSync(new URL("../data/contract-state-checklist-v1.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
console.log("states: " + Object.keys(S).length + " (Florida has none)");
