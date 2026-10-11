/**
 * Behavioral metrics extracted from a single user message.
 *
 * Pure, side-effect free. Designed for batch use during session ingestion
 * and standalone testing.
 */

export interface UserMessageMetrics {
	/** Total characters of analyzed text. */
	chars: number;
	/** Whitespace-delimited word count. */
	words: number;
	/**
	 * Number of "yelling" sentences: sentences where more than half of the
	 * alphabetic characters are uppercase (and there are enough letters to
	 * make the ratio meaningful - short acronyms like "OK" don't count).
	 * A sentence also needs either two uppercase runs ("WHAT THE HELL") or
	 * one elongated run ("CMOOON") so a lone acronym/env var ("use JSON",
	 * "HOME=/tmp") doesn't register.
	 */
	yelling: number;
	/** Profanity hits (word-boundary, case-insensitive). */
	profanity: number;
	/**
	 * Catch-all "obviously upset" signal computed on a *prose-only* body
	 * (code fences, XML/HTML tags, URLs, file mentions, and quoted lines
	 * are stripped first; messages whose remaining prose is >=3 lines score
	 * zero because formatted prompts aren't tantrums).
	 *
	 * Sum of:
	 * - drama runs: 3+ `!` / `?` (with `1`-mishit fallout)
	 * - interjections, elongated where the short form is ambiguous:
	 *   `noooo`, `ahhh`, `ugh(h)`, `argh`, `grr`, `stooop`, `whyyy`,
	 *   `fuuu(ck)`, `wtfff`, `omggg`, `yesss`, `goddd`, `bruhh`
	 * - standalone `dude`
	 * - sad emoticons: `:(`, `;(`, `:-(((`
	 */
	anguish: number;
	/**
	 * Corrective negation: the user is telling us we got it wrong.
	 *
	 * Counted on the same prose-only body as {@link anguish}.
	 *
	 * - line-leading `nope` / `nah` / `nvm` / `wrong` / `incorrect`
	 *   (word-bounded, so `now`, `nobody`, `north` don't match)
	 * - line-leading `no` when used as an interjection - followed by
	 *   punctuation, end-of-text, or a discourse word (`no i meant`,
	 *   `no, wait`). Determiner `no` (`no extensions to the page`,
	 *   `no auto start`) doesn't count.
	 * - `that(?:'s)? not (what|right|it)` and `not what i (meant|asked|said|wanted)`
	 * - `makes (no|zero) sense`
	 */
	negation: number;
	/**
	 * The user is repeating themselves - strong signal the previous turn
	 * missed the ask. Counts hits for:
	 *
	 * - `i (meant|said|asked|told you|already (said|told|did|asked|wrote))`
	 * - `(like|as) i (said|told you|asked)`
	 * - `still (doesn't|isn't|not|broken|wrong|fails|failing|the same|same)`
	 *
	 * Bare `still` / `again` are too ambiguous to count alone (they show up
	 * in normal speech like "try again" or "still works").
	 *
	 * Also counts the Chinese recall/still markers (`我说过`, `还是不行`, `又错了`)
	 * and whole-message repetition of the previous user message (`prevText`),
	 * which is the signal that survives both languages and voice input.
	 */
	repetition: number;
	/**
	 * Direct second-person reproach pinned on the agent:
	 *
	 * - `you (didn't|did not|broke|missed|forgot|keep|always|never|still|ignored)`
	 * - `why (would|did) (you|u)`
	 * - sentence-leading `stop <verb>ing` imperatives
	 * - the Chinese forms (`你怎么又`, `你没改`, `我明明说过`, `不是让你`)
	 */
	blame: number;
	/**
	 * Emphatic markers the caps-based {@link yelling} cannot see, because they
	 * are how Chinese - and any voice-transcribed text - shouts: full-width
	 * `！？` bursts, a Han character or short word repeated three or more times
	 * (`不不不`, `不对不对不对`), and elongated interjections (`啊啊啊`).
	 * English text scores 0 here; its shouting is already in {@link yelling}.
	 */
	emphasis: number;
	/**
	 * 1 when the prose is dominated by a script no shipped lexicon covers
	 * (Kana, Hangul, Cyrillic, Arabic, …). The other counts are then *not*
	 * evidence of calm - they are evidence of a missing lexicon, and the
	 * dashboard reports those messages as unscored rather than as content.
	 */
	unsupportedScript: number;
}

/**
 * Words considered profane/aggressive. Word-boundary, case-insensitive.
 *
 * Broad English coverage: f-/s-word families and their censored variants,
 * mild swears, intelligence-based insults, body-part insults, British/
 * Australian/Irish slang, religious exclamations, and chat acronyms.
 * Curated to exclude racial, homophobic, and other identity slurs, and
 * words whose dominant use in a coding corpus is technical rather than
 * profane (`dummy` data, `blast` radius, config `knob`, `trash` bin,
 * CRUD, `garbage` files) or plain opinion (`useless`, `awful`, `meh`,
 * `hate`). Pure frustration interjections (`ugh`, `argh`, `grr`) are
 * scored as anguish instead.
 */
const PROFANITY: readonly string[] = [
	// f-word family
	"fuck",
	"fucks",
	"fucked",
	"fucking",
	"fuckin",
	"fucker",
	"fuckers",
	"fuckup",
	"fuckups",
	"fuckhead",
	"fuckheads",
	"fuckface",
	"fuckwit",
	"fuckwits",
	"fucktard",
	"fuckery",
	"fuckoff",
	"motherfucker",
	"motherfuckers",
	"motherfucking",
	"clusterfuck",
	"ratfuck",
	"unfuck",
	// censored / euphemistic f-word
	"fk",
	"fks",
	"fking",
	"fkin",
	"fker",
	"fck",
	"fcks",
	"fcking",
	"fckin",
	"fcker",
	"fuk",
	"fuking",
	"fukin",
	"eff",
	"effs",
	"effed",
	"effing",
	"frick",
	"fricks",
	"fricked",
	"fricking",
	"frickin",
	"freaking",
	"freakin",
	"freaked",
	// s-word family
	"shit",
	"shits",
	"shat",
	"shitty",
	"shittier",
	"shittiest",
	"shite",
	"shites",
	"shited",
	"shitting",
	"shitter",
	"shitters",
	"shithead",
	"shitheads",
	"shitshow",
	"shitstorm",
	"shitstain",
	"shitfaced",
	"shitload",
	"shitbag",
	"shitcan",
	"shitcanned",
	"shitpost",
	"shitposting",
	"bullshit",
	"bullshits",
	"bullshitting",
	"bullshitter",
	"horseshit",
	"batshit",
	"dogshit",
	"dipshit",
	"jackshit",
	"dumbshit",
	"holyshit",
	// mild swears
	"damn",
	"damns",
	"damned",
	"damning",
	"dammit",
	"goddamn",
	"goddamned",
	"goddamnit",
	"goddammit",
	"darn",
	"darns",
	"darned",
	"darnit",
	"dang",
	"danged",
	"dangit",
	"hell",
	"hells",
	"heck",
	"hecks",
	"heckin",
	"gosh",
	"bloody",
	"bollocks",
	"bollox",
	// crap family
	"crap",
	"craps",
	"crappy",
	"crappier",
	"crappiest",
	"crapped",
	"crapping",
	"crapload",
	"crapola",
	// piss family
	"piss",
	"pisses",
	"pissed",
	"pissing",
	"pisser",
	"pisspoor",
	"pisstake",
	"pisshead",
	// ass family
	"ass",
	"asses",
	"asshole",
	"assholes",
	"asshat",
	"asshats",
	"asswipe",
	"asswipes",
	"assclown",
	"assbag",
	"asskisser",
	"dumbass",
	"dumbasses",
	"jackass",
	"jackasses",
	"smartass",
	"smartasses",
	"badass",
	"badasses",
	"lazyass",
	"fatass",
	"hardass",
	"halfass",
	"halfassed",
	"arse",
	"arsed",
	"arsehole",
	"arseholes",
	"arsewipe",
	// bitch family
	"bitch",
	"bitches",
	"bitched",
	"bitching",
	"bitchy",
	"bitchier",
	"bitchiest",
	"sonofabitch",
	"biatch",
	"biotch",
	// strong vulgarity
	"cunt",
	"cunts",
	"cunty",
	"cuntish",
	"twat",
	"twats",
	"twatty",
	"bastard",
	"bastards",
	// body-part insults
	"dick",
	"dicks",
	"dickhead",
	"dickheads",
	"dickish",
	"dickwad",
	"dickwads",
	"dickface",
	"dickbag",
	"prick",
	"pricks",
	"prickish",
	"cock",
	"cocks",
	"cocky",
	"cockier",
	"cockiest",
	"cockhead",
	"cockblock",
	"cocksucker",
	"cocksuckers",
	"knobhead",
	"knobheads",
	"knobend",
	"wanker",
	"wankers",
	"wankery",
	"tosser",
	"tossers",
	"jerkoff",
	"jerkoffs",
	"douche",
	"douches",
	"douchebag",
	"douchebags",
	"douchey",
	"scumbag",
	"scumbags",
	"scum",
	"sleazebag",
	"sleazeball",
	"slimeball",
	"lowlife",
	"lowlifes",
	"deadbeat",
	// intelligence-based insults
	"idiot",
	"idiots",
	"idiotic",
	"idiocy",
	"stupid",
	"stupider",
	"stupidest",
	"stupidity",
	"moron",
	"morons",
	"moronic",
	"imbecile",
	"imbeciles",
	"retard",
	"retards",
	"retarded",
	"dumb",
	"dumber",
	"dumbest",
	"dumbo",
	"fool",
	"fools",
	"foolish",
	"foolery",
	"clown",
	"clowns",
	"clownish",
	"buffoon",
	"buffoons",
	"simpleton",
	"halfwit",
	"halfwits",
	"nitwit",
	"nitwits",
	"dimwit",
	"dimwits",
	"dolt",
	"dolts",
	"doltish",
	"knucklehead",
	"knuckleheads",
	"blockhead",
	"blockheads",
	"lamebrain",
	"airhead",
	"airheads",
	"scatterbrain",
	"numbnuts",
	"numbskull",
	"numpty",
	"numpties",
	"muppet",
	"muppets",
	"pillock",
	"pillocks",
	"plonker",
	"plonkers",
	"prat",
	"prats",
	"berk",
	"berks",
	"ninny",
	"ninnies",
	"dingbat",
	"dingbats",
	"putz",
	"putzes",
	"schmuck",
	"schmucks",
	"jerk",
	"jerks",
	"jerkface",
	"gits",
	"sod",
	"sodding",
	"bugger",
	"buggered",
	// generic aggression / dismissal
	"suck",
	"sucks",
	"sucked",
	"sucking",
	"sucky",
	"suckage",
	"trashy",
	// religious exclamations
	"jesus",
	"christ",
	"jeez",
	"jeezus",
	"sheesh",
	"godsake",
	// chat acronyms
	"wtf",
	"wth",
	"wtaf",
	"stfu",
	"gtfo",
	"omfg",
	"omg",
	"ffs",
	"jfc",
	"kys",
	"fml",
	"smh",
	"smdh",
	"smfh",
	"idgaf",
	"idfc",
	"lmfao",
	"fubar",
	"snafu",
];

const PROFANITY_RE = new RegExp(String.raw`\b(?:${PROFANITY.join("|")})\b`, "gi");
const SENTENCE_RE = /[^.!?\n]+/g;
const LETTER_RE = /\p{L}/gu;
const UPPER_LETTER_RE = /\p{Lu}/gu;
const YELLING_MIN_LETTERS = 4;
const YELLING_THRESHOLD = 0.5;
// Runs starting with `!` or `?` followed by 2+ of `!?1`. The `1` is the
// classic shift-key mishit ("!!!111" / "!?!??111") so we count those as
// part of the same drama burst.
const DRAMA_RE = /[!?][!?1]{2,}/g;
const WORD_RE = /\S+/g;

// Anguish/exasperation interjections. Each alternative is a case-insensitive
// word-bounded pattern. Interjections whose short form collides with normal
// prose ("no", "ahh", "why", "yes", "god") require *real* elongation;
// unambiguous ones ("ugh", "argh", "grr") match their plain form too.
// Picked to avoid hex / base64 contamination via the surrounding `\b` plus
// letter-only alternatives.
const ANGUISH_PATTERNS: readonly string[] = [
	"no{3,}", //          nooo, noooooo
	"a+h{2,}", //         ahh, aaaahhh
	"u+r?g+h+", //        ugh, ughh, urgh, uuugh
	"a+r+g+h+", //        argh, aaargh, arrgghhh
	"g+r{2,}", //         grr, grrrr
	"st+o{3,}p+", //      stooop, sttooopp
	"w+h+y{3,}", //       whyyy, whyyyyy
	"f+u{3,}c*k*", //     fuuu, fuuuck
	"wtf{3,}", //         wtfff
	"o+m+g{2,}", //       omgg, omggg
	"ye+s{3,}", //        yesss, yeessss
	"g+o+d{3,}", //       goddd, goddddd
	"br+u+h{2,}", //      bruhh, bruuuhh
];
const ANGUISH_RE = new RegExp(String.raw`\b(?:${ANGUISH_PATTERNS.join("|")})\b`, "gi");
const DUDE_RE = /\bdude\b/gi;
// Sad emoticons (`:(` and friends). Requires a leading boundary so pasted
// code/regex fragments like `foo:(bar)` don't fire; `\(+` folds `:(((` into
// one hit. 46 corpus hits, ~90% genuinely deflated.
const SAD_EMOTICON_RE = /(?<=^|[\s.!?])[:;]-?\(+/g;
// Dot runs (`..` / `...` / `....`) are deliberately NOT counted: on a real
// corpus they are dominated by neutral trail-offs, template placeholders
// (`{{href...}}`) and range syntax, not exasperation.

// --- Frustration signals ----------------------------------------------------
// Each set of patterns below is tuned against ~42k real user prompts so the
// short-prose hits are dominated by genuine frustration, not technical talk.

// Corrective negation. We deliberately anchor to the very start of the
// trimmed prose body (no `m` flag) - in practice mid-message lines that
// start with `no`/`Wrong`/`No JSDoc warning` are list items, pasted error
// text or descriptive statements, not actual corrections. Real frustration
// negation overwhelmingly opens the message. Bare `no` only counts as an
// interjection - followed by punctuation, end-of-text, or a discourse word -
// so determiner uses ("no extensions to the page", "no auto start") don't
// score. A hyphen only counts as a separator when it doesn't glue a compound
// (`no - not that` yes, `no-op change` no). Note: the bare-`no` branch
// deliberately has no trailing `\b`, so emphatic misspellings like `nou ...`
// / `nono ...` also count (via `no` + follower `u`/`no`) - on the real
// corpus every such hit is a genuine correction.
const NEGATION_LEAD_RE =
	/^[ \t]*(?:(?:nope|nah|nvm|wrong|incorrect)\b|no(?=\s*(?:[,.!?;:\u2013\u2014]|-(?!\w)|$|(?:i|im|u|you|ur|we|it|its|that|thats|this|the|they|theyre|he|she|man|dude|bro|wait|dont|not|stop|just|again|please|plz|but|actually|literally|seriously|sorry|no|never|nothing|wtf|why|what|wrong)\b)))/gi;
const NEGATION_PHRASE_RE =
	/\b(?:that['\u2019]?s\s+not\s+(?:what|right|it)|not\s+what\s+i\s+(?:meant|asked|said|wanted)|makes\s+(?:no|zero)\s+sense)\b/gi;

// User repeating themselves. The recall pattern accepts an optional
// `like ` / `as ` prefix so "like i said" doesn't double-count with bare
// "i said". Bare `i asked` is too noisy - it's overwhelmingly "i asked
// <some third party>" in this corpus (committee, experts, weaker LLM, ...) -
// so we require `i asked you` for that variant. Bare `still` / `again` are
// ambiguous so we only count `still` when followed by a negative or
// sameness marker.
const REPETITION_RECALL_RE =
	/\b(?:(?:like|as)\s+i\s+(?:said|told\s+you|asked)|i\s+(?:meant|said|told\s+you|asked\s+you|already\s+(?:said|told|did|asked|wrote)))\b/gi;
const REPETITION_STILL_RE =
	/\bstill\s+(?:doesn['\u2019]?t|doesnt|isn['\u2019]?t|isnt|not|broken|wrong|fails|failing|the\s+same|same)\b/gi;

// Direct second-person reproach. `you` alone is too generic (>7k hits in
// short prose), so we anchor it to a small set of accusatory verbs.
const BLAME_YOU_RE = /\byou\s+(?:didn['\u2019]?t|did\s+not|broke|missed|forgot|keep|always|never|still|ignored)\b/gi;
// `why would/did you ...` is reproach even when politely phrased. Bare
// `why you` / `why are you` are dominated by neutral how-does-this-work
// questions, so only the past/conditional forms count.
const BLAME_WHY_RE = /\bwhy\s+(?:would|did)\s+(?:you|u)\b/gi;
// `stop <verb>ing` is only frustration when it's an imperative - require it
// to start a sentence (line start or after a sentence-terminating punctuator).
const BLAME_STOP_RE = /(?:^|(?<=[.!?\n]))\s*stop\s+\w+ing\b/gim;

// --- Chinese and voice-input signals ----------------------------------------
// Chinese has no word boundaries and no letter case, so every pattern below is
// boundary-free (`\b` never fires between two Han characters) and independent
// of punctuation. That independence is the point: most Chinese traffic reaches
// the agent through voice transcription, which emits one long unpunctuated
// line and renders swearing as whichever homophone the recognizer chose
// (`卧槽`/`我艹`/`淦`). A pattern that needed `!` or a space would score zero on
// exactly the messages this layer exists for.
//
// Every list is deliberately narrow: a term earns its place only when its
// dominant use in a coding chat is frustration. So `沙雕` (playful) and `呵呵`
// (merely dry) are out, bare `草`/`靠` are out (`草莓`, `草稿`, `依靠` are far
// more common), and repeated agreement forms (`好好好`, `对对对`, `哈哈哈`) are
// out because they are at least as often genuine.
const ZH_PROFANITY: readonly string[] = [
	"傻逼",
	"傻b",
	"煞笔",
	"傻x",
	"智障",
	"弱智",
	"废物",
	"垃圾",
	"滚蛋",
	"去死",
	"妈的",
	"他妈的",
	"特么",
	"卧槽",
	"我操",
	"我艹",
	"我草",
	"操你",
	"草你",
	"艹你",
	"操蛋",
	"淦",
	"我靠",
	"哇靠",
	"靠北",
	"狗屎",
	"什么破",
	"破玩意",
	"烂死",
];
const ZH_PROFANITY_RE = new RegExp(ZH_PROFANITY.join("|"), "gi");

// Exasperation. `唉`/`哎` are the Chinese `ugh`; the internet registers
// (`服了`, `醉了`, `无语`, `离谱`, `逆天`, `绝了`) are what a Chinese user
// actually types when the agent has failed twice in a row. `干什么` is out on
// purpose: `这个是干什么用的` is an ordinary question, while its exasperated twin
// `搞什么呢` is in.
const ZH_ANGUISH: readonly string[] = [
	"哎呀",
	"哎哟",
	"哎呦",
	"天哪",
	"天啊",
	"妈呀",
	"我的天",
	"不是吧",
	"不会吧",
	"救命",
	"崩溃",
	"崩了",
	"麻了",
	"服了",
	"服气",
	"醉了",
	"无语",
	"离谱",
	"逆天",
	"绝了",
	"要命",
	"疯了",
	"烦死",
	"气死",
	"急死",
	"完蛋",
	"搞什么",
	"什么鬼",
	"咋回事",
];
const ZH_ANGUISH_RE = new RegExp(ZH_ANGUISH.join("|"), "g");

// Corrective negation. Anchored to the start of the prose body like the
// English lead (`不对`, `错了`, `搞错`); mid-sentence occurrences are usually
// ordinary description. Bare `不是` only counts as the interjection form -
// when nothing Han follows it - so the very common `不是我做的` / `不是这个
// 问题` stay neutral.
const ZH_NEGATION_LEAD_RE =
	/^[ \t]*(?:不对|不是(?![\p{Script=Han}])|错了|搞错|弄错|怎么可能|怎么会|咋会|什么鬼|不可能|哪里对|哪儿对)/gu;
const ZH_NEGATION_PHRASE_RE =
	/(?:不是(?:这个|这|那个|那)?意思|搞错(?:了|了吧)?|弄错(?:了)?|我说的是|我指的是|我要的是|不应该(?:是)?这样|不该这样|(?:又|还是)(?:错|不对)(?:了)?)/g;

// "You already made me say this." Pronoun-free forms (`又错了`, `还是不行`)
// matter more than the ones that need `你`, because a recognizer may drop the
// subject entirely.
const ZH_REPETITION_RE =
	/(?:我说过|我说了|我早就说|我已经说|跟你说过?|重复(?:了)?|又(?:错|来|是|搞|弄|要|不)|还是(?:不行|不对|没|这样|那样|一样|老样子)|(?:依旧|依然|仍然)(?:没|不|一样|这样|错|是)|老样子|没变|没改|又来了|第[二三]次|再来一次|重来|重新来过?|白做|白干|白弄|浪费时间)/g;

// Direct reproach. `你怎么` needs a follow-up that only a complaint uses -
// `你怎么看` (what do you think?) is neutral - and `你能不能` needs the
// exasperated tail (`认真点`, `别…`).
const ZH_BLAME_RE =
	/(?:你怎么(?:又|还|这么|那么|回事|搞|弄|能|不|没|老是|总是)|你干嘛|你干吗|你搞的|你弄的|你没(?:有)?(?:改|做|弄|看|听|按)|你(?:又|老是|总是)|谁让你|我让你|我明明(?:说|要|让|告诉|讲)|不是让你|我是不是(?:说|讲)过|你到底(?:想|要|在)|你能不能(?:认真|好好|别))/g;

// Shouting without capital letters: a denial/vent character run (`不不不`,
// `啊啊啊`, `唉唉唉`) or a repeated short denial (`不对不对`, `不是不是`).
// Long vowel-free Han runs are unambiguous; 2x repeats of ordinary words
// (`谢谢`) are common, so runs need three in a row and words come from a
// negative list.
const ZH_REPEAT_CHAR_RE = /([不别没错唉哎啊呀呜])\1{2,}/gu;
const ZH_REPEAT_WORD_RE = /(不对|不是|不行|不要|没用|没变|又错)(?:\1)+/gu;
// Full-width bursts (`？？？`, `？！？`). The first mark must be full-width so a
// pure-ASCII `!!!` stays where it belongs, in the English `anguish` bucket.
const ZH_DRAMA_RE = /[！？][！？!?]{2,}/g;

// Scripts no shipped lexicon covers. Kana/Hangul/Cyrillic/Arabic/… text scores
// zero on every signal above, and a dashboard that reported those zeros as
// "not annoyed" would be lying about its coverage.
const SCRIPT_LETTER_RE = /\p{L}/gu;
const UNSUPPORTED_SCRIPT_RE =
	/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Thai}\p{Script=Devanagari}\p{Script=Greek}]/gu;
const UNSUPPORTED_SCRIPT_SHARE = 0.3;

/** 1 when the prose leans on a script the lexicons do not cover. */
function detectUnsupportedScript(prose: string): number {
	const letters = countMatches(prose, SCRIPT_LETTER_RE);
	if (letters < 4) return 0;
	return countMatches(prose, UNSUPPORTED_SCRIPT_RE) / letters > UNSUPPORTED_SCRIPT_SHARE ? 1 : 0;
}

/** Whole-message repetition: normalised character-bigram Jaccard similarity. */
const REPEATED_MESSAGE_SIMILARITY = 0.7;
const REPEATED_MESSAGE_MIN_CHARS = 8;

function normalizeForComparison(text: string): string {
	return text.replace(/[\s\p{P}\p{S}]/gu, "").toLowerCase();
}

function bigrams(normalized: string): Set<string> {
	const grams = new Set<string>();
	for (let i = 0; i + 1 < normalized.length; i++) grams.add(normalized.slice(i, i + 2));
	return grams;
}

/**
 * 1 when the message says essentially the same thing as the one before it -
 * the one frustration signal that needs no lexicon and therefore works for
 * any language and survives every transcription error.
 */
function detectRepeatedMessage(prose: string, prevProse: string): number {
	const current = normalizeForComparison(prose);
	const previous = normalizeForComparison(prevProse);
	if (current.length < REPEATED_MESSAGE_MIN_CHARS || previous.length < REPEATED_MESSAGE_MIN_CHARS) return 0;
	if (current === previous) return 1;
	const a = bigrams(current);
	const b = bigrams(previous);
	if (a.size === 0 || b.size === 0) return 0;
	let shared = 0;
	for (const gram of a) if (b.has(gram)) shared++;
	return shared / (a.size + b.size - shared) >= REPEATED_MESSAGE_SIMILARITY ? 1 : 0;
}

// Stripped from the analyzed body before scoring so that structured
// content (code, XML/HTML, URLs, file mentions, quoted blocks) doesn't
// pollute behavior signals. We replace with a newline so line counts
// reflect what was removed instead of merging neighbors.
const FENCED_CODE_RE = /```[\s\S]*?```/g;
const XML_TAG_PAIR_RE = /<([A-Za-z][\w-]*)\b[^>]*>[\s\S]*?<\/\1>/g;
const XML_TAG_BARE_RE = /<\/?[A-Za-z][\w-]*\b[^>]*\/?>/g;
const INLINE_CODE_RE = /`[^`\n]*`/g;
const URL_RE = /\bhttps?:\/\/\S+/gi;
const FILE_MENTION_RE = /(^|\s)@[\w./-]+/g;
// Dotted tokens: filenames (`AGENTS.md`), dotted identifiers (`Bun.file`),
// versions (`1.2.3`). Stripped so SENTENCE_RE doesn't split them into
// all-caps fragments ("Follow AGENTS.md and ..." -> "Follow AGENTS") that
// register as yelling.
const DOTTED_TOKEN_RE = /(?<=^|[\s("'[])[\w-]+(?:\.[\w-]+)+(?=$|[\s)"'\],:;!?]|\.(?!\w))/g;
const QUOTE_LINE_RE = /^[ \t]*>.*$/gm;
// Harness placeholders the TUI substitutes for binary/non-text user input.
// Strip them so real frustration signals on later lines aren't masked off
// by `[Image #1]` etc. consuming line 1.
const IMAGE_MARKER_RE = /\[Image #\d+\]/g;
// ANSI escape sequences sometimes leak in from terminal copy-paste
// (e.g. when the user pastes a bash transcript). Strip them.
const ANSI_ESCAPE_RE = /\x1b\[[0-9;]*[A-Za-z]/g;

// Users don't really get angry with super detailed and formatted prompts
// - if the remaining prose is this many lines or more, score zero.
const MAX_PROSE_LINES = 3;

/** Count regex hits without materializing the match array. */
function countMatches(text: string, re: RegExp): number {
	let count = 0;
	re.lastIndex = 0;
	while (re.exec(text) !== null) count++;
	return count;
}

// A sentence needs 2+ uppercase runs ("WHAT THE HELL"), or a single elongated
// run with a tripled letter ("CMOOON"), before its caps ratio can count as
// yelling. A lone acronym / identifier / env var ("Follow AGENTS", "use
// JSON", "HOME=/tmp") never does.
const UPPER_RUN_RE = /\p{Lu}{2,}/gu;
const TRIPLED_LETTER_RE = /(\p{Lu})\1\1/u;

function isShoutedSentence(sentence: string): boolean {
	const runs = sentence.match(UPPER_RUN_RE);
	if (!runs) return false;
	if (runs.length >= 2) return true;
	return runs[0].length >= YELLING_MIN_LETTERS && TRIPLED_LETTER_RE.test(runs[0]);
}

/**
 * Count sentences where the share of uppercase letters exceeds
 * {@link YELLING_THRESHOLD}. Sentences shorter than
 * {@link YELLING_MIN_LETTERS} alphabetic characters are ignored so that
 * short acronyms ("OK", "WIP", "TODO") don't register as yelling, and the
 * caps must span multiple words (or one elongated shout) - see
 * {@link isShoutedSentence}.
 */
function countYellingSentences(text: string): number {
	let count = 0;
	SENTENCE_RE.lastIndex = 0;
	let match: RegExpExecArray | null = SENTENCE_RE.exec(text);
	while (match !== null) {
		const sentence = match[0];
		const letters = countMatches(sentence, LETTER_RE);
		if (letters >= YELLING_MIN_LETTERS) {
			const upper = countMatches(sentence, UPPER_LETTER_RE);
			if (upper / letters > YELLING_THRESHOLD && isShoutedSentence(sentence)) count++;
		}
		match = SENTENCE_RE.exec(text);
	}
	return count;
}

/**
 * Strip structured content so that pasted code, harness wrappers, file
 * mentions and quoted blocks don't dilute or fake behavior signals.
 * Each strip is replaced with a newline so subsequent line counting
 * reflects what was removed instead of merging neighbors.
 */
function stripStructuredContent(text: string): string {
	return text
		.replace(FENCED_CODE_RE, "\n")
		.replace(XML_TAG_PAIR_RE, "\n")
		.replace(XML_TAG_BARE_RE, " ")
		.replace(INLINE_CODE_RE, " ")
		.replace(URL_RE, " ")
		.replace(FILE_MENTION_RE, "$1 ")
		.replace(DOTTED_TOKEN_RE, " ")
		.replace(QUOTE_LINE_RE, "")
		.replace(IMAGE_MARKER_RE, " ")
		.replace(ANSI_ESCAPE_RE, "");
}

/** Cap on the judge-facing prose stored per user message; longer prose is truncated. */
export const PROSE_MAX_CHARS = 4000;

/**
 * The prose a user message contributes to frustration judging: the same
 * structured-content strip the regex signals score on, trimmed and capped at
 * {@link PROSE_MAX_CHARS}. Empty when the message was nothing but markup.
 */
export function judgeProse(text: string): string {
	const prose = stripStructuredContent(text.trim()).trim();
	return prose.length > PROSE_MAX_CHARS ? prose.slice(0, PROSE_MAX_CHARS) : prose;
}

function countNonEmptyLines(text: string): number {
	let count = 0;
	for (const line of text.split("\n")) {
		if (line.trim().length > 0) count++;
	}
	return count;
}

/**
 * Compute behavioral metrics for a user message.
 *
 * `text` may be empty or whitespace; in that case every metric is 0.
 */
export function computeUserMessageMetrics(
	text: string,
	options: {
		/** The user message before this one in the same session, for whole-message repetition. */ prevText?: string;
	} = {},
): UserMessageMetrics {
	const trimmed = text.trim();
	if (!trimmed) {
		return {
			chars: 0,
			words: 0,
			yelling: 0,
			profanity: 0,
			anguish: 0,
			negation: 0,
			repetition: 0,
			blame: 0,
			emphasis: 0,
			unsupportedScript: 0,
		};
	}

	const chars = trimmed.length;
	const words = countMatches(trimmed, WORD_RE);

	// Behavior signals are computed on a stripped prose body; long /
	// well-formatted messages score zero because they are deliberate, not
	// emotional outbursts.
	const prose = stripStructuredContent(trimmed).trim();
	if (!prose || countNonEmptyLines(prose) >= MAX_PROSE_LINES) {
		return {
			chars,
			words,
			yelling: 0,
			profanity: 0,
			anguish: 0,
			negation: 0,
			repetition: 0,
			blame: 0,
			emphasis: 0,
			unsupportedScript: detectUnsupportedScript(prose),
		};
	}

	const anguish =
		countMatches(prose, DRAMA_RE) +
		countMatches(prose, ANGUISH_RE) +
		countMatches(prose, DUDE_RE) +
		countMatches(prose, SAD_EMOTICON_RE) +
		countMatches(prose, ZH_ANGUISH_RE);

	const negation =
		countMatches(prose, NEGATION_LEAD_RE) +
		countMatches(prose, NEGATION_PHRASE_RE) +
		countMatches(prose, ZH_NEGATION_LEAD_RE) +
		countMatches(prose, ZH_NEGATION_PHRASE_RE);
	const repetition =
		countMatches(prose, REPETITION_RECALL_RE) +
		countMatches(prose, REPETITION_STILL_RE) +
		countMatches(prose, ZH_REPETITION_RE) +
		detectRepeatedMessage(prose, options.prevText ?? "");
	const blame =
		countMatches(prose, BLAME_YOU_RE) +
		countMatches(prose, BLAME_WHY_RE) +
		countMatches(prose, BLAME_STOP_RE) +
		countMatches(prose, ZH_BLAME_RE);
	const emphasis =
		countMatches(prose, ZH_REPEAT_CHAR_RE) +
		countMatches(prose, ZH_REPEAT_WORD_RE) +
		countMatches(prose, ZH_DRAMA_RE);

	return {
		chars,
		words,
		yelling: countYellingSentences(prose),
		profanity: countMatches(prose, PROFANITY_RE) + countMatches(prose, ZH_PROFANITY_RE),
		anguish,
		negation,
		repetition,
		blame,
		emphasis,
		unsupportedScript: detectUnsupportedScript(prose),
	};
}

/** Empty metrics constant for callers that need a default. */
export const EMPTY_USER_METRICS: UserMessageMetrics = Object.freeze({
	chars: 0,
	words: 0,
	yelling: 0,
	profanity: 0,
	anguish: 0,
	negation: 0,
	repetition: 0,
	blame: 0,
	emphasis: 0,
	unsupportedScript: 0,
});
