const fs = require('fs');
const kuromoji = require('kuromoji');
const JishoAPI = require('unofficial-jisho-api');
const GoogleTranslate = require('google-translate-api-x');

const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const INPUT_PATH = './input/input.txt';
const OUTPUT_PATH = './output/output.txt';
const CONDENSED_OUTPUT = './output/test-output.json';
const MASTER_LIST = '';

const WAIT_TIME = 1000;
const BATCH_SIZE = 100;

const jisho = new JishoAPI();

// Filter out particles, symbols, auxiliary verbs
const FILTERED_WORD_TYPES = ['助詞', '記号', '助動詞'];
const TYPE_DICTIONARY = {
  副詞: 'Adverb',
  名詞: 'Noun',
  動詞: 'Verb',
  形容詞: 'Adjective'
};

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
    return result;
  } catch (error) {
    console.error('Translation error:', error);
    throw error;
  }
}

// Create anki token card
function createTokenCard(token) {
  return `test ${token}`;
}

// Create anki line card
function createLineCard(line) {
  return `test ${line}`;
}

(async () => {
  try {
    const tokenizer = await buildTokenizer();
    const db = await open({
      filename: 'mining-card-list.db',
      driver: sqlite3.Database
    });

    // init tables
    // await db.run('CREATE TABLE IF NOT EXISTS tokens (token TEXT PRIMARY KEY, type TEXT)');
    // await db.run('CREATE TABLE IF NOT EXISTS token_examples (token TEXT PRIMARY KEY, example_jp TEXT, example_en TEXT)');
    await db.run('CREATE TABLE IF NOT EXISTS jisho_translations (token TEXT PRIMARY KEY, result TEXT, mulitple_results BOOLEAN, direct_match BOOLEAN)');

    const fileContents = await fs.promises.readFile(INPUT_PATH, 'utf8');
    const lines = fileContents.split('\n').filter(line => line !== '');

    // batch translate lines via google translate
    const translatedLines = await translateText(lines);

    const cardsToCreate = [];
    const uniqueTokenSet = new Set();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const translateLine = translatedLines[i];

      // Parse contents for token cards to make
      const tokens = tokenizer.tokenize(line);

      for (const token of tokens) {
        if (!FILTERED_WORD_TYPES.includes(token.pos) && !uniqueTokenSet.has(token.basic_form)) {
          const card = {
            ...token,
            example_jp: line,
            example_en: translateLine
          };
          cardsToCreate.push(card);
          uniqueTokenSet.add(token.basic_form);
        }
      }
    }

    // check if cards exist in database

    // Generate the placeholders for the parameterized query
    const uniqueTokens = Array.from(uniqueTokenSet);
    const placeholders = uniqueTokens.map((token) => `"${token}"`).join(',');

    const selectExistingTokensQuery = `SELECT * FROM jisho_translations WHERE token IN (${placeholders})`;
    const rows = await db.all(selectExistingTokensQuery);

    const existingTokens = new Set(rows.map(row => row.token));
    const newTokens = uniqueTokens.filter(value => !existingTokens.has(value));

    // If new values are found, insert them into the database
    // if (newTokens.length > 0) {
    //   const insertQuery = `INSERT INTO tokens (token, ) VALUES ${newTokens.map(() => '(?)').join(',')}`;
    //   await db.run(insertQuery, newTokens);
    // }

    // if not, use jisho translate
    for (const newToken of newTokens) {
      const jishoResults = await searchForPhraseAsync(newToken);

      if (jishoResults.data.length > 0) {
        const result = JSON.stringify(jishoResults.data[0]);
        const moreResults = jishoResults.data.length > 1;
        const directMatch = jishoResults.data[0].slug === newToken;

        const insertQuery = 'INSERT INTO jisho_translations (token, result, mulitple_results, direct_match) VALUES (?, ?, ?, ?)';
        await db.run(insertQuery, [newToken, result, moreResults, directMatch]);
        console.log(`New Jisho entry for : ${newToken}`);
      } else {
        console.log(`No Jisho results for: ${newToken}`);
      }
    }

    // const translatedTokens = await translateTokens(filteredTokens);
    // const formattedContent = JSON.stringify(translatedTokens, null, 2);
    // // Write token cards
    // await fs.promises.writeFile(CONDENSED_OUTPUT, formattedContent, 'utf8');
    console.log(`${cardsToCreate.length} cards created`);
  } catch (err) {
    console.error('Error:', err);
  }
})();
