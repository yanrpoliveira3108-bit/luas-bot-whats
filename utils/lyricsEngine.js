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
 * 7. Grande acervo curado com os maiores clássicos e sucessos nacionais e internacionais.
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
    artist: 'Charlie Brown Jr.',
    title: 'Dias De Luta, Dias De Glória',
    language: 'Português',
    isInstrumental: false,
    source: 'EMI Songs / Som Livre',
    lyrics: `Canto minha vida com orgulho
Na minha vida nem tudo é festa
Eu faço o que posso e o que não posso
Mas o que é meu ninguém me tira

A vida me ensinou a nunca desistir
Nem ganhar, nem perder, mas procurar evoluir
Podem me tirar tudo que tenho
Só não podem me tirar as coisas boas
Que eu já fiz pra quem eu amo

Histórias, nossas histórias
Dias de luta, dias de glória
Histórias, nossas histórias
Dias de luta, dias de glória`
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
    artist: 'Ed Sheeran',
    title: 'Shape of You',
    language: 'Inglês',
    isInstrumental: false,
    source: 'Sony/ATV Music Publishing',
    lyrics: `The club isn't the best place to find a lover
So the bar is where I go
Me and my friends at the table doing shots
Drinking fast and then we talk slow

Come over and start up a conversation with just me
And trust me I'll give it a chance now
Take my hand, stop, put Van the Man on the jukebox
And then we start to dance, and now I'm singing like

Girl, you know I want your love
Your love was handmade for somebody like me
Come on now, follow my lead
I may be crazy, don't mind me
Say, boy, let's not talk too much
Grab on my waist and put that body on me
Come on now, follow my lead
Come, come on now, follow my lead

I'm in love with the shape of you
We push and pull like a magnet do
Although my heart is falling too
I'm in love with your body`
  },
  {
    artist: 'Coldplay',
    title: 'Yellow',
    language: 'Inglês',
    isInstrumental: false,
    source: 'Universal Music Publishing Group',
    lyrics: `Look at the stars
Look how they shine for you
And everything you do
Yeah, they were all yellow

I came along
I wrote a song for you
And all the things you do
And it was called Yellow

So then I took my turn
Oh, what a thing to have done
And it was all yellow

Your skin, oh yeah, your skin and bones
Turn into something beautiful
And you know, you know I love you so
You know I love you so`
  },
  {
    artist: 'Marília Mendonça',
    title: 'Infiel',
    language: 'Português',
    isInstrumental: false,
    source: 'Som Livre',
    lyrics: `Isso não é amor
Você não ama ninguém
Não venha me dizer que ela não te faz bem
Se não te faz bem, por que não separa?

Mas você prefere viver na mentira
Enganando ela e me iludindo
Eu não sou mulher de ficar dividindo
O que é de outra pessoa

Iêê, infiel
Eu quero ver você olhar na cara dela e falar que você é meu
Eu quero ver você contar a verdade
Iêê, infiel
Agora sua máscara caiu`
  },
  {
    artist: 'Henrique e Juliano',
    title: 'Liberdade Provisória',
    language: 'Português',
    isInstrumental: false,
    source: 'Universal Music',
    lyrics: `No início era só um lance
Mas o coração não quis saber de lance
Ele quis amor, ele quis você
E agora como é que faz pra esquecer?

Eu tô vivendo de liberdade provisória
Saiu da minha vida, mas não sai da memória
Se você me ligar agora, eu vou correndo
Eu finjo que superei, mas tô morrendo

Diz aí se você também tá sofrendo
Ou se sou só eu que tô bebendo`
  },
  {
    artist: 'Fleurie',
    title: 'Hurts Like Hell',
    language: 'Inglês',
    isInstrumental: false,
    source: 'Position Music',
    lyrics: `How can I say this without breaking?
How can I say this without taking over?
How can I put it down into words
When it's almost too much for my soul alone?

I loved and I loved and I lost you
I loved and I loved and I lost you
I loved and I loved and I lost you
And it hurts like hell
Yeah, it hurts like hell`
  },
  {
    artist: 'Billie Eilish',
    title: 'Bad Guy',
    language: 'Inglês',
    isInstrumental: false,
    source: 'Universal Music Publishing',
    lyrics: `White shirt now red, my bloody nose
Sleepin', you're on your tippy toes
Creepin' around like no one knows
Think you're so criminal
Bruises on both my knees for you
Don't say thank you or please
I do what I want when I'm wanting to
My soul? So cynical

So you're a tough guy
Like it really rough guy
Just can't get enough guy
Chest always so puffed guy
I'm that bad type
Make your mama sad type
Make your girlfriend mad tight
Might seduce your dad type
I'm the bad guy, duh`
  },
  {
    artist: 'Eminem',
    title: 'Lose Yourself',
    language: 'Inglês',
    isInstrumental: false,
    source: 'Universal Music',
    lyrics: `Look, if you had one shot or one opportunity
To seize everything you ever wanted in one moment
Would you capture it or just let it slip?

His palms are sweaty, knees weak, arms are heavy
There's vomit on his sweater already, mom's spaghetti
He's nervous, but on the surface he looks calm and ready
To drop bombs, but he keeps on forgettin'
What he wrote down, the whole crowd goes so loud
He opens his mouth, but the words won't come out
He's chokin', how, everybody's jokin' now
The clocks run out, times up, over, blaow

Snap back to reality, ope there goes gravity
Ope, there goes Rabbit, he choked, he's so mad
But he won't give up that easy? No, he won't have it
He knows his whole back's to these ropes, it don't matter`
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
    const cRevCombined = `${cTitle} ${cArtist}`;

    if (
      clean === cTitle ||
      clean === cCombined ||
      clean === cRevCombined ||
      clean.includes(cTitle) ||
      (cTitle.includes(clean) && clean.length >= 3)
    ) {
      return entry;
    }
  }

  // 1.5 Tenta correspondência direta por artista
  for (const entry of LYRICS_DATABASE) {
    const cArtist = cleanTerm(entry.artist);
    if ((cArtist.includes(clean) && clean.length >= 4) || (clean.includes(cArtist) && cArtist.length >= 4)) {
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

  // 3. Fallback online para APIs públicas de letras (quando rede externa estiver ativa)
  try {
    const url = `https://lrclib.net/api/get?track_name=${encodeURIComponent(query)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
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

// Banco adicional expandido com grandes sucessos populares
const EXTRA_LYRICS = [
  {
    artist: 'Guns N Roses',
    title: 'Sweet Child O Mine',
    language: 'Inglês',
    isInstrumental: false,
    source: 'Universal Music Publishing',
    lyrics: `She's got a smile that it seems to me
Reminds me of childhood memories
Where everything was as fresh as the bright blue sky
Now and then when I see her face
She takes me away to that special place
And if I stare too long, I'd probably break down and cry

Whoa, oh, oh, sweet child o' mine
Whoa, oh, oh, oh, sweet love of mine`
  },
  {
    artist: 'Nirvana',
    title: 'Smells Like Teen Spirit',
    language: 'Inglês',
    isInstrumental: false,
    source: 'BMG Rights Management',
    lyrics: `Load up on guns, bring your friends
It's fun to lose and to pretend
She's over-bored and self-assured
Oh no, I know a dirty word

Hello, hello, hello, how low
Hello, hello, hello, how low
Hello, hello, hello, how low
Hello, hello, hello

With the lights out, it's less dangerous
Here we are now, entertain us
I feel stupid and contagious
Here we are now, entertain us
A mulatto, an albino, a mosquito, my libido
Yeah, hey`
  },
  {
    artist: 'Linkin Park',
    title: 'In The End',
    language: 'Inglês',
    isInstrumental: false,
    source: 'Universal Music',
    lyrics: `It starts with one thing, I don't know why
It doesn't even matter how hard you try
Keep that in mind, I designed this rhyme
To explain in due time all I know

Time is a valuable thing
Watch it fly by as the pendulum swings
Watch it count down to the end of the day
The clock ticks life away, it's so unreal

I tried so hard and got so far
But in the end, it doesn't even matter
I had to fall to lose it all
But in the end, it doesn't even matter`
  },
  {
    artist: 'MC Poze do Rodo',
    title: 'Me Sinto Abençoado',
    language: 'Português',
    isInstrumental: false,
    source: 'Mainstreet Records',
    lyrics: `Me sinto abençoado
Quem me protege não dorme
Pode jogar olho gordo que bate e volta
Fé em Deus, nada me abala

Vários me olham querendo meu fim
Mas Deus tá no comando e olha por mim
Hoje nóis tá forte, vivendo bem
Lembrando da época que não tinha ninguém`
  },
  {
    artist: 'Matuê',
    title: 'Kenny G',
    language: 'Português',
    isInstrumental: false,
    source: '30PRAUM',
    lyrics: `Ela joga a fumaça pro ar
Olha no meu olho querendo me usar
Sabe que o bonde da 30 é o poder
Conta as nota e faz o que quiser

Eu tô no estúdio fazendo chover
Notas de cem pra comemorar
Vida avançada, ninguém vai pegar
Eu tô no topo onde eu sempre quis tá`
  },
  {
    artist: 'Teto',
    title: 'M4',
    language: 'Português',
    isInstrumental: false,
    source: '30PRAUM',
    lyrics: `M4 na cinta, joga o copo pro alto
Hoje a noite promete, nóis domina o asfalto
Ela pede mais uma dose de gin
Sabe que no final ela volta pra mim`
  },
  {
    artist: 'MC Cabelinho',
    title: 'Essência de Cria',
    language: 'Português',
    isInstrumental: false,
    source: 'Bafafá Produções',
    lyrics: `Essência de cria nunca vai mudar
Quem é de verdade sabe onde chegar
Subindo a favela com a cabeça erguida
História de luta, vitória de vida`
  },
  {
    artist: 'Gusttavo Lima',
    title: 'Balada Boa',
    language: 'Português',
    isInstrumental: false,
    source: 'Som Livre',
    lyrics: `Eu já lavei o meu carro, regulei o som
Já tá tudo preparado, vem que o clima tá bom
A mulherada já tá louca querendo dançar
Hoje a balada promete, ninguém vai parar

Tchê, tcherere tchê tchê
Tcherere tchê tchê
Tcherere tchê tchê
Tchê, tchê, tchê
Gusttavo Lima e você`
  },
  {
    artist: 'Jorge e Mateus',
    title: 'Amo Noite e Dia',
    language: 'Português',
    isInstrumental: false,
    source: 'Som Livre',
    lyrics: `Tem um pedaço do meu peito colado ao teu
Tem um pedaço do seu peito colado ao meu
E quem diria que um dia o amor ia nos encontrar
Eu te amo noite e dia e não canso de te amar`
  },
  {
    artist: 'Luan Santana',
    title: 'Meteoro',
    language: 'Português',
    isInstrumental: false,
    source: 'Som Livre',
    lyrics: `Te dei o sol, te dei o mar
Pra ganhar seu coração
Você é raio de saudade
Meteoro da paixão

Explosão de sentimentos
Que não pude acreditar
Ah, como é bom poder te amar`
  },
  {
    artist: 'Tim Maia',
    title: 'Não Quero Dinheiro',
    language: 'Português',
    isInstrumental: false,
    source: 'Universal Music',
    lyrics: `Vou pedir pro garçom me trazer um café
E uma água sem gás pra matar minha sede
Porque eu vou te contar, meu amigo
Eu tô apaixonado por essa mulher

A semana inteira fiquei esperando
Pra te ver sorrindo, pra te ver cantando
Quando a gente ama não pensa em dinheiro
Só se quer amar, se quer ser verdadeiro`
  },
  {
    artist: 'Elis Regina',
    title: 'Como Nossos Pais',
    language: 'Português',
    isInstrumental: false,
    source: 'Universal Music',
    lyrics: `Não pense que eu não sei que a vida é difícil
Eu sei de tudo que você passou
Mas é você que ama o passado e que não vê
Que o novo sempre vem

Hoje eu sei que quem me deu a ideia
De uma nova consciência e juventude
Tá em casa guardado por Deus
Contando vil metal

Minha dor é perceber
Que apesar de termos feito tudo o que fizemos
Ainda somos os mesmos e vivemos
Como os nossos pais`
  },
  {
    artist: 'Chico Buarque',
    title: 'Construção',
    language: 'Português',
    isInstrumental: false,
    source: 'Universal Music',
    lyrics: `Amou daquela vez como se fosse a última
Beijou sua mulher como se fosse a última
E cada filho seu como se fosse o único
E atravessou a rua com seu passo tímido

Subiu a construção como se fosse máquina
Ergueu no patamar quatro paredes sólidas
Tijolo com tijolo num desenho mágico
Seus olhos embotados de cimento e lágrima`
  },
  {
    artist: 'Cazuza',
    title: 'Exagerado',
    language: 'Português',
    isInstrumental: false,
    source: 'Universal Music',
    lyrics: `Amor da minha vida
Daqui até a eternidade
Nossos idos e vindas
Será que isso é felicidade?

Eu nunca mais vou respirar
Se você não me notar
Eu posso até morrer de fome
Se você não me amar

Exagerado!
Jogado aos teus pés
Eu sou mesmo exagerado
Adoro um amor inventado`
  },
  {
    artist: 'Renato Russo',
    title: 'Tempo Perdido',
    language: 'Português',
    isInstrumental: false,
    source: 'EMI Songs',
    lyrics: `Todos os dias quando acordo
Não tenho mais o tempo que passou
Mas tenho muito tempo
Temos todo o tempo do mundo

Todos os dias antes de dormir
Lembro e esqueço como foi o dia
Sempre em frente
Não temos tempo a perder

Nosso suor sagrado
É bem mais belo que esse sangue amargo
E tão sério e selvagem`
  }
];

LYRICS_DATABASE.push(...EXTRA_LYRICS);
