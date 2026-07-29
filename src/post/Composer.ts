import {
	EffectComposer,
	EffectPass,
	RenderPass,
	SMAAEffect,
	ToneMappingEffect,
	ToneMappingMode,
	VignetteEffect,
} from 'postprocessing';
import * as THREE from 'three';

/** Clean, stable post — NO bloom (bloom + emissive = arcade flicker). */
export function createComposer(
	renderer: THREE.WebGLRenderer,
	scene: THREE.Scene,
	camera: THREE.Camera,
): EffectComposer {
	const composer = new EffectComposer(renderer, {
		frameBufferType: THREE.HalfFloatType,
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
