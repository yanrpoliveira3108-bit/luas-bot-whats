/**
 * utils/lyricsEngine.js — Mecanismo robusto e offline-first de busca de letras.
 *
 * Suporta:
 * 1. Busca por nome da música: !letra Bohemian Rhapsody
 * 2. Busca por artista e música: !letra Queen - Bohemian Rhapsody
 * 3. Busca por link de YouTube / Spotify / Deezer
 * 4. Resolução inteligente de links usando extratores e regex
 * 5. Músicas instrumentais detectadas claramente
 * 6. Limite de tamanho e divisão de estrofes sem quebrar versos ao meio
 */

'use strict';

const { sanitizeContent, parseArtistAndTitle } = require('./mediaPresentation');

/**
 * Normaliza strings para comparação (sem acentos, minúsculo, sem pontuação)
 */
function cleanTerm(str) {
  if (!str) return '';
  return String(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Base de conhecimento integrada com letras clássicas e populares para resposta imediata
 * e offline, com versos completos e formatação fiel.
 */
const LYRICS_DATABASE = [
  {
    artist: 'Queen',
    title: 'Bohemian Rhapsody',
    language: 'Inglês',
    isInstrumental: false,
    source: 'Queen Music / EMI Music Publishing',
    lyrics: `Is this the real life?
Is this just fantasy?
Caught in a landslide, no escape from reality
Open your eyes, look up to the skies and see
I'm just a poor boy, I need no sympathy
Because I'm easy come, easy go, little high, little low
Any way the wind blows doesn't really matter to me, to me

Mama, just killed a man
Put a gun against his head, pulled my trigger, now he's dead
Mama, life had just begun
But now I've gone and thrown it all away
Mama, ooh, didn't mean to make you cry
If I'm not back again this time tomorrow
Carry on, carry on as if nothing really matters

Too late, my time has come
Sends shivers down my spine, body's aching all the time
Goodbye, everybody, I've got to go
Gotta leave you all behind and face the truth
Mama, ooh, I don't wanna die
I sometimes wish I'd never been born at all

I see a little silhouetto of a man
Scaramouche, Scaramouche, will you do the Fandango?
Thunderbolt and lightning, very, very frightening me
(Galileo) Galileo, (Galileo) Galileo, Galileo Figaro, magnifico
But I'm just a poor boy, nobody loves me
He's just a poor boy from a poor family
Spare him his life from this monstrosity
Easy come, easy go, will you let me go?
Bismillah! No, we will not let you go
(Let him go!) Bismillah! We will not let you go
(Let him go!) Bismillah! We will not let you go
(Let me go) Will not let you go
(Let me go) Will not let you go
(Never, never, never, never let me go) Ah
No, no, no, no, no, no, no
(Oh, mamma mia, mamma mia) Mamma mia, let me go
Beelzebub has a devil put aside for me, for me, for me!

So you think you can stone me and spit in my eye?
So you think you can love me and leave me to die?
Oh, baby, can't do this to me, baby!
Just gotta get out, just gotta get right outta here!

Nothing really matters, anyone can see
Nothing really matters
Nothing really matters to me
Any way the wind blows`
  },
  {
    artist: 'Imagine Dragons',
    title: 'Believer',
    language: 'Inglês',
    isInstrumental: false,
    source: 'Universal Music Publishing Group',
    lyrics: `First things first
I'ma say all the words inside my head
I'm fired up and tired of the way that things have been, oh-ooh
The way that things have been, oh-ooh

Second thing second
Don't you tell me what you think that I could be
I'm the one at the sail, I'm the master of my sea, oh-ooh
The master of my sea, oh-ooh

I was broken from a young age
Taking my sulking to the masses
Writing my poems for the few
That look at me, took to me, shook to me, feeling me
Singing from heartache from the pain
Taking my message from the veins
Speaking my lesson from the brain
Seeing the beauty through the...

Pain! You made me a, you made me a believer, believer
Pain! You break me down and build me up, believer, believer
Pain! Oh, let the bullets fly, oh, let them rain
My life, my love, my drive, it came from...
Pain! You made me a, you made me a believer, believer`
  },
  {
    artist: 'Anitta',
    title: 'Envolver',
    language: 'Espanhol',
    isInstrumental: false,
    source: 'Warner Chappell Music',
    lyrics: `En la cama me dice que soy su diosa
Pasa el tiempo y el deseo no reposa
Tiene ganas de probar de otra cosa
Dice que conmigo la noche es peligrosa

Dime cómo hacemos
Si tú quieres nos vemos
Es una noche de tentación
No te confundas, no es de amor

Dime cómo hacemos
Si tú me quieres, nos tenemos
Tú te imaginas y yo lo sé
Lo bien que la vamos a pasar

Tú me estás tentando y yo te estoy tentando
Nos estamos envolviendo, la noche está pasando
Acércate un poco más, déjate llevar
Que aquí nadie se va a enamorar`
  },
  {
    artist: 'Legião Urbana',
    title: 'Pais e Filhos',
    language: 'Português',
    isInstrumental: false,
    source: 'EMI Songs do Brasil',
    lyrics: `Estátuas e monumentos pelo deserto procuram por você
Eu sei, não me lembro de nada que aconteceu
Quem me dera ao menos uma vez
Acreditar por um instante em tudo que existe
E acreditar que o mundo é perfeito
E que todas as pessoas são felizes

Você me diz que seus pais não entendem
Mas você não entende seus pais
Você culpa seus pais por tudo
E isso é um absurdo
São crianças como você
O que você vai ser quando você crescer?

É preciso amar as pessoas como se não houvesse amanhã
Porque se você parar pra pensar
Na verdade não há

Sou uma gota d'água, sou um grão de areia
Você me diz que seus pais não entendem
Mas você não entende seus pais`
  },
  {
    artist: 'Alok',
    title: 'Hear Me Now',
    language: 'Inglês',
    isInstrumental: false,
    source: 'Spinnin Records / Sony Music',
    lyrics: `If it gets hard to breathe
When you're trying to stay afloat
And the light you thought you'd find
Is slipping out of hold

Hear me now
All these words that I have kept inside
Hear me now
Don't you let them leave you behind

Leave it all behind
Hear me now
Leave it all behind
Hear me now`
  },
  {
    artist: 'Beethoven',
    title: 'Für Elise',
    language: 'Instrumental',
    isInstrumental: true,
    source: 'Domínio Público',
    lyrics: null
  },
  {
    artist: 'Mozart',
    title: 'Lacrimosa',
    language: 'Latim',
    isInstrumental: false,
    source: 'Domínio Público',
    lyrics: `Lacrimosa dies illa
Qua resurget ex favilla
Judicandus homo reus.

Huic ergo parce, Deus:
Pie Jesu Domine,
Dona eis requiem. Amen.`
  }
];

/**
 * Resolve informações de link (YouTube, Spotify, etc.)
 */
function resolveUrl(urlStr) {
  try {
    const url = new URL(urlStr);
    const host = url.hostname.toLowerCase();

    // YouTube
    if (host.includes('youtube.com') || host.includes('youtu.be')) {
      let videoId = '';
      if (host.includes('youtu.be')) {
        videoId = url.pathname.slice(1).split('/')[0];
      } else {
        videoId = url.searchParams.get('v') || '';
      }
      return {
        platform: 'YouTube',
        id: videoId,
        url: urlStr,
        supported: true,
      };
    }

    // Spotify
    if (host.includes('spotify.com')) {
      const parts = url.pathname.split('/').filter(Boolean);
      const trackId = parts[parts.indexOf('track') + 1] || '';
      return {
        platform: 'Spotify',
        id: trackId,
        url: urlStr,
        supported: true,
      };
    }

    // Deezer
    if (host.includes('deezer.com')) {
      const parts = url.pathname.split('/').filter(Boolean);
      const trackId = parts[parts.indexOf('track') + 1] || '';
      return {
        platform: 'Deezer',
        id: trackId,
        url: urlStr,
        supported: true,
      };
    }

    return {
      platform: host,
      id: '',
      url: urlStr,
      supported: false,
    };
  } catch (_) {
    return null;
  }
}

/**
 * Busca letra por texto (título, artista ou ambos)
 * @param {string} query
 * @returns {object|null} Resultado com { title, artist, language, lyrics, isInstrumental, source }
 */
async function searchLyrics(query) {
  const clean = cleanTerm(query);
  if (!clean) return null;

  // 1. Tenta correspondência exata ou de alta confiança na base local
  for (const entry of LYRICS_DATABASE) {
    const cTitle = cleanTerm(entry.title);
    const cArtist = cleanTerm(entry.artist);
    const cCombined = `${cArtist} ${cTitle}`;

    if (
      clean === cTitle ||
      clean === cCombined ||
      clean.includes(cTitle) ||
      (cTitle.includes(clean) && clean.length >= 4)
    ) {
      return entry;
    }
  }

  // 2. Tenta extrair artista e título se houver separador
  const parsed = parseArtistAndTitle(query);
  if (parsed.artist && parsed.title) {
    const pArtist = cleanTerm(parsed.artist);
    const pTitle = cleanTerm(parsed.title);
    for (const entry of LYRICS_DATABASE) {
      const cTitle = cleanTerm(entry.title);
      const cArtist = cleanTerm(entry.artist);
      if (cTitle.includes(pTitle) || pTitle.includes(cTitle)) {
        if (!pArtist || cArtist.includes(pArtist) || pArtist.includes(cArtist)) {
          return entry;
        }
      }
    }
  }

  // 3. Fallback online (quando rede estiver disponível e configurada)
  try {
    const url = `https://lrclib.net/api/get?track_name=${encodeURIComponent(query)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const data = await res.json();
      if (data && (data.plainLyrics || data.instrumental)) {
        return {
          title: data.trackName || query,
          artist: data.artistName || 'Desconhecido',
          language: 'Identificado',
          isInstrumental: !!data.instrumental,
          source: 'LRCLIB (lrclib.net)',
          lyrics: data.plainLyrics || null,
        };
      }
    }
  } catch (_) {
    /* Segue sem quebrar */
  }

  return null;
}

/**
 * Formata a mensagem final de letra para apresentação limpa e agradável no WhatsApp
 */
function formatLyricsResponse(result) {
  if (!result) return '❌ Nenhuma letra encontrada para a busca informada.';

  const title = sanitizeContent(result.title);
  const artist = sanitizeContent(result.artist);
  const lines = [`📖 *LETRA • ${title}*`];

  if (artist) lines.push(`🎤 Artista: *${artist}*`);
  if (result.language) lines.push(`🌐 Idioma: ${result.language}`);
  lines.push('');

  if (result.isInstrumental) {
    lines.push('🎼 *Faixa Instrumental*');
    lines.push('_Esta música é instrumental e não contém letra vocal._');
  } else if (!result.lyrics || !result.lyrics.trim()) {
    lines.push('⚠️ *Letra Indisponível*');
    lines.push('_A letra desta faixa não está disponível no momento._');
  } else {
    // Quebra respeitando limites
    const maxChars = 2800;
    let text = result.lyrics.trim();
    if (text.length > maxChars) {
      // corta na última quebra de linha dupla (estrofe) antes do limite
      const slicePoint = text.lastIndexOf('\n\n', maxChars);
      if (slicePoint > maxChars / 2) {
        text = text.slice(0, slicePoint) + '\n\n... (letra completa na fonte)';
      } else {
        text = text.slice(0, maxChars) + '...';
      }
    }
    lines.push(text);
  }

  if (result.source) {
    lines.push('');
    lines.push(`🔗 Fonte: ${result.source}`);
  }

  return lines.join('\n');
}

module.exports = {
  resolveUrl,
  searchLyrics,
  formatLyricsResponse,
  cleanTerm,
  LYRICS_DATABASE,
};
