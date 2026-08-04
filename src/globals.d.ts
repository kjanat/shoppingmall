declare module '*.css';

interface Window {
	/** Dev-only console handle, set by App when NODE_ENV !== 'production'. */
	mallsim?: import('#/app/App').App;
	/** Web Speech API — present in Chrome, prefixed in older builds. */
	SpeechRecognition?: new () => import('#/audio/BartekChat').Recog;
	webkitSpeechRecognition?: new () => import('#/audio/BartekChat').Recog;
}
