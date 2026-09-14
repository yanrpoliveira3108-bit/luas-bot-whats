/**
 * database/seed/quiz.js — banco local de perguntas do quiz.
 *
 * Categorias: anime, games, programação, filmes, conhecimentos gerais, tecnologia.
 * options: array de 4 strings. answerIndex: índice da correta.
 */

'use strict';

module.exports = [
  // ------------------------------ anime ------------------------------
  { category: 'anime', question: 'Quem é o protagonista de Naruto?', options: ['Sasuke Uchiha', 'Naruto Uzumaki', 'Kakashi Hatake', 'Madara Uchiha'], answerIndex: 1 },
  { category: 'anime', question: 'Qual é o nome do pirata de borracha em One Piece?', options: ['Zoro', 'Sanji', 'Luffy', 'Ace'], answerIndex: 2 },
  { category: 'anime', question: 'Em Dragon Ball, qual o nome da transformação de cabelo amarelo do Goku?', options: ['Kaioken', 'Super Saiyajin', 'Ultra Instinto', 'Fusão'], answerIndex: 1 },
  { category: 'anime', question: 'Qual anime tem os personagens Eren, Mikasa e Armin?', options: ['Tokyo Ghoul', 'Attack on Titan', 'Death Note', 'Bleach'], answerIndex: 1 },
  { category: 'anime', question: 'Quem escreve nomes em um caderno para matar pessoas?', options: ['L', 'Light Yagami', 'Near', 'Misa Amane'], answerIndex: 1 },
  { category: 'anime', question: 'Qual é o nome do caçador de demônios protagonista de Demon Slayer?', options: ['Tanjiro Kamado', 'Zenitsu', 'Inosuke', 'Giyu Tomioka'], answerIndex: 0 },

  // ------------------------------ games ------------------------------
  { category: 'games', question: 'Qual encanador é o mascote mais famoso da Nintendo?', options: ['Sonic', 'Mario', 'Link', 'Kirby'], answerIndex: 1 },
  { category: 'games', question: 'Em Minecraft, qual bloco é essencial para criar ferramentas?', options: ['Madeira', 'Areia', 'Pedregulho', 'Vidro'], answerIndex: 0 },
  { category: 'games', question: 'Qual jogo popularizou o gênero battle royale?', options: ['Fortnite', 'PUBG', 'Free Fire', 'Todos ajudaram'], answerIndex: 3 },
  { category: 'games', question: 'Quem é o protagonista da série The Legend of Zelda?', options: ['Zelda', 'Link', 'Ganondorf', 'Impa'], answerIndex: 1 },
  { category: 'games', question: 'Qual destes é um Pokémon do tipo elétrico?', options: ['Charmander', 'Squirtle', 'Pikachu', 'Bulbasaur'], answerIndex: 2 },

  // --------------------------- programação ---------------------------
  { category: 'programação', question: 'Qual linguagem roda nativamente no navegador?', options: ['Python', 'JavaScript', 'Java', 'C#'], answerIndex: 1 },
  { category: 'programação', question: 'O que significa HTML?', options: ['HyperText Markup Language', 'HighText Machine Language', 'Home Tool Markup Language', 'Hyperlink Text Manager'], answerIndex: 0 },
  { category: 'programação', question: 'Qual comando Git salva alterações no repositório local?', options: ['git push', 'git pull', 'git commit', 'git clone'], answerIndex: 2 },
  { category: 'programação', question: 'Qual símbolo inicia um comentário de linha em JavaScript?', options: ['//', '<!--', '#', '**'], answerIndex: 0 },
  { category: 'programação', question: 'Qual banco de dados é o mais usado em aplicações web com MySQL?', options: ['SQLite', 'MongoDB', 'MySQL', 'Redis'], answerIndex: 2 },

  // ------------------------------ filmes -----------------------------
  { category: 'filmes', question: 'Quem dirigiu "Jurassic Park"?', options: ['Steven Spielberg', 'James Cameron', 'Christopher Nolan', 'Ridley Scott'], answerIndex: 0 },
  { category: 'filmes', question: 'Em "O Rei Leão", como se chama o pai de Simba?', options: ['Scar', 'Mufasa', 'Timão', 'Pumba'], answerIndex: 1 },
  { category: 'filmes', question: 'Qual ator interpretou o Coringa em "Batman: O Cavaleiro das Trevas"?', options: ['Jared Leto', 'Jack Nicholson', 'Heath Ledger', 'Joaquin Phoenix'], answerIndex: 2 },
  { category: 'filmes', question: 'Qual filme venceu o Oscar de Melhor Filme em 2024?', options: ['Barbie', 'Oppenheimer', 'Pobres Criaturas', 'Zona de Interesse'], answerIndex: 1 },
  { category: 'filmes', question: 'Em "Matrix", qual pílula Neo escolhe?', options: ['Azul', 'Vermelha', 'Verde', 'Amarela'], answerIndex: 1 },

  // ------------------------ conhecimentos gerais ---------------------
  { category: 'conhecimentos gerais', question: 'Qual é a capital do Brasil?', options: ['Rio de Janeiro', 'São Paulo', 'Brasília', 'Salvador'], answerIndex: 2 },
  { category: 'conhecimentos gerais', question: 'Quantos estados tem o Brasil?', options: ['25', '26', '27', '24'], answerIndex: 2 },
  { category: 'conhecimentos gerais', question: 'Qual é o maior planeta do Sistema Solar?', options: ['Terra', 'Júpiter', 'Saturno', 'Netuno'], answerIndex: 1 },
  { category: 'conhecimentos gerais', question: 'Quem pintou a Mona Lisa?', options: ['Leonardo da Vinci', 'Michelangelo', 'Van Gogh', 'Picasso'], answerIndex: 0 },
  { category: 'conhecimentos gerais', question: 'Qual é o rio mais extenso do mundo?', options: ['Amazonas', 'Nilo', 'Mississipi', 'Yangtzé'], answerIndex: 0 },

  // ----------------------------- tecnologia --------------------------
  { category: 'tecnologia', question: 'O que significa a sigla IA?', options: ['Inteligência Artificial', 'Internet Avançada', 'Informação Automática', 'Instalação Ativa'], answerIndex: 0 },
  { category: 'tecnologia', question: 'Qual empresa criou o sistema Android?', options: ['Apple', 'Microsoft', 'Google', 'Samsung'], answerIndex: 2 },
  { category: 'tecnologia', question: 'O que é um SSD?', options: ['Tipo de memória rápida', 'Placa de vídeo', 'Processador', 'Cooler'], answerIndex: 0 },
  { category: 'tecnologia', question: 'Qual destas é uma criptomoeda?', options: ['Dólar', 'Bitcoin', 'Euro', 'Real'], answerIndex: 1 },
  { category: 'tecnologia', question: 'O que significa "bug" em software?', options: ['Um erro no código', 'Um vírus', 'Uma atualização', 'Um atalho'], answerIndex: 0 },
];
