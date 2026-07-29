import { type ControlSettings, DEFAULT_SETTINGS } from '../player/Controls';

const STORE_KEY = 'mallsim.controls.v1';

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

        <div class="settings-keys">
          WASD lopen · Shift rennen · Space springen · Q/E draaien · R/F kijken ·
          M kaart · Esc muis los
        </div>
        <button type="button" class="settings-reset" id="settings-reset">Standaard herstellen</button>
      </div>
    `;

		this.card = this.host.querySelector('#settings-card')!;
		const q = <T extends HTMLElement>(sel: string) => this.host.querySelector<T>(sel)!;

		q('#settings-btn').addEventListener('click', () => this.toggle());
		q('#settings-close').addEventListener('click', () => this.toggle(false));
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
		const q = <T extends HTMLElement>(sel: string) => this.host.querySelector<T>(sel)!;
		q<HTMLInputElement>('#set-turnkeys').checked = this.settings.turnWithKeys;
		q<HTMLInputElement>('#set-mouselook').checked = this.settings.mouseLook;
		q<HTMLInputElement>('#set-lefty').checked = this.settings.lookButton === 2;
		q<HTMLInputElement>('#set-sens').value = String(this.settings.sensitivity);
		q<HTMLInputElement>('#set-invert').checked = this.settings.invertY;
		q('#set-sens-out').textContent = `${this.settings.sensitivity.toFixed(1)}×`;
		// Sensitivity is meaningless without mouse look
		q('#set-sens').closest('.settings-row')?.classList.toggle(
			'settings-off',
			!this.settings.mouseLook,
		);
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
