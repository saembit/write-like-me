# Style analysis rubric

Use this when turning a person's writing samples into a style report. You are characterizing how they write, not what they wrote about, so that an agent can imitate the voice.

Ground every observation in the samples. Describe what is actually there: sentence length, punctuation quirks, capitalization, hedging, humor, emoji, comment density, docstring structure, commit format. Prefer concrete, imitable observations ("starts messages lowercase", "uses em dashes mid sentence", "docstrings are one line, no param list") over vague ones ("writes clearly").

If the samples disagree with each other, describe the register shift (casual in chat, formal in docs) rather than averaging it away. If a sample is too short to support a claim, don't make it.

Floor: a habit seen in one sample is described as seen once ("the one chat message opens with Hey all"), not as a rule. It takes two or more samples before something becomes a guideline or an avoid. A register with fewer words than its minWords in data/registers.json gets "not enough evidence", not a guess.

Produce these fields. Guidelines and avoids are written as instructions to an agent writing on this person's behalf.

- atAGlance: 5 to 8 short bullets with the most distinctive habits across all the writing
- general.voiceAndTone: formal or casual, warm or dry, hedged or direct, humor, etc.
- general.sentenceStructure: sentence length, fragments, punctuation habits, paragraphing
- general.vocabulary: plain vs technical, jargon comfort, filler words, contractions
- general.formatting: lists, headers, emphasis, emoji, code formatting in prose
- general.guidelines: imperative do-this rules for writing prose like this person
- codeDocs.docstrings: length, structure, what they document and what they skip
- codeDocs.inlineComments: density, placement, tone, capitalization, punctuation
- codeDocs.commitMessages: format, tense, length, level of detail
- codeDocs.guidelines: imperative rules for writing code documentation like this person
- registers: one entry per register the samples cover (ids from data/registers.json: technical, docs, academic, essay, social, chat, email, code), 2 to 4 sentences each on how the voice shifts there compared to the general description. Length, formality, greeting and sign off, emoji, punctuation, how rough it's left. Only registers with enough material. Leave out registers with no samples at all.
- avoids: things this person notably does not do, the agent should avoid them too

Same shape as the WritingStyleReport schema in the write-like-me web app plus the registers key, which the web app ignores. Keep it that way so profile.json stays compatible.
