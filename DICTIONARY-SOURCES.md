# Dictionary sources

## Chinese dictionary availability

The current full input is the English JMdict distribution. The project's
[published language-specific JSON versions](https://github.com/scriptin/jmdict-simplified#full-common-only-with-examples-and-language-specific-versions)
do not list a Chinese JMdict package.

There is an [unofficial Chinese Jitendex community edition](https://github.com/greyindex/jitendex-yomitan-zh)
based on JMdict, distributed for Yomitan. Its README describes simplified
Chinese definitions generated and reviewed with language models, not a fully
human-verified official dictionary. It could be evaluated as an additional
Chinese gloss source, retaining English fallback and provenance. It is not
installed in this App; the current lookup and review definitions remain English.

Word definitions use JMdict, copyright James William BREEN and the Electronic Dictionary Research and Development Group (EDRDG).

- Project/documentation: https://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project
- Licence statement: https://www.edrdg.org/edrdg/licence.html
- Licence: Creative Commons Attribution-ShareAlike 4.0, https://creativecommons.org/licenses/by-sa/4.0/
- JSON conversion: https://github.com/scriptin/jmdict-simplified
- Import: `jmdict-eng-3.6.2+20261005200550.json.tgz` from jmdict-simplified GitHub releases.

`src/data/vocabulary.json` contains a modified JMdict extract: entries selected for this video's tokenized caption words, compacted to readings and English senses. This derived dictionary data is available under CC BY-SA 4.0. The extract retains spelling/reading restrictions and dictionary entry IDs. The data file records the source dictionary date/version. The application's dictionary dialog includes source and licence links.

Morphological tokenization uses Kuromoji.js (Apache 2.0) with its bundled IPADIC dictionary. See `node_modules/kuromoji/NOTICE.md`, `LICENSE-2.0.txt`, and its dictionary notices. Tokenization is prepared at import time, keeping large tokenizer/dictionary files out of the browser bundle.

Dictionary-backed multi-token merging respects ongoing verb inflection: a noun
candidate cannot consume an inflected verb stem followed by an auxiliary or
passive/causative suffix. Thus `この姿見られたら` is `この / 姿 / 見られたら`
(appearance + being seen), while the genuine noun in `姿見を買った` remains
`姿見` (full-length mirror). Passive/causative suffixes and auxiliaries stay with
their lexical verb for lookup, e.g. `見られたら` maps to `見る`.

Explicit caption-spelling aliases in `scripts/vocabulary.mjs` allow `ナップキン` to match the dictionary headword `ナプキン`. The visible caption and its reading remain unchanged, and lookup labels the spelling variant separately from verb inflections. Aliases only apply when the target headword exists; small `ッ` is not removed from arbitrary words.

## Refreshing the data

Download and unpack the latest **full English JMdict** JSON release from https://github.com/scriptin/jmdict-simplified/releases/latest. Then run:

```bash
npm run vocabulary -- /path/to/jmdict-eng.json
npm test
npm run build
```

Regenerate whenever caption text changes or the dictionary is updated. No translation service or API key is required at playback time. The raw full dictionary is a development input and is not shipped in the app. Dictionary meanings are not automatically disambiguated contextual translations; unknown words remain explicitly unmatched.
## Grammar combinations

`scripts/grammar.mjs` is the grammar layer, invoked by `scripts/vocabulary.mjs`
after IPADIC morphology. Each rule checks token lemmas, parts of speech,
conjugations and exact adjacency before grouping a learnable expression.
Whitespace, punctuation and subtitle boundaries prevent joining.

Supported initial families:

- Negative + `さ` + `すぎる`, including `なさすぎ` / `なさ過ぎる` and
  attached lexical stems such as `食べなさすぎる`.
- Verb/adjective stems + excessive `すぎる`, such as `食べすぎました`,
  `高すぎて` and `少なすぎる`. Dictionary lookup uses the lexical base
  (`食べる`, `高い`, `少ない`), while the study card keeps the construction.

Notes show the overall grammatical function and component breakdown in lookup;
review cards retain both along with available lexical dictionary meanings.
These explanations are App-authored and labeled **文法組合**, separate from
JMdict senses. Grammatical endings do not look up unrelated dictionary homonyms.
The original subtitle text and timings remain intact. No model API is called
when clicking words or building these rule-based notes.

Explanatory endings such as `なんですね` / `んです` / `のです` use ordinary
IPADIC tokenization and dictionary lookup. Their special grouping rule has been
removed so the current focus is lexical study. Future custom phrase cards can
support learning these expressions deliberately.

This is an extensible set of deterministic grammatical rules, not a complete
Japanese parser or automatic contextual translation system. More dictionary
compounds and suru expressions need further work.
Regression tests cover unseen sentences and false-positive cases, not only
the active video's examples. Existing saved words and progress are not deleted
or automatically reassigned when segmentation changes.
