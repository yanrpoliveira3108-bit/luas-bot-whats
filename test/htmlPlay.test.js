'use strict';
const assert=require('assert');const {normalizeMediaInfo,buildHtmlPlay}=require('../utils/htmlPlay');
const info=normalizeMediaInfo({title:'<Música>',author:'Artista & Canal',url:'https://www.youtube.com/watch?v=x',duration:'03:42',views:0,mimetype:'audio/mp4'},{kind:'audio'});
const html=buildHtmlPlay({...info,thumbnail:''},',',{audio:'ytmp3',lyrics:'letra',search:'play'});
assert.ok(html.includes('&lt;Música&gt;'));assert.ok(html.includes(',ytmp3 https://www.youtube.com/watch?v=x'));assert.ok(html.includes(',letra &lt;Música&gt;'));assert.ok(!html.includes('ytmp4'));assert.ok(!html.includes('fetch('));assert.ok(!html.includes('localStorage'));assert.ok(html.includes('navigator.clipboard'));assert.ok(html.includes('execCommand'));assert.ok(html.includes('Visualizações'));assert.strictEqual(info.views,'0');console.log('✅ HTML PLAY: normalização, escape, comandos reais e cópia local');
