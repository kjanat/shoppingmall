/**
 * Live mic conversation with DJ Bartek:
 * browser SpeechRecognition → intent reply → ElevenLabs voice.
 */
import { pick } from '#/util/rand';
import { speakBartek } from './ElevenVoice';

const HISTORY_LINE_LIMIT = 12;
const REPLY_ECHO_CHARACTER_LIMIT = 80;
const REPLY_DROP_CHARACTER_LIMIT = 40;
const REPLY_TOPIC_WORD_LIMIT = 4;

const GREETING_PATTERN = /hallo|hoi|hey|yo|goedemorgen|goedemiddag/;
const MUSIC_PATTERN = /muziek|nummer|song|plaat|draai|play|request/;
const KRUIDVAT_PATTERN = /kruidvat|youssef|vitamine/;
const RAT_PATTERN = /rat|muis|vies/;
const PRAYER_PATTERN = /gebed|moskee|allahu|islam/;
const PARTY_PATTERN = /dans|feest|disco|party/;
const PROFANITY_PATTERN = /kut|shit|lul|kanker|fuck/;
const IDENTITY_PATTERN = /wie ben|wie ben jij|naam/;
const ALIEN_PATTERN = /alien|probe|ufo/;

/** The slice of the Web Speech API we drive — it isn't in every lib.dom. */
interface Recog {
	lang: string;
	interimResults: boolean;
	continuous: boolean;
	maxAlternatives: number;
	onresult: ((ev: { results: SpeechRecognitionResultList }) => void) | null;
	onerror: (() => void) | null;
	onend: (() => void) | null;
	start: () => void;
	stop: () => void;
}
function speechCtor(): (new () => Recog) | undefined {
	return globalThis.SpeechRecognition ?? globalThis.webkitSpeechRecognition;
}

interface ChatLine {
	who: 'you' | 'bartek';
	text: string;
}

class BartekChat {
	private recog: Recog | null = null;
	listening: boolean;
	busy: boolean;
	history: ChatLine[] = [];
	onUpdate: ((lines: ChatLine[], status: string) => void) | null = null;
	/** world position of Bartek booth for spatial voice */
	boothPos = { x: -20.5, y: 1.8, z: 5 };

	constructor() {
		this.listening = false;
		this.busy = false;
	}

	private emit(status: string): void {
		this.onUpdate?.(this.history.slice(-HISTORY_LINE_LIMIT), status);
	}

	canListen(): boolean {
		return !!speechCtor();
	}

	/** Push-to-talk start */
	startListening(): void {
		if (this.busy || this.listening) return;
		const Sr = speechCtor();
		if (!Sr) {
			this.emit('Geen SpeechRecognition in deze browser — gebruik Chrome.');
			return;
		}
		const r = new Sr();
		this.recog = r;
		r.lang = 'nl-NL';
		r.interimResults = true;
		r.continuous = false;
		r.maxAlternatives = 1;
		this.listening = true;
		this.emit('🎙️ Luisteren… praat met Bartek');

		r.onresult = (ev: { results: SpeechRecognitionResultList }) => {
			const last = Array.from(ev.results).at(-1);
			if (!last) return;
			const text = last[0]?.transcript?.trim() ?? '';
			if (!text) return;
			if (last.isFinal) {
				this.listening = false;
				this.replyTo(text).catch((error: unknown) => {
					this.busy = false;
					this.emit(`🎤 Mic reply error: ${String(error)}`);
				});
			} else {
				this.emit(`… ${text}`);
			}
		};
		r.onerror = () => {
			this.listening = false;
			this.emit('Mic error — probeer opnieuw (houd knop in)');
		};
		r.onend = () => {
			this.listening = false;
		};
		try {
			r.start();
		} catch {
			this.listening = false;
			this.emit('Mic start mislukt — geef microfoon-toestemming');
		}
	}

	stopListening(): void {
		try {
			this.recog?.stop();
		} catch {
			/* */
		}
		this.listening = false;
	}

	async replyTo(userText: string): Promise<void> {
		if (this.busy) return;
		this.busy = true;
		this.history.push({ who: 'you', text: userText });
		this.emit('Bartek denkt…');

		const reply = craftBartekReply(userText);
		this.history.push({ who: 'bartek', text: reply });
		this.emit('🎤 Bartek antwoordt…');

		try {
			const r = await speakBartek(reply);
			if (r.source !== 'elevenlabs') {
				this.emit(`🎤 ElevenLabs faalde: ${r.error ?? 'silent'} — check /api/tts`);
			}
		} catch (e) {
			this.emit(`🎤 Mic reply error: ${String(e)}`);
		}

		this.busy = false;
		this.emit('Houd 🎙️ in om verder te praten');
	}
}

function craftBartekReply(input: string): string {
	const t = input.toLowerCase();
	if (GREETING_PATTERN.test(t)) {
		return 'Yo! Bartek hier, Bartek Bartek! Hoe gaat het met je jongen? Request iets of vertel me wat je voelt.';
	}
	if (MUSIC_PATTERN.test(t)) {
		return 'Zeg de titel en ik gooi yt-dlp erop. Live muziekbibliotheek, geen bubbels. Wat wil je horen?';
	}
	if (KRUIDVAT_PATTERN.test(t)) {
		return 'Youssef bij Kruidvat is family. Marhaba-energie. Ik stuur hem later een shoutout over de set!';
	}
	if (RAT_PATTERN.test(t)) {
		return 'Die rat is VIP hier. Trap-gat mascotte. Respect de rat, jongen.';
	}
	if (PRAYER_PATTERN.test(t)) {
		return 'Westvleugel heeft een stille gebedsruimte. Respect. Bartek draait soft als je daar bent.';
	}
	if (PARTY_PATTERN.test(t)) {
		return 'Dan drukken we de drop! Hands up bij de trap. Bartek maakt het zwaar.';
	}
	if (PROFANITY_PATTERN.test(t)) {
		return 'Rustig jongen, we houden het fun. Request een plaat en we resetten de vibe.';
	}
	if (IDENTITY_PATTERN.test(t)) {
		return 'Ik ben DJ Bartek, Bartek, Bartek. Trap-gat resident. Prairie Lakes forever.';
	}
	if (ALIEN_PATTERN.test(t)) {
		return 'Aliens mogen scannen, ik mix harder dan hun beam. Pure mall-drama!';
	}
	// echo + hype
	const short = input.trim().slice(0, REPLY_ECHO_CHARACTER_LIMIT);
	const riffs = [
		`Ik hoor je: “${short}”. Bartek voelt die energie. Zullen we harder gaan?`,
		`“${short}” — dat is een vibe. Trap-gat knikt. Request of dans, jij kiest.`,
		`Received, mens. Bartek zegt: ${short.slice(0, REPLY_DROP_CHARACTER_LIMIT)}… en dan de drop. Yallah!`,
		`Mic check perfect. Jij zei iets over ${short.split(' ').slice(0, REPLY_TOPIC_WORD_LIMIT).join(' ')}. Ik draai door.`,
	];
	return pick(riffs);
}

export type { ChatLine, Recog };
export { BartekChat };
