/**
 * commands/general/criador.js — "quem criou a Lua?" em resposta rica (GenAI).
 *
 * Envia via relayMessage um botForwardedMessage > richResponseMessage com as
 * seções serializadas em base64 (unifiedResponse.data). Essa estrutura existe no
 * proto desta biblioteca (WAProto/E2E/E2E.proto):
 *   Message.botForwardedMessage = 104  (FutureProofMessage { message = 1 })
 *   Message.richResponseMessage = 97   (AIRichResponseMessage)
 *     ├ submessages = 2   ├ unifiedResponse = 3 (bytes)   └ contextInfo = 4
 *   MessageContextInfo.botMetadata = 7 (messageDisclaimerText = 11)
 *
 * Os dados do criador vêm de utils/creatorProfile.js — editáveis em runtime por
 * !setcriador (banco), com os padrões do arquivo como fallback. O selo da
 * citação vem de utils/consts.js, escolhido por !selo (fixo ou aleatório).
 *
 * Se o servidor recusar o payload, o comando cai para uma mensagem de texto
 * normal — a informação chega de qualquer forma.
 */

'use strict';

const { seloNubank } = require('../../utils/consts.js');
const creatorProfile = require('../../utils/creatorProfile');
const CONFIG = require('../../config');
const { registry } = require('../../engine/plugins');
const { formatUptime } = require('../../utils/menuRenderer');
const logger = require('../../utils/logger').child('criador');

/** Como o bot é apresentado no cartão. Sempre "Lua Bot 🌙". */
const BOT_DISPLAY = `${(CONFIG.bot && CONFIG.bot.name) || 'Lua'} Bot 🌙`;

const TEXT = (text) => ({
  view_model: {
    primitive: { text, __typename: 'GenAIMetadataTextPrimitive' },
    __typename: 'GenAISingleLayoutViewModel',
  },
});

const IMAGE = (url) => ({
  view_model: {
    primitive: {
      media: { url, mime_type: 'image/jpeg' },
      imagine_type: 'IMAGE',
      status: { status: 'READY' },
      __typename: 'GenAIImaginePrimitive',
    },
    __typename: 'GenAISingleLayoutViewModel',
  },
});

const CARD = (card, supportUrl) => ({
  title: card.title,
  brand: card.brand,
  price: card.price || '',
  sale_price: card.salePrice || '',
  product_url: supportUrl,
  image: { url: card.image },
  __typename: 'GenAIProductItemCardPrimitive',
});

const HSCROLL = (primitives) => ({
  view_model: { primitives, __typename: 'GenAIHScrollLayoutViewModel' },
});

/** Cartões do botão — usam a foto configurada, sem outro lugar para editar. */
function cards(profile) {
  const image = profile.botPhotoUrl || profile.photoUrl;
  return [
    { title: BOT_DISPLAY, brand: 'bot de WhatsApp', price: 'R$ 0,00', salePrice: 'GRÁTIS', image },
    { title: 'Menu interativo', brand: 'botões e listas', price: 'R$ 0,00', salePrice: 'GRÁTIS', image },
    { title: 'Stickers & Downloads', brand: 'mídia de verdade', price: 'R$ 0,00', salePrice: 'GRÁTIS', image },
  ];
}

function nowPtBr() {
  try {
    return new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  } catch (_) {
    return new Date().toLocaleString('pt-BR');
  }
}

/** Dados reais do bot — nada de número inventado. */
function botFacts() {
  let count = 0;
  try {
    count = registry.count();
  } catch (_) {
    count = 0;
  }
  return {
    version: (CONFIG.bot && CONFIG.bot.version) || '1.0.0',
    uptime: formatUptime(process.uptime()),
    commands: count,
    node: process.version,
  };
}

/** Versão texto (fallback quando o richResponse não é aceito). */
function plainText(query, facts, profile) {
  return [
    `*${BOT_DISPLAY}* — informações do criador`,
    '',
    `🔍 *Pesquisa:* ${query}`,
    '',
    `👤 *Criador:* ${profile.name}`,
    `👨‍💻 *Desenvolvedor:* ${profile.developer}`,
    ...profile.about.map((a) => `▸ ${a}`),
    '',
    `🤖 *Bot:* ${BOT_DISPLAY} • v${facts.version} • ${facts.commands} comandos`,
    `⏱️ *Online há:* ${facts.uptime} • Node ${facts.node}`,
    `📅 ${nowPtBr()}`,
    '',
    `📸 Instagram: ${profile.instagramUrl}`,
    `🎵 TikTok: ${profile.tiktokUrl}`,
    `💬 Suporte: ${profile.supportUrl}`,
  ].join('\n');
}

module.exports = [
  {
    name: 'criador',
    commands: ['criador', 'criadordobot', 'creator', 'suporte-criador'],
    category: 'general',
    description:
      'Mostra quem criou o Lua Bot, com redes sociais, suporte, dados do bot e uma apresentação visual rica.',
    usage: '!criador [sua pergunta]',
    examples: ['!criador', '!criador quem criou a Lua?'],
    cooldown: 10000,
    execute: async (ctx) => {
      // reply primeiro: é o que o catch usa, então precisa estar pronto sempre
      const reply = (ctx && ctx.reply) || (async () => {});
      const facts = botFacts();
      const profile = creatorProfile.all();

      try {
        /* ---- nomes do seu código de referência, apontando para o ctx real ---- */
        const carol = ctx.socket; // conexão do WhatsApp
        const from = ctx.remoteJid; // jid do chat
        const msg = ctx.message; // mensagem recebida
        const args = Array.isArray(ctx.args) ? ctx.args : []; // nunca undefined
        const sender = ctx.sender;
        const pushname = (msg && msg.pushName) || '';

        const query = (args.join(' ') || '').trim() || 'informações do criador';

        const selo = await seloNubank(carol, msg, sender, pushname, from);

        const submessages = [
          { messageType: 2, messageText: `✨ *${BOT_DISPLAY}*` },
          { messageType: 2, messageText: `🔍 *Pesquisa:* ${query}` },
          { messageType: 2, messageText: `🤖 v${facts.version} • ${facts.commands} comandos` },
          { messageType: 2, messageText: `📅 ${nowPtBr()}` },
        ];

        const sections = [
          TEXT('① Abaixo está quem me criou'),
          IMAGE(profile.photoUrl),
          TEXT(
            [
              `*Sobre ${profile.name}:*`,
              `👨‍💻 Desenvolvedor: ${profile.developer}`,
              ...profile.about.map((a) => `▸ ${a}`),
              '',
              `🔎 Sua pergunta: “${query}”`,
            ].join('\n')
          ),
          TEXT(
            [
              `*Sobre ${BOT_DISPLAY}*`,
              `▸ Versão: ${facts.version}`,
              `▸ Comandos: ${facts.commands}`,
              `▸ Online há: ${facts.uptime}`,
              `▸ Node: ${facts.node}`,
            ].join('\n')
          ),
          TEXT('meus cartões 😌'),
          HSCROLL(cards(profile).map((c) => CARD(c, profile.supportUrl))),
          TEXT('📰 redes do criador'),
          HSCROLL([
            {
              title: `perfil de ${profile.name}`,
              subtitle: 'Instagram',
              username: profile.instagram,
              profile_picture_url: profile.photoUrl,
              is_verified: true,
              thumbnail_url: profile.botPhotoUrl,
              post_caption: `${profile.name} no Instagram`,
              likes_count: 0,
              comments_count: 0,
              shares_count: 0,
              post_url: profile.instagramUrl,
              source_app: 'INSTAGRAM',
              footer_label: 'IG',
              is_carousel: false,
              orientation: 'PORTRAIT',
              post_type: 'PHOTO',
              __typename: 'GenAIPostPrimitive',
            },
          ]),
          TEXT('🔗 links'),
          {
            view_model: {
              primitive: {
                text: 'TikTok do criador: {{IE_0}}Clique aqui{{/IE_0}}',
                inline_entities: [
                  {
                    key: 'IE_0',
                    metadata: {
                      display_name: profile.tiktok,
                      is_trusted: true,
                      url: profile.tiktokUrl,
                      __typename: 'GenAIInlineLinkItem',
                    },
                  },
                ],
                __typename: 'GenAIMarkdownTextUXPrimitive',
              },
              __typename: 'GenAISingleLayoutViewModel',
            },
          },
          {
            view_model: {
              primitive: {
                text: `💬 Suporte: {{IE_1}}falar com ${profile.name}{{/IE_1}}\n\n“${profile.quote}”`,
                inline_entities: [
                  {
                    key: 'IE_1',
                    metadata: {
                      display_name: 'Suporte',
                      is_trusted: true,
                      url: profile.supportUrl,
                      __typename: 'GenAIInlineLinkItem',
                    },
                  },
                ],
                __typename: 'GenAIMarkdownTextUXPrimitive',
              },
              __typename: 'GenAISingleLayoutViewModel',
            },
          },
        ];

        const richResponse = {
          messageContextInfo: {
            threadId: [],
            deviceListMetadata: { senderKeyIndexes: [], recipientKeyIndexes: [] },
            deviceListMetadataVersion: 2,
            botMetadata: {
              messageDisclaimerText: BOT_DISPLAY,
              richResponseSourcesMetadata: { sources: [] },
            },
          },
          botForwardedMessage: {
            message: {
              richResponseMessage: {
                submessages,
                messageType: 1,
                unifiedResponse: {
                  data: Buffer.from(
                    JSON.stringify({ response_id: `lua_${Date.now()}`, sections })
                  ).toString('base64'),
                },
                contextInfo: {
                  mentionedJid: [],
                  groupMentions: [],
                  forwardingScore: 999,
                  isForwarded: true,
                  forwardedAiBotMessageInfo: { botJid: 'lua@bot' },
                  forwardOrigin: 4,
                  stanzaId: selo.key && selo.key.id,
                  participant: selo.key && selo.key.participant,
                  quotedMessage: selo.message,
                },
              },
            },
          },
        };

        try {
          await carol.relayMessage(from, richResponse, {});
        } catch (relayErr) {
          // richResponse recusado pelo servidor: entrega em texto, sem perder a info
          logger.warn({ err: relayErr.message }, 'richResponse recusado — enviando em texto');
          await reply(plainText(query, facts, profile));
        }
      } catch (error) {
        logger.warn({ err: error.message }, 'falha ao montar o cartão do criador');
        await reply(
          `⚠️ Não consegui montar o cartão do criador (${error.message}).\n\n${plainText('informações do criador', facts, profile)}`
        );
      }
    },
  },
];
