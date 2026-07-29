import {
	BloomEffect,
	EffectComposer,
	EffectPass,
	RenderPass,
	SMAAEffect,
	ToneMappingEffect,
	ToneMappingMode,
	VignetteEffect,
} from 'postprocessing';
import * as THREE from 'three';

/** Lighter post stack — less bloom/vignette so the mall stays readable. */
export function createComposer(
	renderer: THREE.WebGLRenderer,
	scene: THREE.Scene,
	camera: THREE.Camera,
): EffectComposer {
	const composer = new EffectComposer(renderer, {
		frameBufferType: THREE.HalfFloatType,
	});

	composer.addPass(new RenderPass(scene, camera));

	const bloom = new BloomEffect({
		intensity: 0.35,
		luminanceThreshold: 0.55,
		luminanceSmoothing: 0.35,
		mipmapBlur: true,
		radius: 0.55,
	});

	const vignette = new VignetteEffect({
		darkness: 0.28,
		offset: 0.4,
	});

	const tone = new ToneMappingEffect({
		mode: ToneMappingMode.ACES_FILMIC,
	});

	const smaa = new SMAAEffect();

	composer.addPass(new EffectPass(camera, bloom, vignette, tone, smaa));

	return composer;
}
