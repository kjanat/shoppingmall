declare module '*.css';

interface Window {
	/** Dev-only console handle, set by App when NODE_ENV !== 'production'. */
	mallsim?: import('#/app/App').App;
}

/** Web Speech API — present in Chrome, prefixed in older builds. */
declare var SpeechRecognition: (new () => import('#/audio/BartekChat').Recog) | undefined;
declare var webkitSpeechRecognition: (new () => import('#/audio/BartekChat').Recog) | undefined;
