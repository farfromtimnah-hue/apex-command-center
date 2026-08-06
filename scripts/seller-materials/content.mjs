// Source text for the JM Luxury Pools seller materials PDFs.
//
// THIS IS THE CLIENT'S OWN SALES LANGUAGE AND IS REPRODUCED VERBATIM.
// Do not translate, rewrite, "fix" a typo, normalise punctuation or drop an
// emoji. "Topas" (twice) and the informal register are the client's voice, and
// a rep reading these out loud should sound like the person who wrote them.
// Line breaks inside each message are content: they are how the message gets
// pasted into WhatsApp.
//
// Kept in its own module so the exact strings can be diffed and audited
// independently of the layout code that consumes them.

// The three openers are ONE announcement in three registers. A rep picks by how
// well they know the person, so each carries a `pick` line saying when to use
// it rather than leaving the choice to guesswork.
export const APPROACH_MESSAGES = [
    {
        n: "01",
        channel: "WhatsApp",
        title: "Despertando Curiosidade",
        pick: "Para quem você conhece pouco — o mais completo e formal.",
        body: `Oi [NOME]! Tudo bem com você e com a família? 😊

Queria te contar uma novidade: estou agora fazendo parte do time de uma das maiores empresas de piscinas de Tampa Bay! Estou muito animado com essa oportunidade.

Eles trabalham com projetos incríveis, material de primeira qualidade e ainda têm financiamento disponível — o que torna o sonho de ter uma piscina muito mais acessível do que a maioria das pessoas imagina.

Pensei em você porque sei que você tem uma casa linda aí. Posso te fazer um estimate completamente gratuito, sem nenhum compromisso, só para você ter uma ideia de como ficaria e quanto custaria.

Topas marcar um dia para eu passar aí? 🙏🌊`
    },
    {
        n: "02",
        channel: "WhatsApp",
        title: "Família & Memórias",
        pick: "Para quem tem filhos ou recebe muita gente em casa.",
        body: `Oi [NOME]! Espero que você e a família estejam ótimos! 🙌

Queria compartilhar uma novidade contigo: estou no time de uma das maiores empresas de piscinas aqui em Tampa Bay!

Sabe aquela ideia de ter os filhos crescendo com uma piscina em casa, receber os amigos nos finais de semana, aproveitar o verão da Florida do jeito certo? Isso é exatamente o que a gente constrói para as famílias aqui na região.

E o melhor: a empresa financia! Então não precisa ser à vista para realizar esse sonho.

Posso passar aí para um estimate gratuito e te mostrar as possibilidades? Não tem nenhum compromisso — só boa conversa! 😊🌊`
    },
    {
        n: "03",
        channel: "WhatsApp",
        title: "Direta / Intimidade",
        pick: "Para amigos e família — curta e informal.",
        body: `Oi [NOME]! 🙌

Acabei de entrar no time de uma das maiores empresas de piscinas de Tampa Bay e queria te dar um toque!

Você tem casa própria com quintal e eu faço estimate grátis. Financia, parcela e o projeto fica incrível.

Topas uma visitinha? Me fala que eu apareço! 🌊😄`
    }
];

export const INSTAGRAM_POST = {
    title: "Anúncio de Chegada",
    channel: "Post Instagram",
    body: `🌊 Grande novidade!

Estou muito animado em compartilhar que estou agora fazendo parte do time de uma das maiores empresas de piscinas de Tampa Bay!

🏊 Projetos incríveis, materiais premium e financiamento disponível para tornar esse sonho realidade.

Se você sempre sonhou em ter uma piscina em casa — para criar memórias com a família, receber os amigos e aproveitar o verão da Florida da melhor forma — agora é a hora.

✅ Fazemos o projeto completo
✅ Financiamento disponível
✅ Estimate 100% gratuito

Me chama no privado ou comenta aqui embaixo. Vou adorar conversar contigo! 🌟

#TampaBayPools #PiscinaEmCasa #TampaBay #MemóriasDeFamília #Piscina #Florida`
};

export const OBJECTIONS = [
    {
        n: "01",
        objection: "Não tenho dinheiro agora",
        response: "Entendo! Por isso a empresa tem financiamento acessível. Posso mostrar as opções de parcela? Um estimate gratuito não custa nada e você sai sabendo exatamente quanto ficaria por mês."
    },
    {
        n: "02",
        objection: "Quintal pequeno",
        response: "Você ficaria surpreso! Temos projetos para todos os tamanhos de espaço. Me deixa passar aí pra ver — às vezes um espaço menor do que você imagina já é suficiente para uma piscina bonita."
    },
    {
        n: "03",
        objection: "Agora não é o momento",
        response: "Sem problema! O estimate é totalmente gratuito e sem compromisso. Você fica com o projeto na mão para quando o momento chegar. E às vezes ver o projeto muda o timing!"
    },
    {
        n: "04",
        objection: "Vou pensar...",
        response: "Claro! Mas me deixa pelo menos passar aí para você ver o projeto. Às vezes ver as possibilidades reais da sua casa muda tudo. Que dia da semana que funciona melhor pra você?"
    }
];

export const CADENCE = [
    { day: "DIA 01", text: "Agradecer pela visita/conversa e reforçar o entusiasmo com o projeto apresentado" },
    { day: "DIA 03", text: "Enviar conteúdo de valor - fotos de projeto similar, vídeo de depoimento de cliente" },
    { day: "DIA 07", text: "Perguntar sobre dúvidas específicas da proposta e oferecer esclarecimento" },
    { day: "DIA 14", text: "Apresentar urgência real - condições, disponibilidade de obra, sazonalidade" },
    { day: "DIA 21", text: "Reforçar com prova social - caso de sucesso recente, depoimento em vídeo" },
    { day: "DIA 30", text: "Última chamada direta: perguntar objetivamente se o cliente seguirá ou não com o projeto" }
];
