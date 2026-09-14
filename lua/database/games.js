/**
 * database/games.js — estatísticas de jogos, quiz (perguntas e pontuação).
 */

'use strict';

const { prepare } = require('./database');

function recordGame(userId, game, result) {
  // result: 'win' | 'loss'
  prepare(
    'record_game',
    `INSERT INTO game_stats (user_id, game, plays, wins, losses) VALUES (?, ?, 1, ?, ?)
     ON CONFLICT(user_id, game) DO UPDATE SET
       plays = plays + 1,
       wins = wins + excluded.wins,
       losses = losses + excluded.losses`
  ).run(userId, game, result === 'win' ? 1 : 0, result === 'loss' ? 1 : 0);
}

function getGameRank(game, limit = 10) {
  return prepare(
    'rank_game',
    `SELECT user_id, plays, wins, losses FROM game_stats WHERE game = ? ORDER BY wins DESC, plays ASC LIMIT ?`
  ).all(game, limit);
}

function getQuizCategories() {
  return prepare('quiz_cats', `SELECT DISTINCT category FROM quiz_questions ORDER BY category`).all().map((r) => r.category);
}

function getQuizQuestions(category, limit = 5) {
  if (category) {
    return prepare(
      'quiz_q_cat',
      `SELECT * FROM quiz_questions WHERE category = ? ORDER BY RANDOM() LIMIT ?`
    ).all(category, limit);
  }
  return prepare('quiz_q_all', `SELECT * FROM quiz_questions ORDER BY RANDOM() LIMIT ?`).all(limit);
}

function countQuizQuestions(category) {
  if (category) {
    return prepare('quiz_count_cat', `SELECT COUNT(*) AS c FROM quiz_questions WHERE category = ?`).get(category).c;
  }
  return prepare('quiz_count_all', `SELECT COUNT(*) AS c FROM quiz_questions`).get().c;
}

function recordQuizScore(userId, category, correct, total) {
  prepare(
    'record_quiz',
    `INSERT INTO quiz_scores (user_id, category, correct, total) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, category) DO UPDATE SET
       correct = quiz_scores.correct + excluded.correct,
       total = quiz_scores.total + excluded.total`
  ).run(userId, category, correct, total);
}

function quizRank(category, limit = 10) {
  if (category) {
    return prepare(
      'quiz_rank_cat',
      `SELECT user_id, correct, total FROM quiz_scores WHERE category = ? ORDER BY correct DESC, total ASC LIMIT ?`
    ).all(category, limit);
  }
  return prepare(
    'quiz_rank_all',
    `SELECT user_id, SUM(correct) AS correct, SUM(total) AS total FROM quiz_scores GROUP BY user_id ORDER BY correct DESC LIMIT ?`
  ).all(limit);
}

module.exports = {
  recordGame,
  getGameRank,
  getQuizCategories,
  getQuizQuestions,
  countQuizQuestions,
  recordQuizScore,
  quizRank,
};
