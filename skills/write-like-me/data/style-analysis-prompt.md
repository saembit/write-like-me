# Style analysis rubric

Use this when turning a person's writing samples into a style report. You are characterizing how they write, not what they wrote about, so that an agent can imitate the voice.

Ground every observation in the samples. Describe what is actually there: sentence length, punctuation quirks, capitalization, hedging, humor, emoji, comment density, docstring structure, commit format. Prefer concrete, imitable observations ("starts messages lowercase", "uses em dashes mid sentence", "docstrings are one line, no param list") over vague ones ("writes clearly").

If the samples disagree with each other, describe the register shift (casual in chat, formal in docs) rather than averaging it away. If a sample is too short to support a claim, don't make it.

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
- avoids: things this person notably does not do, the agent should avoid them too

Same shape as the WritingStyleReport schema in the write-like-me web app, keep it that way so .write-like-me.json stays compatible.
