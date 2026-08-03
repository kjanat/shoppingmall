import { type ControlSettings, DEFAULT_SETTINGS } from '@/player/Controls';
import { qs } from '@/util/dom';

const STORE_KEY = 'mallsim.controls.v1';
const QUALITY_KEY = 'mallsim.quality.v1';
const BINAURAL_KEY = 'mallsim.binaural.v1';
const DYNRES_KEY = 'mallsim.dynres.v1';

export type QualityLevel = 'laag' | 'middel' | 'hoog';

function loadQuality(): QualityLevel {
	try {
		const q = localStorage.getItem(QUALITY_KEY);
		return q === 'laag' || q === 'hoog' ? q : 'middel';
	} catch {
		return 'middel';
	}
}

function loadBinaural(): boolean {
	try {
		const v = localStorage.getItem(BINAURAL_KEY);
		// default ON — headphones get HRTF
		if (v === null) return true;
		return v !== '0' && v !== 'false';
	} catch {
		return true;
	}
}

function loadDynRes(): boolean {
	try {
		const v = localStorage.getItem(DYNRES_KEY);
		// default AAN — liever even zachter beeld dan een diavoorstelling
		if (v === null) return true;
		return v !== '0' && v !== 'false';
	} catch {
		return true;
	}
}

/**
 * Besturing-instellingen: mouse-look on/off, tank-steering, left-handed mouse.
 * Lives in its own overlay so it never fights the kiosk panel for space.
 */
export class SettingsPanel {
	private root: HTMLElement;
	private host: HTMLElement;
	private card!: HTMLElement;
	private open = false;
	private settings: ControlSettings;
	private onChange: (s: ControlSettings) => void;

	/** Grafische kwaliteit — de Pi trekt 'hoog' niet met schaduwen aan. */
	private quality: QualityLevel = loadQuality();
	private onQuality: ((q: QualityLevel) => void) | null = null;
	/** HRTF binaural — headphones recommended */
	private binaural = loadBinaural();
	private onBinaural: ((on: boolean) => void) | null = null;
	/** Dynamische resolutie — render lager als de framerate zakt */
	private dynRes = loadDynRes();
	private onDynRes: ((on: boolean) => void) | null = null;

	/** App meldt zich hier aan; krijgt meteen de opgeslagen stand. */
	bindQuality(fn: (q: QualityLevel) => void): void {
		this.onQuality = fn;
		fn(this.quality);
	}

	bindBinaural(fn: (on: boolean) => void): void {
		this.onBinaural = fn;
		fn(this.binaural);
	}

	bindDynRes(fn: (on: boolean) => void): void {
		this.onDynRes = fn;
		fn(this.dynRes);
	}

	constructor(root: HTMLElement, onChange: (s: ControlSettings) => void) {
		this.root = root;
		this.onChange = onChange;
		this.settings = SettingsPanel.load();
		this.host = document.createElement('div');
		this.host.className = 'settings-host';
		this.root.appendChild(this.host);
		this.mount();
		// Push the stored scheme into the controller on boot
		this.onChange(this.settings);
	}

	static load(): ControlSettings {
		try {
			const raw = localStorage.getItem(STORE_KEY);
			if (!raw) return { ...DEFAULT_SETTINGS };
			const parsed = JSON.parse(raw) as Partial<ControlSettings>;
			return { ...DEFAULT_SETTINGS, ...parsed };
		} catch {
			return { ...DEFAULT_SETTINGS };
		}
	}

	get current(): ControlSettings {
		return this.settings;
	}

	toggle(force?: boolean): void {
		this.open = force === undefined ? !this.open : force;
		this.card.classList.toggle('hidden', !this.open);
	}

	private mount(): void {
		this.host.innerHTML = `
      <button type="button" class="settings-btn" id="settings-btn" title="Besturing (O)">⚙ Besturing</button>
      <div class="settings-card hidden" id="settings-card">
        <div class="settings-head">
          <strong>Besturing</strong>
          <button type="button" class="settings-close" id="settings-close">✕</button>
        </div>

        <label class="settings-row">
          <span>
            <b>Draaien met toetsen</b>
            <small>A/D (en ←/→) draaien de camera i.p.v. zijstappen. Q/E draaien altijd.</small>
          </span>
          <input type="checkbox" id="set-turnkeys" />
        </label>

        <label class="settings-row">
          <span>
            <b>Muis kijken</b>
            <small>Uit = helemaal geen muis nodig. Kijken met Q/E (draaien) en R/F (omhoog/omlaag).</small>
          </span>
          <input type="checkbox" id="set-mouselook" />
        </label>

        <label class="settings-row">
          <span>
            <b>Linkshandige muis</b>
            <small>Kijken met de rechterknop in plaats van links.</small>
          </span>
          <input type="checkbox" id="set-lefty" />
        </label>

        <label class="settings-row">
          <span>
            <b>Muisgevoeligheid</b>
            <small id="set-sens-out">1.0×</small>
          </span>
          <input type="range" id="set-sens" min="0.3" max="2.5" step="0.1" />
        </label>

        <label class="settings-row">
          <span>
            <b>Y omkeren</b>
            <small>Vliegtuigstijl: muis naar voren = omhoog kijken.</small>
          </span>
          <input type="checkbox" id="set-invert" />
        </label>

        <label class="settings-row">
          <span>
            <b>Grafische kwaliteit</b>
            <small>Laag = geen schaduwen, scherpte omlaag — voor de Pi. Hoog = alles aan.</small>
          </span>
          <select id="set-quality">
            <option value="laag">Laag</option>
            <option value="middel">Middel</option>
            <option value="hoog">Hoog</option>
          </select>
        </label>

        <label class="settings-row">
          <span>
            <b>Dynamische resolutie</b>
            <small>Verlaagt de renderresolutie tijdelijk als de framerate zakt; scherp zodra het weer kan.</small>
          </span>
          <input type="checkbox" id="set-dynres" />
        </label>

        <label class="settings-row">
          <span>
            <b>Binaural audio (HRTF)</b>
            <small>3D-geluid via koptelefoon: links/rechts/achter/hoogte. Speakers = soft stereo.</small>
          </span>
          <input type="checkbox" id="set-binaural" />
        </label>

        <div class="settings-keys">
          WASD lopen · Shift rennen · Space springen · Q/E draaien · R/F kijken ·
          M kaart · Esc muis los · O besturing
        </div>
        <button type="button" class="settings-reset" id="settings-reset">Standaard herstellen</button>
      </div>
    `;

		this.card = qs(this.host, '#settings-card');
		const q = <T extends HTMLElement>(sel: string) => qs<T>(this.host, sel);

		q('#settings-btn').addEventListener('click', () => this.toggle());
		q('#settings-close').addEventListener('click', () => this.toggle(false));
		const qualitySel = q<HTMLSelectElement>('#set-quality');
		qualitySel.value = this.quality;
		qualitySel.addEventListener('change', () => {
			this.quality = (qualitySel.value as QualityLevel) ?? 'middel';
			try {
				localStorage.setItem(QUALITY_KEY, this.quality);
			} catch {
				/* private mode */
			}
			this.onQuality?.(this.quality);
		});

		const dynResCb = q<HTMLInputElement>('#set-dynres');
		dynResCb.checked = this.dynRes;
		dynResCb.addEventListener('change', () => {
			this.dynRes = dynResCb.checked;
			try {
				localStorage.setItem(DYNRES_KEY, this.dynRes ? '1' : '0');
			} catch {
				/* private mode */
			}
			this.onDynRes?.(this.dynRes);
		});

		const binauralCb = q<HTMLInputElement>('#set-binaural');
		binauralCb.checked = this.binaural;
		binauralCb.addEventListener('change', () => {
			this.binaural = binauralCb.checked;
			try {
				localStorage.setItem(BINAURAL_KEY, this.binaural ? '1' : '0');
			} catch {
				/* */
			}
			this.onBinaural?.(this.binaural);
		});

		q('#settings-reset').addEventListener('click', () => {
			this.settings = { ...DEFAULT_SETTINGS };
			this.sync();
			this.commit();
		});

		const turnKeys = q<HTMLInputElement>('#set-turnkeys');
		const mouseLook = q<HTMLInputElement>('#set-mouselook');
		const lefty = q<HTMLInputElement>('#set-lefty');
		const sens = q<HTMLInputElement>('#set-sens');
		const invert = q<HTMLInputElement>('#set-invert');

		turnKeys.addEventListener('change', () => {
			this.settings.turnWithKeys = turnKeys.checked;
			this.commit();
		});
		mouseLook.addEventListener('change', () => {
			this.settings.mouseLook = mouseLook.checked;
			// No mouse? Then tank-steering is the only way to turn — switch it on.
			if (!mouseLook.checked) this.settings.turnWithKeys = true;
			this.sync();
			this.commit();
		});
		lefty.addEventListener('change', () => {
			this.settings.lookButton = lefty.checked ? 2 : 0;
			this.commit();
		});
		sens.addEventListener('input', () => {
			this.settings.sensitivity = Number(sens.value);
			this.sync();
			this.commit();
		});
		invert.addEventListener('change', () => {
			this.settings.invertY = invert.checked;
			this.commit();
		});

		window.addEventListener('keydown', (e) => {
			const el = e.target as HTMLElement | null;
			if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
			if (e.code === 'KeyO') this.toggle();
			else if (e.code === 'Escape' && this.open) this.toggle(false);
		});

		this.sync();
	}

	private sync(): void {
		const q = <T extends HTMLElement>(sel: string) => qs<T>(this.host, sel);
		q<HTMLInputElement>('#set-turnkeys').checked = this.settings.turnWithKeys;
		q<HTMLInputElement>('#set-mouselook').checked = this.settings.mouseLook;
		q<HTMLInputElement>('#set-lefty').checked = this.settings.lookButton === 2;
		q<HTMLInputElement>('#set-sens').value = String(this.settings.sensitivity);
		q<HTMLInputElement>('#set-invert').checked = this.settings.invertY;
		q('#set-sens-out').textContent = `${this.settings.sensitivity.toFixed(1)}×`;
		const bin = this.host.querySelector<HTMLInputElement>('#set-binaural');
		if (bin) bin.checked = this.binaural;
		const dyn = this.host.querySelector<HTMLInputElement>('#set-dynres');
		if (dyn) dyn.checked = this.dynRes;
		// Sensitivity is meaningless without mouse look
		q('#set-sens').closest('.settings-row')?.classList.toggle('settings-off', !this.settings.mouseLook);
	}

	private commit(): void {
		try {
			localStorage.setItem(STORE_KEY, JSON.stringify(this.settings));
		} catch {
			// private mode / storage disabled — settings just won't persist
		}
		this.onChange(this.settings);
	}
}
