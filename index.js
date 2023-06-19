const fs = require('fs');
const kuromoji = require('kuromoji');
const JishoAPI = require('unofficial-jisho-api');
const GoogleTranslate = require('google-translate-api-x');

const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const INPUT_PATH = './input/input.txt';

const WAIT_TIME = 1000;

const jisho = new JishoAPI();

// Filter out particles, symbols, auxiliary verbs
const FILTERED_WORD_TYPES = ['助詞', '記号', '助動詞'];
// const TYPE_DICTIONARY = {
//   副詞: 'Adverb',
//   名詞: 'Noun',
//   動詞: 'Verb',
//   形容詞: 'Adjective'
// };

// Wrapper for builing kuromoji tokenizer
function buildTokenizer() {
  return new Promise((resolve, reject) => {
    kuromoji.builder({ dicPath: './node_modules/kuromoji/dict/' }).build((err, tokenizer) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(tokenizer);
    });
  });
}

// Async wrapper for Jisho api search
async function searchForPhraseAsync(phrase) {
  try {
    const result = await jisho.searchForPhrase(phrase);
    await new Promise(resolve => setTimeout(resolve, WAIT_TIME));
    return result;
  } catch (error) {
    console.error(error);
  }
}

// Translate text using google translate api
async function translateText(text) {
  try {
    const result = await GoogleTranslate(text, { from: 'ja', to: 'en' });
    await new Promise(resolve => setTimeout(resolve, WAIT_TIME));
    return result;
  } catch (error) {
    console.error(error);
  }
}

async function initTables(db) {
  await db.run('CREATE TABLE IF NOT EXISTS tokens (token TEXT PRIMARY KEY)');
  await db.run(`CREATE TABLE IF NOT EXISTS seen_forms (
    seen_id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT,
    seen_form TEXT,
    type TEXT,
    pos_detail_1 TEXT,
    pos_detail_2 TEXT,
    pos_detail_3 TEXT,
    conjugated_type TEXT,
    conjugated_form TEXT,
    reading TEXT,
    pronunciation TEXT,
    CONSTRAINT unique_combination UNIQUE (token, seen_form, type, pos_detail_1, pos_detail_2, pos_detail_3),
    FOREIGN KEY (token) REFERENCES tokens (token))`);
  await db.run(`CREATE TABLE IF NOT EXISTS line_translations (
    line_id INTEGER PRIMARY KEY AUTOINCREMENT,
    line_jp TEXT, 
    line_en TEXT,
    CONSTRAINT unique_combination UNIQUE (line_jp, line_en))`);
  await db.run(`CREATE TABLE IF NOT EXISTS token_examples (
    example_id INTEGER PRIMARY KEY AUTOINCREMENT, 
    token TEXT,
    seen_form TEXT,
    seen_id INTEGER,
    line_id INTEGER,
    CONSTRAINT unique_combination UNIQUE (token, seen_id, line_id),
    FOREIGN KEY (token) REFERENCES tokens (token),
    FOREIGN KEY (seen_id) REFERENCES seen_forms (seen_id),
    FOREIGN KEY (line_id) REFERENCES seen_forms (line_id))`);
  await db.run(`CREATE TABLE IF NOT EXISTS jisho_translations (
    jisho_id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT, 
    result TEXT, 
    mulitple_results BOOLEAN, 
    direct_match BOOLEAN,
    FOREIGN KEY (token) REFERENCES tokens (token))`);
  await db.run(`CREATE TABLE IF NOT EXISTS manual_resolution (
    manual_resolution_id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT, 
    no_translation BOOLEAN, 
    resolved BOOLEAN,
    FOREIGN KEY (token) REFERENCES tokens (token))`);
}

(async () => {
  try {
    const tokenizer = await buildTokenizer();
    const db = await open({
      filename: 'mining-card-list.db',
      driver: sqlite3.Database
    });

    // init tables
    await initTables(db);

    const fileContents = await fs.promises.readFile(INPUT_PATH, 'utf8');
    const lines = fileContents.split('\n').filter(line => line !== '');

    const stagedCards = [];
    const uniqueTokenSet = new Set();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      const searchExistingLineQuery = 'SELECT * FROM line_translations WHERE line_jp = ?';
      const existingLine = await db.get(searchExistingLineQuery, [line]);

      let lineId;
      let translation;
      if (existingLine) {
        lineId = existingLine.line_id;
        translation = existingLine.line_en;
      } else {
        console.log(`NEW: ${line}`);
        const translationResult = await translateText(line);
        translation = translationResult.text;

        const insertLineQuery = 'INSERT INTO line_translations (line_jp, line_en) VALUES (?, ?)';
        const insertedLine = await db.run(insertLineQuery, [line, translation]);

        lineId = insertedLine.lastID;
      }

      // parse line for usable token
      const tokens = tokenizer.tokenize(line);

      for (const token of tokens) {
        if (!FILTERED_WORD_TYPES.includes(token.pos) && !uniqueTokenSet.has(token.basic_form) && token.basic_form !== '*') {
          const card = {
            ...token,
            example_jp: line,
            example_en: translation,
            lineId
          };
          stagedCards.push(card);
          uniqueTokenSet.add(token.basic_form);
        }
      }
    }

    // insert new tokens into database
    for (const stagedCard of stagedCards) {
      const {
        basic_form: token,
        surface_form: seenForm,
        pos: tokenType,
        pos_detail_1: posDetail1,
        pos_detail_2: posDetail2,
        pos_detail_3: posDetail3
      } = stagedCard;
      const insertTokenQuery = 'INSERT OR IGNORE INTO tokens (token) VALUES (?)';
      await db.run(insertTokenQuery, [stagedCard.basic_form]);

      const selectExistingSeenFormQuery = `SELECT seen_id FROM seen_forms
        WHERE token = ?
        AND seen_form = ?
        AND type = ?
        AND pos_detail_1 = ?
        AND pos_detail_2 = ?
        AND pos_detail_3 = ?`;
      const seenFormEntry = await db.get(selectExistingSeenFormQuery, [
        token,
        seenForm,
        tokenType,
        posDetail1,
        posDetail2,
        posDetail3
      ]);

      let seenId;
      if (seenFormEntry) {
        seenId = seenFormEntry.seen_id;
      } else {
        const insertSeenFormQuery = `INSERT OR IGNORE INTO seen_forms (
          token,
          seen_form, 
          type, 
          pos_detail_1,
          pos_detail_2,
          pos_detail_3,
          conjugated_type,
          conjugated_form,
          reading,
          pronunciation)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        const insertedSeenForm = await db.run(insertSeenFormQuery, [
          token,
          seenForm,
          tokenType,
          posDetail1,
          posDetail2,
          posDetail3,
          stagedCard.conjugated_type,
          stagedCard.conjugated_form,
          stagedCard.reading,
          stagedCard.pronunciation
        ]);

        seenId = insertedSeenForm.lastID;
      }

      // insert new example for seen form if it doesnt already exist
      const insertExampleQuery = `INSERT OR IGNORE INTO token_examples (
        token,
        seen_form,
        seen_id,
        line_id
      ) VALUES (?, ?, ?, ?)`;
      await db.run(insertExampleQuery, [
        token,
        seenForm,
        seenId,
        stagedCard.lineId
      ]);
    }

    const uniqueTokens = Array.from(uniqueTokenSet);

    // check if there is a jisho translation in db. if it doesnt exist, run jisho api and cache result[0]
    // ? - should batch the search query
    const placeholders = uniqueTokens.map((token) => `"${token}"`).join(',');
    const selectExistingTranslationsQuery = `SELECT * FROM jisho_translations WHERE token IN (${placeholders})`;
    const translations = await db.all(selectExistingTranslationsQuery);

    const existingTranslations = new Set(translations.map(translation => translation.token));
    const newTranslations = uniqueTokens.filter(value => !existingTranslations.has(value));

    for (const newTranslation of newTranslations) {
      const jishoResults = await searchForPhraseAsync(newTranslation);

      if (jishoResults.data.length > 0) {
        const result = JSON.stringify(jishoResults.data[0]);
        const moreResults = jishoResults.data.length > 1;
        const directMatch = jishoResults.data[0].slug === newTranslation;

        const insertQuery = 'INSERT INTO jisho_translations (token, result, mulitple_results, direct_match) VALUES (?, ?, ?, ?)';
        await db.run(insertQuery, [newTranslation, result, moreResults, directMatch]);
        console.log(`New Jisho entry for : ${newTranslation}`);
      } else {
        const insertQuery = 'INSERT OR IGNORE INTO manual_resolution (token, no_translation, resolved) VALUES (?, ?, ?)'
        await db.run(insertQuery, [newTranslation, true, false]);
        console.log(`No Jisho results for: ${newTranslation}`);
      }
    }

    // finalize cards
    // should utilize sql view here

    // output cards to importable form

    // console.log(`${cardsToCreate.length} cards created`);
    await db.close();
  } catch (err) {
    console.error('Error:', err);
  }
})();
