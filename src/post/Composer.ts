import {
	EffectComposer,
	EffectPass,
	RenderPass,
	SMAAEffect,
	ToneMappingEffect,
	ToneMappingMode,
	VignetteEffect,
} from 'postprocessing';
import type { Camera, Scene, WebGLRenderer } from 'three';
import { HalfFloatType } from 'three';

/** Clean, stable post — NO bloom (bloom + emissive = arcade flicker). */
export function createComposer(renderer: WebGLRenderer, scene: Scene, camera: Camera): EffectComposer {
	const composer = new EffectComposer(renderer, {
		frameBufferType: HalfFloatType,
	});

	composer.addPass(new RenderPass(scene, camera));

	const vignette = new VignetteEffect({
		darkness: 0.18,
		offset: 0.45,
	});

	const tone = new ToneMappingEffect({
		mode: ToneMappingMode.ACES_FILMIC,
	});

	const smaa = new SMAAEffect();

	composer.addPass(new EffectPass(camera, vignette, tone, smaa));

	return composer;
}
