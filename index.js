const fs = require('fs');
const kuromoji = require('kuromoji');
const JishoAPI = require('unofficial-jisho-api');
const GoogleTranslate = require('google-translate-api');

const INPUT_PATH = './input/input.txt';
const OUTPUT_PATH = './output/output.txt';
const CONDENSED_OUTPUT = './output/test-output.json';
const MASTER_LIST = '';

const WAIT_TIME = 500;

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

// Filter tokens for desired word types and remove repeats
function filterTokens(rawTokens) {
  const uniqueTokens = [];
  const uniqueWords = new Set();

  for (const token of rawTokens) {
    if (!FILTERED_WORD_TYPES.includes(token.pos) && !uniqueWords.has(token.basic_form)) {
      uniqueTokens.push({ basic_form: token.basic_form, type: token.pos });
      uniqueWords.add(token.basic_form);
    }
  }

  return uniqueTokens;
}

// Translate collection of single word tokens using jisho api
async function translateTokens(tokens) {
  const translatedTokens = [];

  // Use type dictionary to determine which definition to use
  for (const token of tokens) {
    const jishoResult = await searchForPhraseAsync(token.basic_form);
    const translationData = {};

    if (jishoResult.data.length === 0) {
      translationData.translation = jishoResult.data[0];
      return;
    }

    translationData.moreResults = true;

    if (jishoResult.data[0].slug !== token.basic_form) {
      translationData.noDirectMatch = true;
    }

    translatedTokens.push({ ...token, ...translationData });
  }

  return translatedTokens;
}

// Translate text using google translate api
async function translateText(text) {
  try {
    const result = await GoogleTranslate(text, { from: 'ja', to: 'en' });
    return result.text;
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

async function createDeck(sourcePath, destinationPath) {
  try {
    // Read the file asynchronously
    const fileContents = await fs.promises.readFile(sourcePath, 'utf8');

    // Parse contents for token cards to make
    const tokenizer = await buildTokenizer();
    const path = tokenizer.tokenize(fileContents);

    const filteredTokens = filterTokens(path);
    const translatedTokens = await translateTokens(filteredTokens);

    const formattedContent = JSON.stringify(translatedTokens, null, 2);
    // Write token cards
    await fs.promises.writeFile(destinationPath, formattedContent, 'utf8');

    // Write line cards

    console.log('Cards created successfully');
  } catch (err) {
    console.error('Error:', err);
  }
}

// Create cards

createDeck(INPUT_PATH, CONDENSED_OUTPUT);
