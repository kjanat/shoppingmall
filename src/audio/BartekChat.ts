/**
 * Live mic conversation with DJ Bartek:
 * browser SpeechRecognition → intent reply → ElevenLabs voice.
 */
import { pick } from '@/util/rand';
import { speakLine } from './ElevenVoice';

/** The slice of the Web Speech API we drive — it isn't in every lib.dom. */
export type Recog = {
	lang: string;
	interimResults: boolean;
	continuous: boolean;
	maxAlternatives: number;
	onresult: ((ev: { results: SpeechRecognitionResultList }) => void) | null;
	onerror: (() => void) | null;
	onend: (() => void) | null;
	start(): void;
	stop(): void;
};

function speechCtor(): (new () => Recog) | undefined {
	return window.SpeechRecognition ?? window.webkitSpeechRecognition;
}

export type ChatLine = { who: 'you' | 'bartek'; text: string };

export class BartekChat {
	private recog: Recog | null = null;
	listening = false;
	busy = false;
	history: ChatLine[] = [];
	onUpdate: ((lines: ChatLine[], status: string) => void) | null = null;
	/** world position of Bartek booth for spatial voice */
	boothPos = { x: -20.5, y: 1.8, z: 5 };

	private emit(status: string): void {
		this.onUpdate?.(this.history.slice(-12), status);
	}

	canListen(): boolean {
		return !!speechCtor();
	}

	/** Push-to-talk start */
	startListening(): void {
		if (this.busy || this.listening) return;
		const SR = speechCtor();
		if (!SR) {
			this.emit('Geen SpeechRecognition in deze browser — gebruik Chrome.');
			return;
		}
		const r = new SR();
		this.recog = r;
		r.lang = 'nl-NL';
		r.interimResults = true;
		r.continuous = false;
		r.maxAlternatives = 1;
		this.listening = true;
		this.emit('🎙️ Luisteren… praat met Bartek');

		r.onresult = (ev: { results: SpeechRecognitionResultList }) => {
			const last = ev.results[ev.results.length - 1];
			if (!last) return;
			const text = last[0]?.transcript?.trim() ?? '';
			if (!text) return;
			if (last.isFinal) {
				this.listening = false;
				void this.replyTo(text);
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
			const r = await speakLine(reply, {
				voiceId: 'IKne3meq5aSn9XLyUdCD',
				lang: 'nl',
				allowBrowser: false,
			});
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
	if (/hallo|hoi|hey|yo|goedemorgen|goedemiddag/.test(t)) {
		return 'Yo! Bartek hier, Bartek Bartek! Hoe gaat het met je jongen? Request iets of vertel me wat je voelt.';
	}
	if (/muziek|nummer|song|plaat|draai|play|request/.test(t)) {
		return 'Zeg de titel en ik gooi yt-dlp erop. Live crates, geen bubbels. Wat wil je horen?';
	}
	if (/kruidvat|youssef|vitamine/.test(t)) {
		return 'Youssef bij Kruidvat is family. Marhaba-energie. Ik stuur hem later een shoutout over de set!';
	}
	if (/rat|muis|vies/.test(t)) {
		return 'Die rat is VIP hier. Trap-gat mascotte. Respect de rat, jongen.';
	}
	if (/gebed|moskee|allahu|islam/.test(t)) {
		return 'Westvleugel heeft een stille gebedsruimte. Respect. Bartek draait soft als je daar bent.';
	}
	if (/dans|feest|disco|party/.test(t)) {
		return 'Dan drukken we de drop! Hands up bij de trap. Bartek maakt het zwaar.';
	}
	if (/kut|shit|lul|kanker|fuck/.test(t)) {
		return 'Rustig jongen, we houden het fun. Request een plaat en we resetten de vibe.';
	}
	if (/wie ben|wie ben jij|naam/.test(t)) {
		return 'Ik ben DJ Bartek, Bartek, Bartek. Trap-gat resident. Prairie Lakes forever.';
	}
	if (/alien|probe|ufo/.test(t)) {
		return 'Aliens mogen scannen, ik mix harder dan hun beam. Pure mall-drama!';
	}
	// echo + hype
	const short = input.trim().slice(0, 80);
	const riffs = [
		`Ik hoor je: “${short}”. Bartek voelt die energie. Zullen we harder gaan?`,
		`“${short}” — dat is een vibe. Trap-gat knikt. Request of dans, jij kiest.`,
		`Received, mens. Bartek zegt: ${short.slice(0, 40)}… en dan de drop. Yallah!`,
		`Mic check perfect. Jij zei iets over ${short.split(' ').slice(0, 4).join(' ')}. Ik draai door.`,
	];
	return pick(riffs);
}
