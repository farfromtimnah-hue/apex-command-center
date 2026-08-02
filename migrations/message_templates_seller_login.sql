-- seller_login WhatsApp template (2026-08-02).
--
-- A NEW key rather than a reuse of client_login, because the two messages are
-- addressed to different situations and must be editable independently in
-- settings.html.
--
-- WHO READS THIS MESSAGE: the BUSINESS OWNER, not the salesperson. Rafa does
-- not work for these companies and has no relationship with their employees --
-- the owner requested the seat and the owner hands the credentials to their
-- own staff. No salesperson phone number is captured anywhere in this feature;
-- the request is name-only, and the WhatsApp number used is the client's own
-- (clientData.whatsapp/phone), exactly as the client_login send does.
--
-- The wording therefore reads as a HANDOFF to the owner: it names which
-- salesperson the credentials are for, tells the owner to pass them on, and
-- states the access limit up front so the owner knows exactly what they are
-- granting. It is deliberately NOT written as if the salesperson is reading it.
--
-- PT only. WhatsApp messages to clients are Portuguese only -- the same rule
-- every other template here follows.
--
-- Placeholders match the client_login set ({loginUrl}, {username},
-- {tempPassword}) plus {sellerName}, so client.html can reuse the same
-- token-replacement code.

INSERT OR IGNORE INTO message_templates (template_key, template_text, updated_at, updated_by) VALUES
  ('seller_login', 'Olá! O acesso de vendedor para {sellerName} está pronto.

Repasse estes dados para {sellerName}:

Link: {loginUrl}
Usuário: {username}
Senha temporária: {tempPassword}

No primeiro acesso ele(a) vai criar uma senha nova.

Importante: {sellerName} verá apenas os leads do funil que ele(a) criar ou que estiverem no nome dele(a). Não terá acesso ao restante do portal (metas, financeiro, obras, documentos) nem aos leads dos outros vendedores.', '2026-08-02', 'seed');
